package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/c-mco/itspartyti.me/internal/db"
	"github.com/c-mco/itspartyti.me/internal/models"
)

func newTestHandler(t *testing.T) (*Handler, *db.DB) {
	t.Helper()
	f, err := os.CreateTemp("", "handler-test-*.db")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	t.Cleanup(func() { os.Remove(f.Name()) })

	d, err := db.New(f.Name())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })

	h := New(d, "http://localhost:8080", false)
	return h, d
}

func jsonBody(t *testing.T, v any) *bytes.Reader {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(b)
}

func doRequest(t *testing.T, h http.HandlerFunc, method, path string, body *bytes.Reader, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequest(method, path, body)
	} else {
		req, err = http.NewRequest(method, path, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "127.0.0.1:1234"
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rr := httptest.NewRecorder()
	h(rr, req)
	return rr
}

func parseJSON(t *testing.T, rr *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(rr.Body).Decode(v); err != nil {
		t.Fatalf("parse response JSON: %v (body: %s)", err, rr.Body.String())
	}
}

// registerUser registers a user via the API using the email field.
func registerUser(t *testing.T, h *Handler, email, password string) {
	t.Helper()
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register",
		jsonBody(t, map[string]string{"email": email, "password": password}))
	if rr.Code != http.StatusCreated {
		t.Fatalf("register failed: %s", rr.Body.String())
	}
}

// loginUser logs in via the API and returns the session cookie.
func loginUser(t *testing.T, h *Handler, email, password string) *http.Cookie {
	t.Helper()
	rr := doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"email": email, "password": password}))
	if rr.Code != http.StatusOK {
		t.Fatalf("login failed: %s", rr.Body.String())
	}
	for _, c := range rr.Result().Cookies() {
		if c.Name == sessionCookieName {
			return c
		}
	}
	t.Fatal("no session cookie in response")
	return nil
}

// ===== Register =====

func TestRegister_HappyPath(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register",
		jsonBody(t, map[string]string{"email": "alice@test.com", "password": "password123"}))

	if rr.Code != http.StatusCreated {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
}

func TestRegister_WithDisplayName(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register",
		jsonBody(t, map[string]any{"email": "alice@test.com", "password": "password123", "display_name": "Alice"}))
	if rr.Code != http.StatusCreated {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
}

func TestRegister_LegacyUsernameField(t *testing.T) {
	// Backward compat: still accept 'username' field
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register",
		jsonBody(t, map[string]string{"username": "alice@test.com", "password": "password123"}))
	if rr.Code != http.StatusCreated {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	h, _ := newTestHandler(t)
	body := map[string]string{"email": "alice@test.com", "password": "password123"}
	doRequest(t, h.Register, http.MethodPost, "/api/register", jsonBody(t, body))
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register", jsonBody(t, body))
	if rr.Code != http.StatusConflict {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusConflict)
	}
}

func TestRegister_InvalidEmail(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register",
		jsonBody(t, map[string]string{"email": "notanemail", "password": "password123"}))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestRegister_ShortPassword(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register",
		jsonBody(t, map[string]string{"email": "alice@test.com", "password": "short"}))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestRegister_MissingEmail(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Register, http.MethodPost, "/api/register",
		jsonBody(t, map[string]string{"password": "password123"}))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestRegister_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Register, http.MethodGet, "/api/register", nil)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

// ===== Login =====

func TestLogin_HappyPath(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"email": "alice@test.com", "password": "password123"}))

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var data map[string]string
	parseJSON(t, rr, &data)
	if data["email"] != "alice@test.com" {
		t.Errorf("email: got %q want %q", data["email"], "alice@test.com")
	}

	var found bool
	for _, c := range rr.Result().Cookies() {
		if c.Name == sessionCookieName {
			found = true
			break
		}
	}
	if !found {
		t.Error("session cookie not set")
	}
}

