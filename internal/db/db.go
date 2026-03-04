package db

import (
	"database/sql"
	"fmt"
	"math"
	"time"

	"github.com/c-mco/itspartyti.me/internal/models"
	_ "modernc.org/sqlite"
)

type DB struct {
	conn *sql.DB
}

type dayRecord struct {
	date   string
	drinks int
}

func New(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	conn.SetMaxOpenConns(1)

	d := &DB{conn: conn}
	if err := d.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

func (d *DB) Close() error {
	return d.conn.Close()
}

func (d *DB) migrate() error {
	_, err := d.conn.Exec(`PRAGMA journal_mode=WAL;`)
	if err != nil {
		return err
	}

	_, err = d.conn.Exec(`PRAGMA foreign_keys=ON;`)
	if err != nil {
		return err
	}

	_, err = d.conn.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS logs (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id),
			date TEXT NOT NULL,
			drinks INTEGER NOT NULL DEFAULT 0,
			note TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, date)
		);

		CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id),
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_logs_user_date ON logs(user_id, date);
		CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
	`)
	if err != nil {
		return err
	}

	// Safe additive migrations — ignore error if column already exists
	d.conn.Exec(`ALTER TABLE users ADD COLUMN display_name TEXT`)

	return nil
}

// User operations

func (d *DB) CreateUser(u *models.User) error {
	_, err := d.conn.Exec(
		`INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)`,
		u.ID, u.Email, u.PasswordHash, u.DisplayName,
	)
	return err
}

// GetUserByEmail looks up a user by their email (stored in the 'username' column).
func (d *DB) GetUserByEmail(email string) (*models.User, error) {
	u := &models.User{}
	err := d.conn.QueryRow(
		`SELECT id, username, COALESCE(display_name,''), password_hash, created_at FROM users WHERE username = ?`,
		email,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (d *DB) GetUserByID(id string) (*models.User, error) {
	u := &models.User{}
	err := d.conn.QueryRow(
		`SELECT id, username, COALESCE(display_name,''), password_hash, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

// UpdateUserProfile updates the email and display name for the given user.
func (d *DB) UpdateUserProfile(userID, email, displayName string) error {
	_, err := d.conn.Exec(
		`UPDATE users SET username = ?, display_name = ? WHERE id = ?`,
		email, displayName, userID,
	)
	return err
}

// UpdateUserPassword replaces the password hash for the given user.
func (d *DB) UpdateUserPassword(userID, hash string) error {
	_, err := d.conn.Exec(
		`UPDATE users SET password_hash = ? WHERE id = ?`,
		hash, userID,
	)
	return err
}

func (d *DB) DeleteUser(userID string) error {
	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM sessions WHERE user_id = ?`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM logs WHERE user_id = ?`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM users WHERE id = ?`, userID); err != nil {
		return err
	}
	return tx.Commit()
}

// Session operations

func (d *DB) CreateSession(s *models.Session) error {
	_, err := d.conn.Exec(
		`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
		s.Token, s.UserID, s.ExpiresAt,
	)
	return err
}

