/**
 * app.test.mjs — unit tests for the pure functions in app.js
 *
 * Run with:  node cmd/server/frontend/app.test.mjs
 *
 * No npm. No build step. Node 18+ required (ESM + built-in test runner).
 */

import {
  isoDate,
  parseIsoDate,
  mondayIndex,
  startOfDay,
  mondayOnOrBefore,
  longDate,
  clampDrinkCount,
  normalizeEntry,
  countSummary,
  seededRand,
  mockEntry,
  buildDays,
  ariaForDay,
  bucketFor,
  magnifyWeight,
  computeMagnifyLevels,
  daysBetween,
  lastLoggedText,
  displayInitial,
  logsToEntries,
} from './app.js';

// ---------------------------------------------------------------------------
// Minimal harness — no dependencies.
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ name, err });
    // Don't re-throw — run all tests.
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      `${msg ?? 'assertion failed'}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(
      `${msg ?? 'deep equality failed'}\n  expected: ${b}\n  actual:   ${a}`,
    );
  }
}

function assertTrue(value, msg) {
  if (!value) throw new Error(msg ?? `expected truthy, got ${value}`);
}

function assertRange(value, min, max, msg) {
  if (value < min || value >= max) {
    throw new Error(
      `${msg ?? 'range check failed'}: expected [${min}, ${max}), got ${value}`,
    );
  }
}

// ---------------------------------------------------------------------------
// isoDate
// ---------------------------------------------------------------------------

test('isoDate: standard date', () => {
  const d = new Date(2024, 0, 15); // Jan 15, 2024
  assertEqual(isoDate(d), '2024-01-15');
});

test('isoDate: leap day', () => {
  const d = new Date(2024, 1, 29); // Feb 29, 2024
  assertEqual(isoDate(d), '2024-02-29');
});

test('isoDate: year-end', () => {
  const d = new Date(2023, 11, 31); // Dec 31, 2023
  assertEqual(isoDate(d), '2023-12-31');
});

test('isoDate: single-digit month and day get padded', () => {
  const d = new Date(2025, 8, 5); // Sep 5, 2025
  assertEqual(isoDate(d), '2025-09-05');
});

// ---------------------------------------------------------------------------
// mondayIndex
// ---------------------------------------------------------------------------

test('mondayIndex: Monday → 0', () => {
  // 2024-01-08 is a known Monday
  const d = new Date(2024, 0, 8);
  assertEqual(mondayIndex(d), 0);
});

test('mondayIndex: Tuesday → 1', () => {
  const d = new Date(2024, 0, 9);
  assertEqual(mondayIndex(d), 1);
});

test('mondayIndex: Wednesday → 2', () => {
  const d = new Date(2024, 0, 10);
  assertEqual(mondayIndex(d), 2);
});

test('mondayIndex: Thursday → 3', () => {
  const d = new Date(2024, 0, 11);
  assertEqual(mondayIndex(d), 3);
});

test('mondayIndex: Friday → 4', () => {
  const d = new Date(2024, 0, 12);
  assertEqual(mondayIndex(d), 4);
});

test('mondayIndex: Saturday → 5', () => {
  const d = new Date(2024, 0, 13);
  assertEqual(mondayIndex(d), 5);
});

test('mondayIndex: Sunday → 6', () => {
  const d = new Date(2024, 0, 14);
  assertEqual(mondayIndex(d), 6);
});

// ---------------------------------------------------------------------------
// startOfDay
// ---------------------------------------------------------------------------

test('startOfDay: resets time to midnight', () => {
  const d = new Date(2024, 0, 15, 18, 30, 45, 999);
  const s = startOfDay(d);
  assertEqual(s.getHours(), 0);
  assertEqual(s.getMinutes(), 0);
  assertEqual(s.getSeconds(), 0);
  assertEqual(s.getMilliseconds(), 0);
});

test('startOfDay: does not mutate the input', () => {
  const d = new Date(2024, 0, 15, 14, 0, 0);
  startOfDay(d);
  assertEqual(d.getHours(), 14, 'input should not be mutated');
});

test('startOfDay: date is preserved', () => {
  const d = new Date(2024, 1, 29, 23, 59, 59);
  const s = startOfDay(d);
  assertEqual(s.getDate(), 29);
  assertEqual(s.getMonth(), 1);
  assertEqual(s.getFullYear(), 2024);
});

// ---------------------------------------------------------------------------
// mondayOnOrBefore
// ---------------------------------------------------------------------------

test('mondayOnOrBefore: Monday returns self', () => {
  // 2024-01-08 is a Monday
  const monday = new Date(2024, 0, 8, 12, 0, 0);
  const result = mondayOnOrBefore(monday);
  assertEqual(result.getDate(), 8);
  assertEqual(result.getMonth(), 0);
  assertEqual(mondayIndex(result), 0, 'result must be a Monday');
});

test('mondayOnOrBefore: Tuesday returns previous Monday', () => {
  const tuesday = new Date(2024, 0, 9);
  const result = mondayOnOrBefore(tuesday);
  assertEqual(result.getDate(), 8, 'should be Jan 8');
  assertEqual(mondayIndex(result), 0);
});

test('mondayOnOrBefore: Sunday returns 6 days earlier', () => {
  // 2024-01-14 is a Sunday
  const sunday = new Date(2024, 0, 14);
  const result = mondayOnOrBefore(sunday);
  assertEqual(result.getDate(), 8, 'should be Jan 8 (the Monday 6 days before)');
  assertEqual(mondayIndex(result), 0);
});

test('mondayOnOrBefore: result is always a Monday', () => {
  // Test every day of a week
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(2024, 0, 8 + offset); // Jan 8 (Mon) through Jan 14 (Sun)
    const result = mondayOnOrBefore(d);
    assertEqual(mondayIndex(result), 0, `offset ${offset}: result must be Monday`);
  }
});

test('mondayOnOrBefore: result is at or before input', () => {
  const d = new Date(2024, 0, 13); // Saturday
  const result = mondayOnOrBefore(d);
  assertTrue(result <= d, 'result should be on or before the input date');
});

// ---------------------------------------------------------------------------
// longDate
// ---------------------------------------------------------------------------

test('longDate: formats a known Monday', () => {
  // 2024-01-08 is a Monday
  const d = new Date(2024, 0, 8);
  assertEqual(longDate(d), 'Monday 8 January 2024');
});

test('longDate: formats a known Friday', () => {
  // 2024-01-12 is a Friday
  const d = new Date(2024, 0, 12);
  assertEqual(longDate(d), 'Friday 12 January 2024');
});

test('longDate: December date', () => {
  const d = new Date(2023, 11, 31); // Dec 31, 2023 — Sunday
  assertEqual(longDate(d), 'Sunday 31 December 2023');
});

// ---------------------------------------------------------------------------
// parseIsoDate / clampDrinkCount / normalizeEntry / countSummary
// ---------------------------------------------------------------------------

test('parseIsoDate: parses YYYY-MM-DD in local calendar terms', () => {
  const d = parseIsoDate('2026-05-11');
  assertEqual(d.getFullYear(), 2026);
  assertEqual(d.getMonth(), 4);
  assertEqual(d.getDate(), 11);
});

test('parseIsoDate: malformed input falls back to unix epoch date', () => {
  const d = parseIsoDate('2026-05');
  assertEqual(d.getFullYear(), 1970);
  assertEqual(d.getMonth(), 0);
  assertEqual(d.getDate(), 1);
});

test('clampDrinkCount: clamps negatives to 0 and rounds', () => {
  assertEqual(clampDrinkCount(-3), 0);
  assertEqual(clampDrinkCount(2.7), 3);
});

test('clampDrinkCount: caps at 30 and handles non-numeric', () => {
  assertEqual(clampDrinkCount(45), 30);
  assertEqual(clampDrinkCount('nope'), 0);
});

test('normalizeEntry: unlogged defaults', () => {
  assertDeepEqual(normalizeEntry({ logged: false, count: 5, note: 'x' }), {
    logged: false,
    count: 0,
    note: '',
  });
});

test('normalizeEntry: logged entries are normalized', () => {
  assertDeepEqual(normalizeEntry({ logged: true, count: 2.2, note: 9 }), {
    logged: true,
    count: 2,
    note: '9',
  });
});

test('countSummary: sentence fragments for all states', () => {
  assertEqual(countSummary({ logged: false }), 'not logged');
  assertEqual(countSummary({ logged: true, count: 0 }), 'no drinks');
  assertEqual(countSummary({ logged: true, count: 1 }), '1 drink');
  assertEqual(countSummary({ logged: true, count: 4 }), '4 drinks');
});

// ---------------------------------------------------------------------------
// seededRand
// ---------------------------------------------------------------------------

test('seededRand: same input returns same value', () => {
  const a = seededRand('2024-01-15');
  const b = seededRand('2024-01-15');
  assertEqual(a, b, 'must be deterministic');
});

test('seededRand: different inputs produce different values', () => {
  const a = seededRand('2024-01-15');
  const b = seededRand('2024-01-16');
  assertTrue(a !== b, 'different seeds should produce different values');
});

test('seededRand: output is in [0, 1)', () => {
  const dates = ['2024-01-01', '2024-06-15', '2023-12-31', '2000-01-01', '2026-05-11'];
  for (const d of dates) {
    const v = seededRand(d);
    assertRange(v, 0, 1, `seededRand(${d})`);
  }
});

test('seededRand: empty string returns a number', () => {
  const v = seededRand('');
  assertRange(v, 0, 1, 'seededRand("")');
});

// ---------------------------------------------------------------------------
// mockEntry
// ---------------------------------------------------------------------------

test('mockEntry: future date is always unlogged', () => {
  const today = new Date(2024, 0, 15);
  const future = new Date(2024, 0, 16);
  const entry = mockEntry(future, today);
  assertEqual(entry.logged, false, 'future dates must be unlogged');
  assertTrue(!('count' in entry), 'future entries must not have count');
});

test('mockEntry: far-future date is always unlogged', () => {
  const today = new Date(2024, 0, 15);
  const farFuture = new Date(2099, 11, 31);
  const entry = mockEntry(farFuture, today);
  assertEqual(entry.logged, false);
});

test('mockEntry: today itself is not treated as future', () => {
  const today = new Date(2024, 0, 15);
  // today === today should not return { logged: false } due to the > check
  // (date > today is false when date === today). So it goes through the seeded logic.
  const entry = mockEntry(today, today);
  assertTrue('logged' in entry, 'today entry should have logged property');
});

test('mockEntry: past date is deterministic', () => {
  const today = new Date(2024, 6, 1);
  const past = new Date(2024, 0, 15);
  const a = mockEntry(past, today);
  const b = mockEntry(past, today);
  assertDeepEqual(a, b, 'same date should always produce same entry');
});

test('mockEntry: logged entries have a count', () => {
  // Brute-force: at least one past date in a year should be logged with a count.
  const today = new Date(2026, 4, 11);
  let foundLogged = false;
  for (let day = 1; day <= 365; day++) {
    const d = new Date(2025, 0, day);
    const entry = mockEntry(d, today);
    if (entry.logged && entry.count !== undefined) {
      foundLogged = true;
      assertTrue(entry.count >= 0, 'count must be >= 0');
      assertTrue(entry.count <= 6, 'count must be <= 6 (max in mock)');
      break;
    }
  }
  assertTrue(foundLogged, 'expected to find at least one logged entry in 365 days');
});

// ---------------------------------------------------------------------------
// buildDays
// ---------------------------------------------------------------------------

test('buildDays: year range produces 52*7 days', () => {
  const today = new Date(2024, 4, 15); // May 15, 2024
  const { days, weeks } = buildDays('year', today);
  assertEqual(weeks, 52);
  assertEqual(days.length, 52 * 7);
});

test('buildDays: rolling26 range produces 26*7 days', () => {
  const today = new Date(2024, 4, 15);
  const { days, weeks } = buildDays('rolling26', today);
  assertEqual(weeks, 26);
  assertEqual(days.length, 26 * 7);
});

test('buildDays: first day is always a Monday', () => {
  const today = new Date(2024, 4, 15); // Wednesday
  const { days } = buildDays('year', today);
  assertEqual(mondayIndex(days[0]), 0, 'first day must be Monday');
});

test('buildDays: first day is Monday even when today is Sunday', () => {
  // 2024-01-14 is a Sunday
  const today = new Date(2024, 0, 14);
  const { days } = buildDays('year', today);
  assertEqual(mondayIndex(days[0]), 0, 'first day must be Monday');
});

test('buildDays: today is included in the grid', () => {
  const today = new Date(2024, 4, 15);
  const todayIso = isoDate(today);
  const { days } = buildDays('year', today);
  const isos = days.map(isoDate);
  assertTrue(isos.includes(todayIso), 'today must be in the grid');
});

test('buildDays: rolling26 also includes today', () => {
  const today = new Date(2024, 4, 15);
  const todayIso = isoDate(today);
  const { days } = buildDays('rolling26', today);
  const isos = days.map(isoDate);
  assertTrue(isos.includes(todayIso), 'today must be in rolling26 grid');
});

test('buildDays: days are in chronological order', () => {
  const today = new Date(2024, 4, 15);
  const { days } = buildDays('year', today);
  for (let i = 1; i < days.length; i++) {
    assertTrue(days[i] > days[i - 1], `day ${i} should be after day ${i - 1}`);
  }
});

test('buildDays: last week contains today and days after', () => {
  // 2024-05-15 is a Wednesday (mondayIndex=2).
  // Last week should span Mon May 13 → Sun May 19.
  const today = new Date(2024, 4, 15);
  const { days } = buildDays('year', today);
  const lastWeek = days.slice(-7);
  const lastWeekIsos = lastWeek.map(isoDate);
  // Monday of this week
  const thisMonday = mondayOnOrBefore(today);
  assertEqual(isoDate(lastWeek[0]), isoDate(thisMonday), 'last week starts on thisMonday');
});

test('buildDays: February handles leap year (2024)', () => {
  // Feb 29, 2024 exists and should appear in the grid if within range.
  const today = new Date(2024, 4, 15); // May 15, 2024
  const { days } = buildDays('year', today);
  const isos = days.map(isoDate);
  assertTrue(isos.includes('2024-02-29'), 'Feb 29 should appear in a leap year grid');
});

test('buildDays: year-end boundary (grid spanning Dec/Jan)', () => {
  // Today: Jan 5, 2025. The year grid (52 weeks back) should include dates from 2024.
  const today = new Date(2025, 0, 5);
  const { days } = buildDays('year', today);
  const isos = days.map(isoDate);
  // Should include dates from 2024
  const has2024 = isos.some(d => d.startsWith('2024'));
  assertTrue(has2024, 'year grid starting in Jan 2025 should contain 2024 dates');
});

// ---------------------------------------------------------------------------
// ariaForDay
// ---------------------------------------------------------------------------

// Known Monday: 2024-01-08
const MON_JAN_8 = new Date(2024, 0, 8);
const DATE_LABEL = 'Monday 8 January 2024';

test('ariaForDay: future date (non-today)', () => {
  const label = ariaForDay(MON_JAN_8, { logged: false }, false, true);
  assertEqual(label, `${DATE_LABEL} — not yet`);
});

test('ariaForDay: future date has no "Today" prefix even if isToday=true', () => {
  // Edge case: isFuture takes priority
  const label = ariaForDay(MON_JAN_8, { logged: false }, true, true);
  assertEqual(label, `${DATE_LABEL} — not yet`, 'future date must not have Today prefix');
});

test('ariaForDay: unlogged past date', () => {
  const label = ariaForDay(MON_JAN_8, { logged: false }, false, false);
  assertEqual(label, `${DATE_LABEL} — not logged`);
});

test('ariaForDay: today, unlogged', () => {
  const label = ariaForDay(MON_JAN_8, { logged: false }, true, false);
  assertEqual(label, `Today, ${DATE_LABEL} — not logged`);
});

test('ariaForDay: logged, 0 drinks (sober day)', () => {
  const label = ariaForDay(MON_JAN_8, { logged: true, count: 0 }, false, false);
  assertEqual(label, `${DATE_LABEL} — logged, no drinks`);
});

test('ariaForDay: today, logged 0 drinks', () => {
  const label = ariaForDay(MON_JAN_8, { logged: true, count: 0 }, true, false);
  assertEqual(label, `Today, ${DATE_LABEL} — logged, no drinks`);
});

test('ariaForDay: logged, 1 drink (singular)', () => {
  const label = ariaForDay(MON_JAN_8, { logged: true, count: 1 }, false, false);
  assertEqual(label, `${DATE_LABEL} — 1 drink`);
});

test('ariaForDay: today, logged 1 drink (singular)', () => {
  const label = ariaForDay(MON_JAN_8, { logged: true, count: 1 }, true, false);
  assertEqual(label, `Today, ${DATE_LABEL} — 1 drink`);
});

test('ariaForDay: logged, 2 drinks (plural)', () => {
  const label = ariaForDay(MON_JAN_8, { logged: true, count: 2 }, false, false);
  assertEqual(label, `${DATE_LABEL} — 2 drinks`);
});

test('ariaForDay: logged, 5 drinks', () => {
  const label = ariaForDay(MON_JAN_8, { logged: true, count: 5 }, false, false);
  assertEqual(label, `${DATE_LABEL} — 5 drinks`);
});

test('ariaForDay: logged, 6 drinks (peak)', () => {
  const label = ariaForDay(MON_JAN_8, { logged: true, count: 6 }, false, false);
  assertEqual(label, `${DATE_LABEL} — 6 drinks`);
});

test('ariaForDay: sentence contains an em-dash separator', () => {
  // All labels must use the em-dash separator for consistent parsing by AT.
  const cases = [
    ariaForDay(MON_JAN_8, { logged: false }, false, true),
    ariaForDay(MON_JAN_8, { logged: false }, false, false),
    ariaForDay(MON_JAN_8, { logged: true, count: 0 }, false, false),
    ariaForDay(MON_JAN_8, { logged: true, count: 3 }, false, false),
  ];
  for (const label of cases) {
    assertTrue(label.includes('—'), `label missing em-dash: "${label}"`);
  }
});

// ---------------------------------------------------------------------------
// bucketFor
// ---------------------------------------------------------------------------

test('bucketFor: unlogged → "unlogged"', () => {
  assertEqual(bucketFor({ logged: false }), 'unlogged');
});

test('bucketFor: logged 0 drinks → "zero"', () => {
  assertEqual(bucketFor({ logged: true, count: 0 }), 'zero');
});

test('bucketFor: logged 1 drink → "low"', () => {
  assertEqual(bucketFor({ logged: true, count: 1 }), 'low');
});

test('bucketFor: logged 2 drinks → "mid"', () => {
  assertEqual(bucketFor({ logged: true, count: 2 }), 'mid');
});

test('bucketFor: logged 3 drinks → "mid"', () => {
  assertEqual(bucketFor({ logged: true, count: 3 }), 'mid');
});

test('bucketFor: logged 4 drinks → "high"', () => {
  assertEqual(bucketFor({ logged: true, count: 4 }), 'high');
});

test('bucketFor: logged 5 drinks → "high"', () => {
  assertEqual(bucketFor({ logged: true, count: 5 }), 'high');
});

test('bucketFor: logged 6 drinks → "peak"', () => {
  assertEqual(bucketFor({ logged: true, count: 6 }), 'peak');
});

test('bucketFor: valid bucket for every mock count (0–6)', () => {
  const valid = new Set(['unlogged', 'zero', 'low', 'mid', 'high', 'peak']);
  for (let count = 0; count <= 6; count++) {
    const bucket = bucketFor({ logged: true, count });
    assertTrue(valid.has(bucket), `count ${count} produced invalid bucket "${bucket}"`);
  }
  assertEqual(bucketFor({ logged: false }), 'unlogged');
});

// ---------------------------------------------------------------------------
// magnify helpers
// ---------------------------------------------------------------------------

test('magnifyWeight: falloff profile and out-of-range behavior', () => {
  assertEqual(magnifyWeight(0), 1);
  assertEqual(magnifyWeight(1), 0.6);
  assertEqual(magnifyWeight(2), 0.24);
  assertEqual(magnifyWeight(3), 0);
});

test('magnifyWeight: reduced motion only highlights center', () => {
  assertEqual(magnifyWeight(0, true), 1);
  assertEqual(magnifyWeight(1, true), 0);
});

test('computeMagnifyLevels: neighborhood levels around center index', () => {
  assertDeepEqual(computeMagnifyLevels(3, 7), [0, 0.24, 0.6, 1, 0.6, 0.24, 0]);
});

test('computeMagnifyLevels: invalid center returns zeros', () => {
  assertDeepEqual(computeMagnifyLevels(-1, 5), [0, 0, 0, 0, 0]);
  assertDeepEqual(computeMagnifyLevels(9, 5), [0, 0, 0, 0, 0]);
});

// ---------------------------------------------------------------------------
// Cross-cutting: ariaForDay labels are accessible sentences for ALL mock outputs.
// This tests that grid rendering would produce valid aria-labels for every
// possible combination of state, enforcing the accessibility spec.
// ---------------------------------------------------------------------------

test('ariaForDay: every bucket state produces a non-empty, sentence-shaped label', () => {
  const states = [
    { entry: { logged: false },         isToday: false, isFuture: false },
    { entry: { logged: false },         isToday: true,  isFuture: false },
    { entry: { logged: false },         isToday: false, isFuture: true  },
    { entry: { logged: true, count: 0 }, isToday: false, isFuture: false },
    { entry: { logged: true, count: 0 }, isToday: true,  isFuture: false },
    { entry: { logged: true, count: 1 }, isToday: false, isFuture: false },
    { entry: { logged: true, count: 3 }, isToday: true,  isFuture: false },
    { entry: { logged: true, count: 6 }, isToday: false, isFuture: false },
  ];
  for (const { entry, isToday, isFuture } of states) {
    const label = ariaForDay(MON_JAN_8, entry, isToday, isFuture);
    assertTrue(label.length > 0, 'label must not be empty');
    assertTrue(label.includes('—'), `label must contain separator: "${label}"`);
    // Must start with day name or "Today,"
    const startsCorrectly =
      label.startsWith('Today,') ||
      ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].some(d => label.startsWith(d));
    assertTrue(startsCorrectly, `label must start with day name or "Today,": "${label}"`);
  }
});

// ---------------------------------------------------------------------------
// Regression: buildDays week-start consistency across DST boundaries.
// In many timezones, clocks spring forward in March or October, creating
// 23-hour and 25-hour days. The grid must still be exactly weeks*7 days.
// ---------------------------------------------------------------------------

test('buildDays: length is exactly weeks*7 around a DST-risk month', () => {
  // March: DST starts in many locales.
  const march15 = new Date(2024, 2, 15);
  const { days: yearDays } = buildDays('year', march15);
  assertEqual(yearDays.length, 52 * 7, 'year grid must be exactly 364 days near DST');

  const { days: rollingDays } = buildDays('rolling26', march15);
  assertEqual(rollingDays.length, 26 * 7, 'rolling26 grid must be exactly 182 days near DST');
});

test('buildDays: November (DST ends in US) produces correct length', () => {
  const nov5 = new Date(2024, 10, 5); // November 5 — DST fallback in US
  const { days } = buildDays('year', nov5);
  assertEqual(days.length, 52 * 7);
});

// ---------------------------------------------------------------------------
// daysBetween
// ---------------------------------------------------------------------------

test('daysBetween: same day is zero regardless of clock time', () => {
  const a = new Date(2026, 4, 11, 9, 30);
  const b = new Date(2026, 4, 11, 23, 59);
  assertEqual(daysBetween(a, b), 0);
});

test('daysBetween: counts whole calendar days forward', () => {
  const a = new Date(2026, 4, 1);
  const b = new Date(2026, 4, 11);
  assertEqual(daysBetween(a, b), 10);
});

test('daysBetween: negative when "to" is before "from"', () => {
  const a = new Date(2026, 4, 11);
  const b = new Date(2026, 4, 8);
  assertEqual(daysBetween(a, b), -3);
});

test('daysBetween: handles spring-forward DST without rounding to wrong day', () => {
  // US spring forward 2024-03-10. Counting from March 1 to March 31 must be 30.
  const a = new Date(2024, 2, 1);
  const b = new Date(2024, 2, 31);
  assertEqual(daysBetween(a, b), 30);
});

// ---------------------------------------------------------------------------
// lastLoggedText
// ---------------------------------------------------------------------------

test('lastLoggedText: empty state when no logs', () => {
  const today = new Date(2026, 4, 11);
  assertEqual(lastLoggedText(null, today), 'no logs yet — tap +1 to start');
});

test('lastLoggedText: today / yesterday / N days ago', () => {
  const today = new Date(2026, 4, 11);
  assertEqual(lastLoggedText('2026-05-11', today), 'last logged today');
  assertEqual(lastLoggedText('2026-05-10', today), 'last logged yesterday');
  assertEqual(lastLoggedText('2026-05-08', today), 'last logged 3 days ago');
});

test('lastLoggedText: weeks bucket', () => {
  const today = new Date(2026, 4, 11);
  assertEqual(lastLoggedText('2026-05-04', today), 'last logged a week ago');
  assertEqual(lastLoggedText('2026-04-25', today), 'last logged 2 weeks ago');
});

test('lastLoggedText: a while ago beyond a month', () => {
  const today = new Date(2026, 4, 11);
  assertEqual(lastLoggedText('2026-01-01', today), 'last logged a while ago');
});

// ---------------------------------------------------------------------------
// displayInitial
// ---------------------------------------------------------------------------

test('displayInitial: prefers display name over email', () => {
  assertEqual(displayInitial('cam', 'cam@example.com'), 'C');
});

test('displayInitial: falls back to email when name is blank', () => {
  assertEqual(displayInitial('', 'jamie@example.com'), 'J');
  assertEqual(displayInitial('   ', 'sam@example.com'), 'S');
});

test('displayInitial: returns dot when both are missing', () => {
  assertEqual(displayInitial('', ''), '·');
  assertEqual(displayInitial(undefined, undefined), '·');
});

test('displayInitial: handles non-ASCII first character', () => {
  // Cyrillic Д should uppercase cleanly.
  assertEqual(displayInitial('давид', ''), 'Д');
});

// ---------------------------------------------------------------------------
// logsToEntries
// ---------------------------------------------------------------------------

test('logsToEntries: maps API rows to normalized entries', () => {
  const map = logsToEntries([
    { date: '2026-05-11', drinks: 2, note: 'pub' },
    { date: '2026-05-10', drinks: 0, note: '' },
  ]);
  assertDeepEqual(map.get('2026-05-11'), { logged: true, count: 2, note: 'pub' });
  assertDeepEqual(map.get('2026-05-10'), { logged: true, count: 0, note: '' });
  assertEqual(map.size, 2);
});

test('logsToEntries: tolerates missing or weird values', () => {
  const map = logsToEntries([
    { date: '2026-05-11' },                      // missing drinks/note
    { date: '2026-05-10', drinks: 999, note: null },
    { drinks: 1 },                                // missing date — skipped
    null,                                         // skipped
  ]);
  assertDeepEqual(map.get('2026-05-11'), { logged: true, count: 0, note: '' });
  assertEqual(map.get('2026-05-10').count, 30); // clamped
  assertEqual(map.get('2026-05-10').note, '');
  assertEqual(map.size, 2);
});

test('logsToEntries: returns empty map for non-array input', () => {
  assertEqual(logsToEntries(null).size, 0);
  assertEqual(logsToEntries(undefined).size, 0);
  assertEqual(logsToEntries('nope').size, 0);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failures.length > 0) {
  for (const { name, err } of failures) {
    console.error(`  FAIL: ${name}\n       ${err.message}\n`);
  }
  process.exit(1);
}
