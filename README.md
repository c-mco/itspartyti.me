# itspartyti.me

A personal drink tracking web app. Log your daily alcohol consumption, visualise it as a heatmap calendar, and view personal stats — streaks, averages, weekly trends.

Multi-user, self-hosted, no analytics, no tracking.

## Features

- Monthly heatmap calendar (green → yellow → orange → red)
- Current and longest sober streaks
- Weekly trend bar chart (last 12 weeks)
- Per-user data isolation
- Responsive, mobile-first UI
- No external fonts or trackers (Chart.js via CDN only)

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
- **Frontend**: Vanilla HTML/CSS/JS, no build step
- **Charts**: Chart.js via CDN

## Security

- Passwords hashed with bcrypt (cost 12)
- Session tokens: 32-byte cryptographically random, stored server-side, 30-day expiry
- Rate limiting on register/login (10 req/min per IP)
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options
- All queries parameterised — no string concatenation
- User data strictly isolated at query level
