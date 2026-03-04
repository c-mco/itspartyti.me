package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/c-mco/itspartyti.me/internal/db"
	"github.com/c-mco/itspartyti.me/internal/models"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookieName = "session"
	sessionDuration   = 30 * 24 * time.Hour
	bcryptCost        = 12
	maxEmailLen       = 254 // RFC 5321
	maxDisplayNameLen = 64
	maxPasswordLen    = 72 // bcrypt limit
	maxNoteLen        = 500
	rateLimitWindow   = time.Minute
	rateLimitMax      = 10
)

// Handler holds all dependencies.
type Handler struct {
	DB      *db.DB
	Origin  string
	IsProd  bool
	limiter *rateLimiter
}

func New(database *db.DB, origin string, isProd bool) *Handler {
	return &Handler{
		DB:      database,
		Origin:  origin,
		IsProd:  isProd,
		limiter: newRateLimiter(),
	}
}

// --- Rate limiter ---

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string][]time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{buckets: make(map[string][]time.Time)}
}

func (r *rateLimiter) allow(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rateLimitWindow)

	times := r.buckets[ip]
	// Evict old entries
	valid := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	r.buckets[ip] = append(valid, now)
	return len(r.buckets[ip]) <= rateLimitMax
}

// --- Helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	ip := r.RemoteAddr
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		ip = ip[:idx]
	}
	return ip
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func generateID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// isValidEmail performs simple email validation.
func isValidEmail(s string) bool {
	parts := strings.SplitN(s, "@", 2)
	return len(parts) == 2 &&
		len(parts[0]) > 0 &&
		len(parts[1]) > 3 &&
		strings.Contains(parts[1], ".")
}

func (h *Handler) sessionFromRequest(r *http.Request) (*models.Session, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil, nil
	}
	s, err := h.DB.GetSession(cookie.Value)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, nil
	}
	if time.Now().After(s.ExpiresAt) {
		_ = h.DB.DeleteSession(s.Token)
		return nil, nil
	}
	return s, nil
}

func (h *Handler) requireAuth(r *http.Request) (*models.Session, error) {
	return h.sessionFromRequest(r)
}

// resolveUserID resolves the authenticated user ID from the request.
func (h *Handler) resolveUserID(r *http.Request) (string, error) {
	session, err := h.sessionFromRequest(r)
	if err != nil {
		return "", err
	}
	if session != nil {
		return session.UserID, nil
	}
	return "", nil
}

// --- Security headers middleware ---

func (h *Handler) SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		csp := "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
		w.Header().Set("Content-Security-Policy", csp)
		if h.IsProd {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

// --- CORS middleware ---

func (h *Handler) CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := h.Origin
		if !h.IsProd {
			origin = r.Header.Get("Origin")
			if origin == "" {
				origin = "*"
			}
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Register ---

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.limiter.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}

	var req struct {
		Email       string `json:"email"`
		Username    string `json:"username"` // backward compat alias
		DisplayName string `json:"display_name"`
		Password    string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Prefer email field; fall back to username field
	email := strings.TrimSpace(req.Email)
	if email == "" {
		email = strings.TrimSpace(req.Username)
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if len(email) > maxEmailLen {
		writeError(w, http.StatusBadRequest, "email too long")
		return
	}
	if !isValidEmail(email) {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if len(displayName) > maxDisplayNameLen {
		writeError(w, http.StatusBadRequest, "name too long (max 64 characters)")
		return
	}

	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if len(req.Password) > maxPasswordLen {
		writeError(w, http.StatusBadRequest, "password too long")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	id, err := generateID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	user := &models.User{
		ID:           id,
		Email:        email,
		DisplayName:  displayName,
		PasswordHash: string(hash),
	}
	if err := h.DB.CreateUser(user); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeError(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"message": "account created"})
}

// --- Login ---

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.limiter.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "too many requests")
		return
	}

	var req struct {
		Email    string `json:"email"`
		Username string `json:"username"` // backward compat alias
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Prefer email field; fall back to username field
	email := strings.TrimSpace(req.Email)
	if email == "" {
		email = strings.TrimSpace(req.Username)
	}

	user, err := h.DB.GetUserByEmail(email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		// Prevent timing attack by still running bcrypt
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$12$placeholder"), []byte(req.Password))
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	token, err := generateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	session := &models.Session{
		Token:     token,
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(sessionDuration),
	}
	if err := h.DB.CreateSession(session); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	sameSite := http.SameSiteLaxMode
	if h.IsProd {
		sameSite = http.SameSiteStrictMode
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.IsProd,
		SameSite: sameSite,
		Expires:  session.ExpiresAt,
	})

	writeJSON(w, http.StatusOK, map[string]string{
		"email":        user.Email,
		"display_name": user.DisplayName,
		// Legacy field for any clients still checking 'username'
		"username": user.Email,
	})
}

// --- Logout ---

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	_ = h.DB.DeleteSession(session.Token)

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})

	writeJSON(w, http.StatusOK, map[string]string{"message": "logged out"})
}