func TestLogin_LegacyUsernameField(t *testing.T) {
	// Backward compat: login with 'username' field
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"username": "alice@test.com", "password": "password123"}))
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"email": "alice@test.com", "password": "wrongpassword"}))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestLogin_UnknownUser(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"email": "nobody@test.com", "password": "password123"}))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// ===== Auth requirement =====

func TestLogs_RequiresAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Logs, http.MethodGet, "/api/logs", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestStats_RequiresAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Stats, http.MethodGet, "/api/stats", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestExpiredSession(t *testing.T) {
	h, d := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	// Manually expire the session
	_ = d.DeleteSession(cookie.Value)
	user, _ := d.GetUserByEmail("alice@test.com")
	_ = d.CreateSession(&models.Session{
		Token:     cookie.Value,
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(-time.Hour), // expired
	})

	rr := doRequest(t, h.Logs, http.MethodGet, "/api/logs", nil, cookie)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// ===== Logs =====

func TestCreateAndGetLogs(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	// Create log
	rr := doRequest(t, h.Logs, http.MethodPost, "/api/logs",
		jsonBody(t, map[string]any{"date": "2024-01-15", "drinks": 3, "note": "wine"}),
		cookie)
	if rr.Code != http.StatusOK {
		t.Errorf("create log status: got %d want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
	}

	// Get logs
	rr = doRequest(t, h.Logs, http.MethodGet, "/api/logs", nil, cookie)
	if rr.Code != http.StatusOK {
		t.Errorf("get logs status: got %d want %d", rr.Code, http.StatusOK)
	}

	var logs []map[string]any
	parseJSON(t, rr, &logs)
	if len(logs) != 1 {
		t.Errorf("expected 1 log, got %d", len(logs))
	}
}

func TestCreateLog_InvalidDate(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Logs, http.MethodPost, "/api/logs",
		jsonBody(t, map[string]any{"date": "not-a-date", "drinks": 1}),
		cookie)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestCreateLog_NegativeDrinks(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Logs, http.MethodPost, "/api/logs",
		jsonBody(t, map[string]any{"date": "2024-01-15", "drinks": -1}),
		cookie)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestDeleteLog_HappyPath(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	doRequest(t, h.Logs, http.MethodPost, "/api/logs",
		jsonBody(t, map[string]any{"date": "2024-01-15", "drinks": 2}), cookie)

	req, _ := http.NewRequest(http.MethodDelete, "/api/logs/2024-01-15", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	h.DeleteLog(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
	}
}

func TestDeleteLog_InvalidDate(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	req, _ := http.NewRequest(http.MethodDelete, "/api/logs/notadate", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	h.DeleteLog(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

// ===== Stats =====

func TestStats_HappyPath(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Stats, http.MethodGet, "/api/stats", nil, cookie)
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
	}

	var stats map[string]any
	parseJSON(t, rr, &stats)
	if _, ok := stats["total_all_time"]; !ok {
		t.Error("missing total_all_time in stats")
	}
	if _, ok := stats["weekly_totals"]; !ok {
		t.Error("missing weekly_totals in stats")
	}
}

// ===== Logout =====

func TestLogout(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Logout, http.MethodPost, "/api/logout", nil, cookie)
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
	}

	// Second request with same cookie should fail
	rr = doRequest(t, h.Logs, http.MethodGet, "/api/logs", nil, cookie)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("after logout status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// ===== Data isolation =====

func TestDataIsolation(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	registerUser(t, h, "bob@test.com", "password456")
	aliceCookie := loginUser(t, h, "alice@test.com", "password123")
	bobCookie := loginUser(t, h, "bob@test.com", "password456")

	// Alice logs a drink
	doRequest(t, h.Logs, http.MethodPost, "/api/logs",
		jsonBody(t, map[string]any{"date": "2024-01-15", "drinks": 5}), aliceCookie)

	// Bob should see no logs
	rr := doRequest(t, h.Logs, http.MethodGet, "/api/logs", nil, bobCookie)
	var logs []any
	parseJSON(t, rr, &logs)
	if len(logs) != 0 {
		t.Errorf("bob should see 0 logs, got %d", len(logs))
	}
}

// ===== Delete account =====

func TestDeleteAccount(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	req, _ := http.NewRequest(http.MethodDelete, "/api/account", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	h.DeleteAccount(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
	}

	// Re-login should fail
	rr = doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"email": "alice@test.com", "password": "password123"}))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("login after delete: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// ===== Update profile =====

func TestUpdateProfile_HappyPath(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.UpdateProfile, http.MethodPut, "/api/account",
		jsonBody(t, map[string]string{"email": "alice2@test.com", "display_name": "Alice"}),
		cookie)
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
	}

	var data map[string]string
	parseJSON(t, rr, &data)
	if data["email"] != "alice2@test.com" {
		t.Errorf("email: got %q want alice2@test.com", data["email"])
	}
	if data["display_name"] != "Alice" {
		t.Errorf("display_name: got %q want Alice", data["display_name"])
	}
}

func TestUpdateProfile_InvalidEmail(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.UpdateProfile, http.MethodPut, "/api/account",
		jsonBody(t, map[string]string{"email": "notanemail"}),
		cookie)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestUpdateProfile_NoAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.UpdateProfile, http.MethodPut, "/api/account",
		jsonBody(t, map[string]string{"email": "alice@test.com"}))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// ===== Change password =====

func TestChangePassword_HappyPath(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.ChangePassword, http.MethodPut, "/api/account/password",
		jsonBody(t, map[string]string{"current_password": "password123", "new_password": "newpassword456"}),
		cookie)
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d (body: %s)", rr.Code, http.StatusOK, rr.Body.String())
	}

	// Old password should no longer work
	rr = doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"email": "alice@test.com", "password": "password123"}))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("old password should fail: got %d", rr.Code)
	}

	// New password should work
	rr = doRequest(t, h.Login, http.MethodPost, "/api/login",
		jsonBody(t, map[string]string{"email": "alice@test.com", "password": "newpassword456"}))
	if rr.Code != http.StatusOK {
		t.Errorf("new password should succeed: got %d", rr.Code)
	}
}

