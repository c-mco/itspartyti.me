// itspartyti.me — frontend
//
// COMMIT 1: grid skeleton.
// This file renders the dot grid in semantic HTML, with deterministic mock
// data, and lets Cam flip between the three A/B/C layout prototypes via
// the hidden `?layout=A|B|C` URL param. No interaction (magnify, bloom,
// API) yet — those come in commits 3 and 4.

const LAYOUTS = {
  A: { orientation: 'horizontal', range: 'year',      label: 'A — year, weeks as columns' },
  B: { orientation: 'vertical',   range: 'year',      label: 'B — year, weeks as rows' },
  C: { orientation: 'vertical',   range: 'rolling26', label: 'C — last 26 weeks' },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_LONG   = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// --- date helpers ---------------------------------------------------------

/** ISO date string (YYYY-MM-DD) in the local timezone. */
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday=0 .. Sunday=6 (week-starts-Monday convention used throughout). */
function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}

/** Start-of-day copy. */
function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Most recent Monday on or before `d`. */
function mondayOnOrBefore(d) {
  const c = startOfDay(d);
  c.setDate(c.getDate() - mondayIndex(c));
  return c;
}

/** "Monday 11 May 2026". */
function longDate(d) {
  return `${WEEKDAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

// --- mock data ------------------------------------------------------------

/** Tiny deterministic hash → pseudo-random number in [0, 1). */
function seededRand(seed) {
  // xfnv1a-ish: enough variety for fixtures, not for crypto.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Mix.
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Mock log for a given date.
 * Returns:
 *   { logged: false }                 — unlogged
 *   { logged: true, count: 0 }        — logged sober
 *   { logged: true, count: 1..6 }     — logged with drinks
 *
 * Future-dated days are always unlogged.
 */
function mockEntry(date, today) {
  if (date > today) return { logged: false };

  const r = seededRand(isoDate(date));
  if (r < 0.28) return { logged: false };          // ~28% unlogged
  if (r < 0.58) return { logged: true, count: 0 }; // ~30% logged-zero
  // Rest: 1–6 drinks, skewed toward small numbers.
  const tier = (r - 0.58) / 0.42; // 0..1
  let count;
  if      (tier < 0.40) count = 1;
  else if (tier < 0.65) count = 2;
  else if (tier < 0.82) count = 3;
  else if (tier < 0.92) count = 4;
  else if (tier < 0.98) count = 5;
  else                  count = 6;
  return { logged: true, count };
}

// --- grid model -----------------------------------------------------------

/**
 * Build the day window for a given range.
 * `year`      → 52 weeks ending in the week that contains `today` (Mon..Sun rows).
 * `rolling26` → last 26 weeks, same alignment.
 *
 * Always returns an array of length (weeks * 7), in chronological order,
 * starting on a Monday. Days past `today` are included in the last week
 * (they'll render as unlogged + disabled), so every layout has consistent
 * grid geometry.
 */
function buildDays(range, today) {
  const weeks = range === 'rolling26' ? 26 : 52;
  // The grid's last column/row is the current week — Monday..Sunday.
  const thisMonday = mondayOnOrBefore(today);
  const start = new Date(thisMonday);
  start.setDate(start.getDate() - (weeks - 1) * 7);

  const days = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return { days, weeks, start, end: days[days.length - 1] };
}

// --- rendering ------------------------------------------------------------

/** Build sentence-shaped aria-label for a dot. */
function ariaForDay(date, entry, isToday, isFuture) {
  const datePart = longDate(date);
  const todayPrefix = isToday ? 'Today, ' : '';
  if (isFuture) return `${datePart} — not yet`;
  if (!entry.logged) return `${todayPrefix}${datePart} — not logged`;
  if (entry.count === 0) return `${todayPrefix}${datePart} — logged, no drinks`;
  const noun = entry.count === 1 ? 'drink' : 'drinks';
  return `${todayPrefix}${datePart} — ${entry.count} ${noun}`;
}

/** "Bucket" for the traffic-light ramp; CSS will translate this to a colour. */
function bucketFor(entry) {
  if (!entry.logged)    return 'unlogged';
  if (entry.count === 0) return 'zero';
  if (entry.count <= 1) return 'low';
  if (entry.count <= 3) return 'mid';
  if (entry.count <= 5) return 'high';
  return 'peak';
}

function renderGrid(gridEl, { orientation, range }, today) {
  const { days, weeks } = buildDays(range, today);

  gridEl.dataset.orientation = orientation;
  gridEl.dataset.range = range;
  gridEl.dataset.weeks = String(weeks);
  gridEl.style.setProperty('--weeks', String(weeks));
  gridEl.setAttribute(
    'aria-label',
    range === 'rolling26'
      ? 'Drinks logged per day, last 26 weeks'
      : 'Drinks logged per day, last 52 weeks',
  );

  // Build off-DOM, swap in once.
  const frag = document.createDocumentFragment();
  const todayIso = isoDate(today);

  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    const iso = isoDate(date);
    const isToday = iso === todayIso;
    const isFuture = date > today;
    const entry = mockEntry(date, today);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dot';
    btn.dataset.date = iso;
    btn.dataset.bucket = bucketFor(entry);
    btn.dataset.logged = entry.logged ? 'true' : 'false';
    if (entry.logged) btn.dataset.count = String(entry.count);
    if (isToday) btn.dataset.today = 'true';
    if (isFuture) {
      btn.dataset.future = 'true';
      btn.disabled = true;
    }
    btn.setAttribute('aria-label', ariaForDay(date, entry, isToday, isFuture));
    // CSS uses ::before/::after for the dot/ring; keep button text empty.
    frag.appendChild(btn);
  }

  gridEl.replaceChildren(frag);
  setupRovingTabindex(gridEl);
}

function setupRovingTabindex(gridEl) {
  const dots = Array.from(gridEl.querySelectorAll('.dot'));
  if (!dots.length) return;

  const firstEnabled = dots.findIndex((dot) => !dot.disabled);
  const todayEnabled = dots.findIndex((dot) => dot.dataset.today === 'true' && !dot.disabled);
  const activeIndex = todayEnabled >= 0 ? todayEnabled : Math.max(firstEnabled, 0);

  dots.forEach((dot, index) => {
    dot.tabIndex = index === activeIndex ? 0 : -1;
  });
}

function wireGridKeyboard() {
  const grid = document.querySelector('[data-grid]');
  if (!grid) return;

  grid.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement) || !active.classList.contains('dot')) return;

    const dots = Array.from(grid.querySelectorAll('.dot:not(:disabled)'));
    const currentIndex = dots.indexOf(active);
    if (currentIndex < 0) return;

    const orientation = grid.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const step = orientation === 'vertical' ? 7 : 1;
    const rowStep = orientation === 'vertical' ? 1 : 7;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = Math.min(currentIndex + step, dots.length - 1);
    else if (event.key === 'ArrowLeft') nextIndex = Math.max(currentIndex - step, 0);
    else if (event.key === 'ArrowDown') nextIndex = Math.min(currentIndex + rowStep, dots.length - 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(currentIndex - rowStep, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = dots.length - 1;
    else return;

    event.preventDefault();
    if (nextIndex === currentIndex) return;

    dots[currentIndex].tabIndex = -1;
    dots[nextIndex].tabIndex = 0;
    dots[nextIndex].focus({ preventScroll: false });
  });
}

// --- layout switching -----------------------------------------------------

function pickLayout() {
  const raw = (new URLSearchParams(location.search).get('layout') || 'A').toUpperCase();
  return LAYOUTS[raw] ? raw : 'A';
}

function applyLayout(key) {
  const cfg = LAYOUTS[key];
  document.body.dataset.layout = key;

  const grid = document.querySelector('[data-grid]');
  const footer = document.querySelector('[data-grid-footer]');
  const seeMore = document.querySelector('[data-see-more]');

  renderGrid(grid, cfg, startOfDay(new Date()));

  // C: rolling26 with a "see more" affordance to expand to full year.
  if (key === 'C' && cfg.range === 'rolling26') {
    footer.hidden = false;
    seeMore.hidden = false;
    seeMore.textContent = 'See more — show the full year';
  } else {
    footer.hidden = true;
  }
}

function wireSeeMore() {
  const seeMore = document.querySelector('[data-see-more]');
  if (!seeMore) return;
  seeMore.addEventListener('click', () => {
    const grid = document.querySelector('[data-grid]');
    const footer = document.querySelector('[data-grid-footer]');
    renderGrid(grid, { orientation: 'vertical', range: 'year' }, startOfDay(new Date()));
    footer.hidden = true;
  });
}

// --- boot -----------------------------------------------------------------

function boot() {
  applyLayout(pickLayout());
  wireSeeMore();
  wireGridKeyboard();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
