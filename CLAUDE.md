# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the server (default port 8080)
go run ./cmd/server

# Run all tests
go test ./...

# Run a single test
go test ./internal/db/... -run TestCalculateStreaks

# Coverage report
go test ./internal/... -cover

# Build for production
go build -o bin/server ./cmd/server
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `DB_PATH` | `./data/itspartyti.me.db` | SQLite database path |
| `ORIGIN` | `http://localhost:$PORT` | Allowed CORS origin |
| `ENV` | `development` | Set to `production` for HSTS + strict cookies |

## Architecture

**Single binary, no build step.** The Go server embeds the entire frontend (`cmd/server/frontend/`) at compile time via `//go:embed`. There is no JS bundler or transpiler.

### Request flow

```
HTTP request
  → h.CORS → h.SecurityHeaders
  → mux (stdlib net/http)
  → handlers.Handler method
  → db.DB method
  → SQLite (modernc.org/sqlite, pure Go, no CGo)
```

### Package layout

- `cmd/server/main.go` — entry point, route registration, session cleanup goroutine
- `internal/models/` — plain data structs (User, Log, Session, Stats, WeeklyTotal)
- `internal/db/db.go` — all DB logic: schema migration, CRUD, streak and stats calculation
- `internal/handlers/handlers.go` — all HTTP handlers, CORS/security middleware, rate limiter
- `cmd/server/frontend/` — index.html, style.css, app.js (served as embedded static files)

### Database schema

Three tables: `users`, `logs`, `sessions`. The `username` column in `users` stores the email (legacy naming — do not rename). `display_name` was added via a safe additive migration and may be empty. Migrations run at startup; new columns should follow the `d.conn.Exec(ALTER TABLE ... ADD COLUMN ...)` pattern (errors silently ignored if column already exists).

### Auth

Cookie-based sessions (`session` cookie, HttpOnly, 30-day expiry). `requireAuth` validates the cookie and returns the session; handlers abort with 401 if nil. Rate limiting (10 req/min per IP) is applied to `/api/register` and `/api/login`.

### Streak logic

`calculateStreaks` in `db.go` walks calendar days (not just logged days). **Unlogged days are treated as sober** — the user doesn't need to log a zero to keep their streak alive. This is intentional and consistent across streak calculation and `pct_sober_days`. Do not change this behaviour without explicit instruction.

## Design conventions

- Deep indigo dark theme, sharp corners (`--r: 2px`), vibrant cell fills
- Color-only data encoding on the year grid — drink counts are not displayed as numbers
- The scrub gesture on the year grid is intentionally undiscoverable (no tooltip/hint)
- Week starts on Monday throughout (both backend stats and frontend display)