func TestChangePassword_WrongCurrentPassword(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.ChangePassword, http.MethodPut, "/api/account/password",
		jsonBody(t, map[string]string{"current_password": "wrongpassword", "new_password": "newpassword456"}),
		cookie)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestChangePassword_ShortNewPassword(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.ChangePassword, http.MethodPut, "/api/account/password",
		jsonBody(t, map[string]string{"current_password": "password123", "new_password": "short"}),
		cookie)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestChangePassword_NoAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.ChangePassword, http.MethodPut, "/api/account/password",
		jsonBody(t, map[string]string{"current_password": "p", "new_password": "newpassword456"}))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// ===== Me endpoint =====

func TestMe_HappyPath(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Me, http.MethodGet, "/api/me", nil, cookie)
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
	}
	var data map[string]string
	parseJSON(t, rr, &data)
	if data["email"] != "alice@test.com" {
		t.Errorf("email: got %q want alice@test.com", data["email"])
	}
}

func TestMe_NoAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Me, http.MethodGet, "/api/me", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestMe_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")
	rr := doRequest(t, h.Me, http.MethodPost, "/api/me", nil, cookie)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

// ===== Security headers and CORS middleware =====

func TestSecurityHeaders(t *testing.T) {
	h, _ := newTestHandler(t)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	h.SecurityHeaders(inner).ServeHTTP(rr, req)

	for _, hdr := range []string{"X-Content-Type-Options", "X-Frame-Options", "Content-Security-Policy"} {
		if rr.Header().Get(hdr) == "" {
			t.Errorf("missing header: %s", hdr)
		}
	}
}

func TestCORS_Options(t *testing.T) {
	h, _ := newTestHandler(t)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req, _ := http.NewRequest(http.MethodOptions, "/api/logs", nil)
	req.Header.Set("Origin", "http://localhost:8080")
	rr := httptest.NewRecorder()
	h.CORS(inner).ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusNoContent)
	}
}

