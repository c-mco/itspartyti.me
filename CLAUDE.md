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

### Streak logic (backend only)

`calculateStreaks` in `db.go` walks calendar days (not just logged days). **Unlogged days are treated as sober** — the user doesn't need to log a zero to keep their streak alive. This is intentional and consistent across streak calculation and `pct_sober_days`. Do not change this behaviour without explicit instruction.

Note: per the UI rebuild (see `UI_IDEAS.md`), streaks are no longer surfaced in the UI. The backend calculation stays as-is — it may be used for internal logic or future features — but no new UI should display a streak count.

## Design conventions

See `UI_IDEAS.md` for the full UI spec. Key invariants for code working in `cmd/server/frontend/`:

- The dot grid is the home screen. Traffic-light colour ramp. **No numbers on cells** — counts live only in the magnify label and the bloom card.
- **Logged-zero vs. unlogged** is communicated by *shape*, not colour: filled soft-green dot vs. hollow ring. Backend treatment is identical.
- **Today's dot** has a persistent ring affordance.
- **Selection split by input device**: mouse = click to open a dot; touch = scrub to magnify, release-over-dot to open. Drag off-grid cancels.
- **Neighbourhood magnify** (dock-style) on hover/scrub. On touch, the magnified dot and floating label are **offset above the finger** so the thumb never occludes them. Respect `prefers-reduced-motion`.
- **Bloom-in-place editor** — opening a dot expands it inline. Auto-save on blur or after 800ms of inactivity. No Save button. Use `aria-live="polite"` for the `saved ✓` indicator.
- **Grid orientation A/B/C prototype**: build the grid as a single component that takes `orientation` (`horizontal | vertical`) and `range` (`year | rolling26`) props. Render all three layouts behind a hidden URL param: `?layout=A` (year, weeks-as-columns), `?layout=B` (year, weeks-as-rows), `?layout=C` (rolling 26 weeks with "see more"). Same data, three layouts, judged with real pixels.
- **Settings live behind a small avatar/initial in the corner**, opening a sheet on mobile / popover on desktop. Includes account actions and a Settings section (first toggle: "Auto-open today when I've been away", on by default).
- Week starts on Monday throughout (backend stats and frontend display).
- No Chart.js, no framework, no build step. Vanilla only.