// --- Logs ---

func (h *Handler) Logs(w http.ResponseWriter, r *http.Request) {
	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.getLogs(w, r, session.UserID)
	case http.MethodPost:
		h.createLog(w, r, session.UserID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) getLogs(w http.ResponseWriter, r *http.Request, userID string) {
	logs, err := h.DB.GetLogs(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if logs == nil {
		logs = []*models.Log{}
	}
	writeJSON(w, http.StatusOK, logs)
}

func (h *Handler) createLog(w http.ResponseWriter, r *http.Request, userID string) {
	var req struct {
		Date   string `json:"date"`
		Drinks int    `json:"drinks"`
		Note   string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate date format
	if _, err := time.Parse("2006-01-02", req.Date); err != nil {
		writeError(w, http.StatusBadRequest, "invalid date format, expected YYYY-MM-DD")
		return
	}
	if req.Drinks < 0 || req.Drinks > 100 {
		writeError(w, http.StatusBadRequest, "drinks must be between 0 and 100")
		return
	}
	note := strings.TrimSpace(req.Note)
	if len(note) > maxNoteLen {
		writeError(w, http.StatusBadRequest, "note too long")
		return
	}

	id, err := generateID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	l := &models.Log{
		ID:     id,
		UserID: userID,
		Date:   req.Date,
		Drinks: req.Drinks,
		Note:   note,
	}
	if err := h.DB.UpsertLog(l); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, l)
}

// --- Delete log ---

func (h *Handler) DeleteLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Extract date from URL: /api/logs/2024-01-15
	path := strings.TrimPrefix(r.URL.Path, "/api/logs/")
	date := strings.TrimSpace(path)
	if _, err := time.Parse("2006-01-02", date); err != nil {
		writeError(w, http.StatusBadRequest, "invalid date format")
		return
	}

	if err := h.DB.DeleteLog(session.UserID, date); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

// --- Stats ---

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	stats, err := h.DB.GetStats(session.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// --- Account (profile update + delete) ---

// Account dispatches PUT (update profile) and DELETE (delete account) on /api/account.
func (h *Handler) Account(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodDelete:
		h.DeleteAccount(w, r)
	case http.MethodPut:
		h.UpdateProfile(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := h.DB.DeleteUser(session.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})

	writeJSON(w, http.StatusOK, map[string]string{"message": "account deleted"})
}

func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	email := strings.TrimSpace(req.Email)
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if len(email) > maxEmailLen {
		writeError(w, http.StatusBadRequest, "email too long")
		return
	}
	if !isValidEmail(email) {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if len(displayName) > maxDisplayNameLen {
		writeError(w, http.StatusBadRequest, "name too long (max 64 characters)")
		return
	}

	if err := h.DB.UpdateUserProfile(session.UserID, email, displayName); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeError(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"email":        email,
		"display_name": displayName,
	})
}

// --- Change password ---

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := h.DB.GetUserByID(session.UserID)
	if err != nil || user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		writeError(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}

	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}
	if len(req.NewPassword) > maxPasswordLen {
		writeError(w, http.StatusBadRequest, "new password too long")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := h.DB.UpdateUserPassword(session.UserID, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "password updated"})
}

// --- Add drink (quick +1) ---

func (h *Handler) AddDrink(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil || userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	today := time.Now().Format("2006-01-02")

	id, err := generateID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	drinks, err := h.DB.IncrementDrinks(userID, today, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"date": today, "drinks": drinks})
}

// --- Me ---

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	session, err := h.requireAuth(r)
	if err != nil || session == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	user, err := h.DB.GetUserByID(session.UserID)
	if err != nil || user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"email":        user.Email,
		"display_name": user.DisplayName,
		// Legacy field for any clients still checking 'username'
		"username": user.Email,
	})
}