func TestCORS_AllowsPUT(t *testing.T) {
	h, _ := newTestHandler(t)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req, _ := http.NewRequest(http.MethodPut, "/api/account", nil)
	rr := httptest.NewRecorder()
	h.CORS(inner).ServeHTTP(rr, req)
	if !strings.Contains(rr.Header().Get("Access-Control-Allow-Methods"), "PUT") {
		t.Error("CORS should allow PUT")
	}
}

func TestCORS_Normal(t *testing.T) {
	h, _ := newTestHandler(t)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req, _ := http.NewRequest(http.MethodGet, "/api/logs", nil)
	rr := httptest.NewRecorder()
	h.CORS(inner).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
	}
}

// ===== Additional edge cases =====

func TestLogin_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Login, http.MethodGet, "/api/login", nil)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestLogout_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Logout, http.MethodGet, "/api/logout", nil)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestLogout_NoAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	rr := doRequest(t, h.Logout, http.MethodPost, "/api/logout", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestLogs_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")
	rr := doRequest(t, h.Logs, http.MethodPut, "/api/logs", nil, cookie)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestStats_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")
	rr := doRequest(t, h.Stats, http.MethodPost, "/api/stats", nil, cookie)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestDeleteLog_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	req, _ := http.NewRequest(http.MethodGet, "/api/logs/2024-01-15", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	h.DeleteLog(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestDeleteLog_NoAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	req, _ := http.NewRequest(http.MethodDelete, "/api/logs/2024-01-15", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	rr := httptest.NewRecorder()
	h.DeleteLog(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestDeleteAccount_WrongMethod(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	req, _ := http.NewRequest(http.MethodGet, "/api/account", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	h.DeleteAccount(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestDeleteAccount_NoAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	req, _ := http.NewRequest(http.MethodDelete, "/api/account", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	rr := httptest.NewRecorder()
	h.DeleteAccount(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestCreateLog_NoteTooLong(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	longNote := make([]byte, 501)
	for i := range longNote {
		longNote[i] = 'x'
	}
	rr := doRequest(t, h.Logs, http.MethodPost, "/api/logs",
		jsonBody(t, map[string]any{"date": "2024-01-15", "drinks": 1, "note": string(longNote)}),
		cookie)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestCreateLog_TooManyDrinks(t *testing.T) {
	h, _ := newTestHandler(t)
	registerUser(t, h, "alice@test.com", "password123")
	cookie := loginUser(t, h, "alice@test.com", "password123")

	rr := doRequest(t, h.Logs, http.MethodPost, "/api/logs",
		jsonBody(t, map[string]any{"date": "2024-01-15", "drinks": 101}),
		cookie)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestClientIP_XForwardedFor(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "10.0.0.1, 10.0.0.2")
	ip := clientIP(req)
	if ip != "10.0.0.1" {
		t.Errorf("got %q want %q", ip, "10.0.0.1")
	}
}

func TestClientIP_RemoteAddr(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.168.1.100:54321"
	ip := clientIP(req)
	if ip != "192.168.1.100" {
		t.Errorf("got %q want %q", ip, "192.168.1.100")
	}
}

// ===== Rate limiter =====

func TestRateLimiter(t *testing.T) {
	rl := newRateLimiter()
	ip := "192.168.1.1"

	for i := 0; i < rateLimitMax; i++ {
		if !rl.allow(ip) {
			t.Errorf("request %d should be allowed", i+1)
		}
	}
	if rl.allow(ip) {
		t.Error("request after limit should be denied")
	}
}

func TestRateLimiter_DifferentIPs(t *testing.T) {
	rl := newRateLimiter()

	for i := 0; i < rateLimitMax; i++ {
		rl.allow("1.2.3.4")
	}
	// Different IP should still work
	if !rl.allow("5.6.7.8") {
		t.Error("different IP should be allowed")
	}
}
