package models

import "time"

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type Log struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Date      string    `json:"date"`
	Drinks    int       `json:"drinks"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type Session struct {
	Token     string    `json:"token"`
	UserID    string    `json:"user_id"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Stats struct {
	TotalThisWeek    int     `json:"total_this_week"`
	TotalThisMonth   int     `json:"total_this_month"`
	TotalAllTime     int     `json:"total_all_time"`
	CurrentStreak    int     `json:"current_streak"`
	LongestStreak    int     `json:"longest_streak"`
	AvgDrinkingDays  float64 `json:"avg_drinking_days"`
	PctSoberDays     float64 `json:"pct_sober_days"`
	WeeklyTotals     []WeeklyTotal `json:"weekly_totals"`
}

type WeeklyTotal struct {
	WeekStart string `json:"week_start"`
	Total     int    `json:"total"`
}
