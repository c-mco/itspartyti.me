package db

import (
	"os"
	"testing"
	"time"

	"github.com/c-mco/itspartyti.me/internal/models"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	f, err := os.CreateTemp("", "test-*.db")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	f.Close()
	t.Cleanup(func() { os.Remove(f.Name()) })

	d, err := New(f.Name())
	if err != nil {
		t.Fatalf("new db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestCreateAndGetUser(t *testing.T) {
	d := newTestDB(t)

	u := &models.User{
		ID:           "user1",
		Email:        "alice@test.com",
		PasswordHash: "hash",
	}
	if err := d.CreateUser(u); err != nil {
		t.Fatalf("create user: %v", err)
	}

	got, err := d.GetUserByEmail("alice@test.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if got == nil {
		t.Fatal("expected user, got nil")
	}
	if got.ID != u.ID || got.Email != u.Email {
		t.Errorf("user mismatch: got %+v want %+v", got, u)
	}
}

func TestGetUserByEmail_NotFound(t *testing.T) {
	d := newTestDB(t)
	got, err := d.GetUserByEmail("nobody@test.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestDuplicateEmail(t *testing.T) {
	d := newTestDB(t)
	u := &models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"}
	if err := d.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	u2 := &models.User{ID: "u2", Email: "alice@test.com", PasswordHash: "h"}
	if err := d.CreateUser(u2); err == nil {
		t.Error("expected unique constraint error")
	}
}

func TestSessionLifecycle(t *testing.T) {
	d := newTestDB(t)
	u := &models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"}
	_ = d.CreateUser(u)

	s := &models.Session{
		Token:     "tok123",
		UserID:    "u1",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := d.CreateSession(s); err != nil {
		t.Fatalf("create session: %v", err)
	}

	got, err := d.GetSession("tok123")
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if got == nil || got.UserID != "u1" {
		t.Errorf("session mismatch: %+v", got)
	}

	if err := d.DeleteSession("tok123"); err != nil {
		t.Fatalf("delete session: %v", err)
	}

	got, err = d.GetSession("tok123")
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Error("expected nil after delete")
	}
}

func TestUpsertLog(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"})

	l := &models.Log{ID: "l1", UserID: "u1", Date: "2024-01-15", Drinks: 2, Note: "beer"}
	if err := d.UpsertLog(l); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Update
	l2 := &models.Log{ID: "l2", UserID: "u1", Date: "2024-01-15", Drinks: 5, Note: "more"}
	if err := d.UpsertLog(l2); err != nil {
		t.Fatalf("upsert update: %v", err)
	}

	logs, err := d.GetLogs("u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Errorf("expected 1 log, got %d", len(logs))
	}
	if logs[0].Drinks != 5 {
		t.Errorf("expected drinks=5, got %d", logs[0].Drinks)
	}
}

func TestDeleteLog(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"})
	_ = d.UpsertLog(&models.Log{ID: "l1", UserID: "u1", Date: "2024-01-15", Drinks: 2})

	if err := d.DeleteLog("u1", "2024-01-15"); err != nil {
		t.Fatal(err)
	}
	logs, _ := d.GetLogs("u1")
	if len(logs) != 0 {
		t.Errorf("expected 0 logs, got %d", len(logs))
	}
}

func TestDeleteUser(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"})
	_ = d.UpsertLog(&models.Log{ID: "l1", UserID: "u1", Date: "2024-01-15", Drinks: 2})
	_ = d.CreateSession(&models.Session{Token: "tok", UserID: "u1", ExpiresAt: time.Now().Add(time.Hour)})

	if err := d.DeleteUser("u1"); err != nil {
		t.Fatal(err)
	}

	u, _ := d.GetUserByID("u1")
	if u != nil {
		t.Error("expected user deleted")
	}
}

func TestGetStats_Empty(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"})

	stats, err := d.GetStats("u1")
	if err != nil {
		t.Fatalf("get stats: %v", err)
	}
	if stats.TotalAllTime != 0 {
		t.Errorf("expected 0, got %d", stats.TotalAllTime)
	}
	if len(stats.WeeklyTotals) != 12 {
		t.Errorf("expected 12 weekly totals, got %d", len(stats.WeeklyTotals))
	}
}

func TestGetStats_WithData(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"})

	logs := []models.Log{
		{ID: "l1", UserID: "u1", Date: "2024-01-01", Drinks: 3},
		{ID: "l2", UserID: "u1", Date: "2024-01-02", Drinks: 0},
		{ID: "l3", UserID: "u1", Date: "2024-01-03", Drinks: 0},
		{ID: "l4", UserID: "u1", Date: "2024-01-05", Drinks: 5},
	}
	for i := range logs {
		_ = d.UpsertLog(&logs[i])
	}

	stats, err := d.GetStats("u1")
	if err != nil {
		t.Fatalf("get stats: %v", err)
	}
	if stats.TotalAllTime != 8 {
		t.Errorf("total all time: got %d want 8", stats.TotalAllTime)
	}
}

func TestUpdateUserProfile(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"})

	if err := d.UpdateUserProfile("u1", "newalice@test.com", "Alice Smith"); err != nil {
		t.Fatalf("update profile: %v", err)
	}

	u, err := d.GetUserByID("u1")
	if err != nil || u == nil {
		t.Fatal("get user after update failed")
	}
	if u.Email != "newalice@test.com" {
		t.Errorf("email: got %q want newalice@test.com", u.Email)
	}
	if u.DisplayName != "Alice Smith" {
		t.Errorf("display_name: got %q want Alice Smith", u.DisplayName)
	}
}

func TestUpdateUserPassword(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "oldhash"})

	if err := d.UpdateUserPassword("u1", "newhash"); err != nil {
		t.Fatalf("update password: %v", err)
	}

	u, _ := d.GetUserByID("u1")
	if u.PasswordHash != "newhash" {
		t.Errorf("password hash not updated")
	}
}

func TestCalculateStreaks(t *testing.T) {
	tests := []struct {
		name    string
		records []dayRecord
		today   string
		wantCur int
		wantLng int
	}{
		{
			name:    "empty",
			records: nil,
			today:   "2024-01-10",
			wantCur: 0,
			wantLng: 0,
		},
		{
			name: "consecutive sober days ending today",
			records: []dayRecord{
				{"2024-01-10", 0},
				{"2024-01-09", 0},
				{"2024-01-08", 0},
			},
			today:   "2024-01-10",
			wantCur: 3,
			wantLng: 3,
		},
		{
			name: "broken by drinking",
			records: []dayRecord{
				{"2024-01-10", 0},
				{"2024-01-09", 2},
				{"2024-01-08", 0},
				{"2024-01-07", 0},
			},
			today:   "2024-01-10",
			wantCur: 1,
			wantLng: 2,
		},
		{
			name: "today is drinking day",
			records: []dayRecord{
				{"2024-01-10", 3},
				{"2024-01-09", 0},
				{"2024-01-08", 0},
			},
			today:   "2024-01-10",
			wantCur: 0,
			wantLng: 2,
		},
		{
			// Unlogged days between two drinking days should count as sober.
			// Jan 8 = drink, Jan 9+10 unlogged (sober), Jan 11 = drink.
			// Longest sober run = 2 (Jan 9+10). Current = 0 (today is a drink day).
			name: "unlogged gap days treated as sober",
			records: []dayRecord{
				{"2024-01-11", 3},
				{"2024-01-08", 3},
			},
			today:   "2024-01-11",
			wantCur: 0,
			wantLng: 2,
		},
		{
			// Only drinking days logged, large gap — longest streak is the gap.
			// Jan 1 = drink, Jan 8 = drink, gap Jan 2–7 = 6 sober days.
			name: "large gap between drinking days",
			records: []dayRecord{
				{"2024-01-08", 2},
				{"2024-01-01", 2},
			},
			today:   "2024-01-08",
			wantCur: 0,
			wantLng: 6,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cur, lng := calculateStreaks(tc.records, tc.today)
			if cur != tc.wantCur {
				t.Errorf("current streak: got %d want %d", cur, tc.wantCur)
			}
			if lng != tc.wantLng {
				t.Errorf("longest streak: got %d want %d", lng, tc.wantLng)
			}
		})
	}
}

func TestCleanExpiredSessions(t *testing.T) {
	d := newTestDB(t)
	_ = d.CreateUser(&models.User{ID: "u1", Email: "alice@test.com", PasswordHash: "h"})

	_ = d.CreateSession(&models.Session{
		Token:     "expired",
		UserID:    "u1",
		ExpiresAt: time.Now().Add(-time.Hour),
	})
	_ = d.CreateSession(&models.Session{
		Token:     "valid",
		UserID:    "u1",
		ExpiresAt: time.Now().Add(time.Hour),
	})

	if err := d.CleanExpiredSessions(); err != nil {
		t.Fatal(err)
	}

	got, _ := d.GetSession("expired")
	if got != nil {
		t.Error("expired session not cleaned")
	}
	got, _ = d.GetSession("valid")
	if got == nil {
		t.Error("valid session deleted")
	}
}
