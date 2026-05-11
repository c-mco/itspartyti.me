# itspartyti.me

A personal drink tracking web app. Log your daily alcohol consumption and recognise your own patterns on a dense, year-at-a-glance dot grid.

Multi-user, self-hosted, no analytics, no tracking. The app is a mirror, not a judge.

## Features

- **Dot grid heatmap** as the home screen — one dot per day, traffic-light colour ramp (green → yellow → orange → red)
- **Hollow ring for unlogged days vs. filled dot for logged-zero days** — same backend treatment, honest visual distinction
- **Today's dot has a persistent ring** so you always know where you are
- **A/B/C layout prototypes** available via `?layout=A|B|C` (year horizontal, year vertical, rolling 26 weeks)
- **Keyboard-friendly grid navigation** with roving tabindex + arrow/Home/End support
- Per-user data isolation, light + dark themes via `prefers-color-scheme`
- Responsive, mobile-first UI
- No external fonts, no trackers, no third-party JS, no build step

## In progress

- Bloom-in-place editor for per-day entries
- Magnify-on-scrub browsing with thumb offset on touch
- Auto-open today setting in account/settings UI

## Running locally

```bash
git clone https://github.com/c-mco/itspartyti.me
cd itspartyti.me

go run ./cmd/server
```

The server starts on `http://localhost:8080` by default.

## Building for production

```bash
go build -o bin/server ./cmd/server
./bin/server
```

Set environment variables for production:

```bash
PORT=443 ENV=production DB_PATH=/var/data/itspartyti.me.db ./bin/server
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `DB_PATH` | `./data/itspartyti.me.db` | Path to SQLite database file |
| `ORIGIN` | `http://localhost:$PORT` | Allowed CORS origin (set to your domain in production) |
| `ENV` | `development` | Set to `production` to enable HSTS and strict cookie settings |

## Running tests

```bash
go test ./...
```

Coverage report:

```bash
go test ./internal/... -cover
```

## Stack

- **Backend**: Go standard library + `modernc.org/sqlite` (pure Go, no CGo)
- **Database**: SQLite with WAL mode
- **Frontend**: Vanilla HTML/CSS/JS, no build step, no framework, no bundler, no node_modules

## Security

- Passwords hashed with bcrypt (cost 12)
- Session tokens: 32-byte cryptographically random, stored server-side, 30-day expiry
- Rate limiting on register/login (10 req/min per IP)
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options
- All queries parameterised — no string concatenation
- User data strictly isolated at query level
