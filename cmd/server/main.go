package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/c-mco/itspartyti.me/internal/db"
	"github.com/c-mco/itspartyti.me/internal/handlers"
)

//go:embed frontend
var frontendFS embed.FS

func main() {
	port := getenv("PORT", "8080")
	dbPath := getenv("DB_PATH", "./data/itspartyti.me.db")
	origin := getenv("ORIGIN", "http://localhost:"+port)
	env := getenv("ENV", "development")
	isProd := env == "production"

	// Ensure data directory exists
	if err := os.MkdirAll("./data", 0750); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	database, err := db.New(dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	h := handlers.New(database, origin, isProd)

	// Periodic session cleanup
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := database.CleanExpiredSessions(); err != nil {
				log.Printf("clean sessions: %v", err)
			}
		}
	}()

	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/register", h.Register)
	mux.HandleFunc("/api/login", h.Login)
	mux.HandleFunc("/api/logout", h.Logout)
	mux.HandleFunc("/api/logs", h.Logs)
	mux.HandleFunc("/api/logs/", h.DeleteLog)
	mux.HandleFunc("/api/stats", h.Stats)
	mux.HandleFunc("/api/me", h.Me)
	mux.HandleFunc("/api/account", h.DeleteAccount)
	mux.HandleFunc("/api/drinks/add", h.AddDrink)

	// Frontend static files
	sub, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		log.Fatalf("embed frontend: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("/", cacheHeaders(fileServer))

	handler := h.CORS(h.SecurityHeaders(mux))

	addr := ":" + port
	log.Printf("starting server on %s (env=%s)", addr, env)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func cacheHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// HTML: no cache
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		} else {
			// CSS/JS: cache for 1 hour
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		next.ServeHTTP(w, r)
	})
}