func (d *DB) GetSession(token string) (*models.Session, error) {
	s := &models.Session{}
	err := d.conn.QueryRow(
		`SELECT token, user_id, expires_at, created_at FROM sessions WHERE token = ?`,
		token,
	).Scan(&s.Token, &s.UserID, &s.ExpiresAt, &s.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

func (d *DB) DeleteSession(token string) error {
	_, err := d.conn.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func (d *DB) CleanExpiredSessions() error {
	_, err := d.conn.Exec(`DELETE FROM sessions WHERE expires_at < ?`, time.Now())
	return err
}

// Log operations

func (d *DB) UpsertLog(l *models.Log) error {
	_, err := d.conn.Exec(
		`INSERT INTO logs (id, user_id, date, drinks, note)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, date) DO UPDATE SET
		   drinks = excluded.drinks,
		   note = excluded.note`,
		l.ID, l.UserID, l.Date, l.Drinks, l.Note,
	)
	return err
}

func (d *DB) GetLogs(userID string) ([]*models.Log, error) {
	rows, err := d.conn.Query(
		`SELECT id, user_id, date, drinks, note, created_at FROM logs WHERE user_id = ? ORDER BY date DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*models.Log
	for rows.Next() {
		l := &models.Log{}
		if err := rows.Scan(&l.ID, &l.UserID, &l.Date, &l.Drinks, &l.Note, &l.CreatedAt); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

func (d *DB) DeleteLog(userID, date string) error {
	_, err := d.conn.Exec(
		`DELETE FROM logs WHERE user_id = ? AND date = ?`,
		userID, date,
	)
	return err
}

// IncrementDrinks atomically adds 1 to the drink count for the given date,
// creating a log entry if none exists. Returns the new count.
func (d *DB) IncrementDrinks(userID, date, newID string) (int, error) {
	tx, err := d.conn.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO logs (id, user_id, date, drinks, note)
		VALUES (?, ?, ?, 1, '')
		ON CONFLICT(user_id, date) DO UPDATE SET drinks = drinks + 1
	`, newID, userID, date)
	if err != nil {
		return 0, err
	}

	var drinks int
	if err := tx.QueryRow(`SELECT drinks FROM logs WHERE user_id = ? AND date = ?`, userID, date).Scan(&drinks); err != nil {
		return 0, err
	}

	return drinks, tx.Commit()
}

// Stats operations

func (d *DB) GetStats(userID string) (*models.Stats, error) {
	now := time.Now()
	today := now.Format("2006-01-02")

	// Week starts on Monday
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	weekStart := now.AddDate(0, 0, -(weekday - 1)).Format("2006-01-02")
	monthStart := now.Format("2006-01") + "-01"

	// Aggregated counts
	var totalWeek, totalMonth, totalAll int
	var drinkingDays int

	err := d.conn.QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN date >= ? THEN drinks ELSE 0 END), 0) as week,
			COALESCE(SUM(CASE WHEN date >= ? THEN drinks ELSE 0 END), 0) as month,
			COALESCE(SUM(drinks), 0) as all_time,
			COALESCE(SUM(CASE WHEN drinks > 0 THEN 1 ELSE 0 END), 0) as drinking_days
		FROM logs
		WHERE user_id = ?
	`, weekStart, monthStart, userID).Scan(&totalWeek, &totalMonth, &totalAll, &drinkingDays)
	if err != nil {
		return nil, err
	}

	var avgDrinking float64
	if drinkingDays > 0 {
		avgDrinking = float64(totalAll) / float64(drinkingDays)
		avgDrinking = math.Round(avgDrinking*10) / 10
	}

	// Streaks: fetch all log dates ordered by date desc to calculate current streak
	// and all dates for longest streak
	rows, err := d.conn.Query(
		`SELECT date, drinks FROM logs WHERE user_id = ? ORDER BY date DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []dayRecord
	for rows.Next() {
		var r dayRecord
		if err := rows.Scan(&r.date, &r.drinks); err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	currentStreak, longestStreak := calculateStreaks(records, today)

	// pct_sober_days: treat all calendar days from first log to today as tracked.
	// Unlogged days count as sober, consistent with streak logic.
	var pctSober float64
	if len(records) > 0 {
		earliest := parseDate(records[len(records)-1].date)
		todayDate := parseDate(today)
		totalCalendarDays := int(todayDate.Sub(earliest).Hours()/24) + 1
		soberDays := totalCalendarDays - drinkingDays
		if soberDays < 0 {
			soberDays = 0
		}
		pctSober = math.Round(float64(soberDays)/float64(totalCalendarDays)*100*10) / 10
	}

	// Weekly totals for last 12 weeks
	weeklyTotals, err := d.getWeeklyTotals(userID, now)
	if err != nil {
		return nil, err
	}

	return &models.Stats{
		TotalThisWeek:   totalWeek,
		TotalThisMonth:  totalMonth,
		TotalAllTime:    totalAll,
		CurrentStreak:   currentStreak,
		LongestStreak:   longestStreak,
		AvgDrinkingDays: avgDrinking,
		PctSoberDays:    pctSober,
		WeeklyTotals:    weeklyTotals,
	}, nil
}

func calculateStreaks(records []dayRecord, today string) (current, longest int) {
	// records sorted DESC by date
	if len(records) == 0 {
		return 0, 0
	}

	// Build a map for O(1) lookup
	drinkMap := make(map[string]int)
	for _, r := range records {
		drinkMap[r.date] = r.drinks
	}

	// Earliest logged date — don't count beyond it
	earliestDate := records[len(records)-1].date

	// Current sober streak: walk backwards from today.
	// Unlogged days are treated as sober (0 drinks) — the user shouldn't have
	// to log a zero to keep their streak alive. We stop only when we hit a
	// drinking day or go before the earliest log.
	current = 0
	d := parseDate(today)
	for {
		dateStr := d.Format("2006-01-02")
		if dateStr < earliestDate {
			break
		}
		drinks := drinkMap[dateStr] // 0 if unlogged (map zero value)
		if drinks == 0 {
			current++
			d = d.AddDate(0, 0, -1)
		} else {
			break
		}
	}

	// Longest sober streak: walk every calendar day from earliest log to today,
	// treating unlogged days as sober (same philosophy as current streak above).
	longest = 0
	cur := 0
	earliest := parseDate(earliestDate)
	todayDate := parseDate(today)
	for t := earliest; !t.After(todayDate); t = t.AddDate(0, 0, 1) {
		if drinkMap[t.Format("2006-01-02")] == 0 {
			cur++
			if cur > longest {
				longest = cur
			}
		} else {
			cur = 0
		}
	}

	return current, longest
}

func parseDate(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func (d *DB) getWeeklyTotals(userID string, now time.Time) ([]models.WeeklyTotal, error) {
	// Get Monday of current week
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	currentMonday := now.AddDate(0, 0, -(weekday - 1))

	// Go back 11 more weeks (12 total)
	start := currentMonday.AddDate(0, 0, -77)
	startStr := start.Format("2006-01-02")
	endStr := now.Format("2006-01-02")

	rows, err := d.conn.Query(`
		SELECT date, drinks FROM logs
		WHERE user_id = ? AND date >= ? AND date <= ?
		ORDER BY date ASC
	`, userID, startStr, endStr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Build week buckets
	weekTotals := make(map[string]int)
	var weekStarts []string
	for i := 0; i < 12; i++ {
		ws := currentMonday.AddDate(0, 0, -(11-i)*7).Format("2006-01-02")
		weekTotals[ws] = 0
		weekStarts = append(weekStarts, ws)
	}

	for rows.Next() {
		var date string
		var drinks int
		if err := rows.Scan(&date, &drinks); err != nil {
			return nil, err
		}
		// Find which week bucket this date belongs to
		t := parseDate(date)
		wd := int(t.Weekday())
		if wd == 0 {
			wd = 7
		}
		monday := t.AddDate(0, 0, -(wd - 1)).Format("2006-01-02")
		if _, ok := weekTotals[monday]; ok {
			weekTotals[monday] += drinks
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]models.WeeklyTotal, 0, 12)
	for _, ws := range weekStarts {
		result = append(result, models.WeeklyTotal{
			WeekStart: ws,
			Total:     weekTotals[ws],
		})
	}
	return result, nil
}
