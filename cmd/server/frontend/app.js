// itspartyti.me — frontend
//
// One screen. The grid IS the editor. No framework, no build step.
//
// Pipeline:
//   boot()
//     ↓ try /api/me
//     ↓   401 → mount auth screen → on success → boot()
//     ↓   ok  → mount app shell → fetch /api/logs → render grid
//     ↓ wire pointer + keyboard + FAB + avatar
//     ↓ maybe auto-open today (if enabled + away ≥ N days + today unlogged)
//
// `?demo=1` in the URL skips auth and uses seeded mock data — handy for
// design review without an account.

const LAYOUTS = {
  A: { orientation: 'horizontal', range: 'year',      label: 'A — year, weeks as columns' },
  B: { orientation: 'vertical',   range: 'year',      label: 'B — year, weeks as rows' },
  C: { orientation: 'vertical',   range: 'rolling26', label: 'C — last 26 weeks' },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_SAVE_IDLE_MS = 800;
const BLUR_SAVE_GRACE_MS = 300;
const NOTE_MAX = 500;
const MAGNIFY_RADIUS = 2;
const TOUCH_CLICK_SUPPRESS_MS = 600;
const TOAST_DURATION_MS = 4500;
const AUTO_OPEN_AWAY_DAYS = 2;
const SETTINGS_KEY = 'itspt.settings.v1';
const LAST_SEEN_KEY = 'itspt.lastSeen.v1';

const WEEKDAY_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_LONG   = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const APP_STATE = {
  user: null,
  demo: false,
  entriesByDate: new Map(),
  openDate: null,
  saveTimer: null,
  pendingSavesByDate: new Map(), // iso -> last sent payload (for dedupe / inflight)
  savedShowTimer: null,
  blurTimer: null,
  savedHideTimer: null,
  activeTouchPointerId: null,
  suppressClickUntil: 0,
  bloomViewportWired: false,
  pointerWired: false,
  keyboardWired: false,
  seeMoreWired: false,
  quickAddWired: false,
  avatarWired: false,
  authWired: false,
  sheetOpen: false,
  toastUndoTimer: null,
};

// =========================================================================
// Pure helpers — date / formatting / normalisation
// =========================================================================

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

function parseIsoDate(iso) {
  const parts = iso.split('-');
  if (parts.length !== 3) return new Date(1970, 0, 1);
  const [yRaw, mRaw, dRaw] = parts;
  const y = Number(yRaw);
  const m = Number(mRaw);
  const d = Number(dRaw);
  const safeYear = Number.isFinite(y) ? y : 1970;
  const safeMonth = Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1;
  const safeDay = Number.isFinite(d) && d >= 1 && d <= 31 ? d : 1;
  const candidate = new Date(safeYear, safeMonth - 1, safeDay);
  if (
    candidate.getFullYear() !== safeYear ||
    candidate.getMonth() !== safeMonth - 1 ||
    candidate.getDate() !== safeDay
  ) {
    return new Date(safeYear, safeMonth - 1, 1);
  }
  return candidate;
}

function clampDrinkCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(30, Math.round(n)));
}

function normalizeEntry(entry) {
  if (!entry || entry.logged !== true) {
    return { logged: false, count: 0, note: '' };
  }
  return {
    logged: true,
    count: clampDrinkCount(entry.count ?? 0),
    note: String(entry.note ?? ''),
  };
}

function entryForAria(entry) {
  return entry.logged ? { logged: true, count: entry.count } : { logged: false };
}

function countSummary(entry) {
  if (!entry.logged) return 'not logged';
  if (entry.count === 0) return 'no drinks';
  return `${entry.count} ${entry.count === 1 ? 'drink' : 'drinks'}`;
}

/** Whole-day delta from `from` to `to`, ignoring time-of-day. */
function daysBetween(from, to) {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * Microcopy for the "last logged …" line. Quiet, neutral, never naggy.
 * `mostRecentIso` may be null → empty-state line.
 */
function lastLoggedText(mostRecentIso, today) {
  if (!mostRecentIso) return 'no logs yet — tap +1 to start';
  const delta = daysBetween(parseIsoDate(mostRecentIso), today);
  if (delta <= 0) return 'last logged today';
  if (delta === 1) return 'last logged yesterday';
  if (delta < 7)   return `last logged ${delta} days ago`;
  if (delta < 14)  return 'last logged a week ago';
  if (delta < 30)  return `last logged ${Math.round(delta / 7)} weeks ago`;
  return 'last logged a while ago';
}

/** Initial for the avatar circle — display name first, then email, then "·". */
function displayInitial(displayName, email) {
  const src = (displayName || '').trim() || (email || '').trim();
  if (!src) return '·';
  const code = src.codePointAt(0);
  return String.fromCodePoint(code).toUpperCase();
}

// =========================================================================
// Mock data (used only when ?demo=1)
// =========================================================================

/** Tiny deterministic hash → pseudo-random number in [0, 1).
 *  FNV-1a-inspired mixer; fine for fixture variety, not crypto. */
function seededRand(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function mockEntry(date, today) {
  if (date > today) return { logged: false };
  const r = seededRand(isoDate(date));
  if (r < 0.28) return { logged: false };
  if (r < 0.58) return { logged: true, count: 0 };
  const tier = (r - 0.58) / 0.42;
  let count;
  if      (tier < 0.40) count = 1;
  else if (tier < 0.65) count = 2;
  else if (tier < 0.82) count = 3;
  else if (tier < 0.92) count = 4;
  else if (tier < 0.98) count = 5;
  else                  count = 6;
  return { logged: true, count };
}

// =========================================================================
// Grid model + rendering
// =========================================================================

function buildDays(range, today) {
  const weeks = range === 'rolling26' ? 26 : 52;
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

function ariaForDay(date, entry, isToday, isFuture) {
  const datePart = longDate(date);
  const todayPrefix = isToday ? 'Today, ' : '';
  if (isFuture) return `${datePart} — not yet`;
  if (!entry.logged) return `${todayPrefix}${datePart} — not logged`;
  if (entry.count === 0) return `${todayPrefix}${datePart} — logged, no drinks`;
  const noun = entry.count === 1 ? 'drink' : 'drinks';
  return `${todayPrefix}${datePart} — ${entry.count} ${noun}`;
}

function bucketFor(entry) {
  if (!entry.logged)    return 'unlogged';
  if (entry.count === 0) return 'zero';
  if (entry.count <= 1) return 'low';
  if (entry.count <= 3) return 'mid';
  if (entry.count <= 5) return 'high';
  return 'peak';
}

function magnifyWeight(distance, reducedMotion = false) {
  if (distance < 0 || distance > MAGNIFY_RADIUS) return 0;
  if (reducedMotion) return distance === 0 ? 1 : 0;
  if (distance === 0) return 1;
  if (distance === 1) return 0.6;
  return 0.24;
}

function indexToGridCell(index, orientation, rows = 7) {
  const safeRows = Math.max(1, rows);
  if (orientation === 'vertical') {
    return { row: Math.floor(index / safeRows), col: index % safeRows };
  }
  return { row: index % safeRows, col: Math.floor(index / safeRows) };
}

function computeMagnifyLevels(centerIndex, total, reducedMotion = false, orientation = 'horizontal', rows = 7) {
  const levels = Array.from({ length: total }, () => 0);
  if (centerIndex < 0 || centerIndex >= total) return levels;
  const center = indexToGridCell(centerIndex, orientation, rows);
  for (let i = 0; i < total; i++) {
    const cell = indexToGridCell(i, orientation, rows);
    const distance = Math.max(
      Math.abs(cell.row - center.row),
      Math.abs(cell.col - center.col),
    );
    levels[i] = magnifyWeight(distance, reducedMotion);
  }
  return levels;
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

  const frag = document.createDocumentFragment();
  const todayIso = isoDate(today);

  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    const iso = isoDate(date);
    const isToday = iso === todayIso;
    const isFuture = date > today;
    const existing = APP_STATE.entriesByDate.get(iso);
    let entry;
    if (existing !== undefined) {
      entry = normalizeEntry(existing);
    } else if (APP_STATE.demo) {
      entry = normalizeEntry(mockEntry(date, today));
      APP_STATE.entriesByDate.set(iso, entry);
    } else {
      entry = { logged: false, count: 0, note: '' };
    }

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
    btn.setAttribute('aria-label', ariaForDay(date, entryForAria(entry), isToday, isFuture));
    frag.appendChild(btn);
  }

  gridEl.replaceChildren(frag);
  setupRovingTabindex(gridEl);
  scrollTodayIntoView(gridEl);
  if (APP_STATE.openDate) {
    const openDot = gridEl.querySelector(`.dot[data-date="${APP_STATE.openDate}"]`);
    if (!openDot || openDot.disabled) {
      closeBloomEditor();
    } else {
      openDay(openDot, { focusEditor: false });
    }
  }
}

function scrollTodayIntoView(gridEl) {
  if (gridEl.dataset.orientation !== 'horizontal') return;
  const todayDot = gridEl.querySelector('.dot[data-today="true"]');
  if (!todayDot) {
    gridEl.scrollLeft = gridEl.scrollWidth;
    return;
  }
  const padding = 16;
  gridEl.scrollLeft = Math.max(
    0,
    todayDot.offsetLeft + todayDot.offsetWidth - gridEl.clientWidth + padding,
  );
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
  if (APP_STATE.keyboardWired) return;
  const grid = document.querySelector('[data-grid]');
  if (!grid) return;
  APP_STATE.keyboardWired = true;

  const findEnabledIndex = (dots, startIndex, step) => {
    for (let i = startIndex; i >= 0 && i < dots.length; i += step) {
      if (!dots[i].disabled) return i;
    }
    return -1;
  };

  grid.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement) || !active.classList.contains('dot')) return;

    const dots = Array.from(grid.querySelectorAll('.dot'));
    const currentIndex = dots.indexOf(active);
    if (currentIndex < 0) return;

    const orientation = grid.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const step    = orientation === 'vertical' ? 1 : 7;
    const rowStep = orientation === 'vertical' ? 7 : 1;

    let nextIndex = currentIndex;
    let scanStep = 0;
    if (event.key === 'ArrowRight')      { nextIndex = Math.min(currentIndex + step,    dots.length - 1); scanStep =  1; }
    else if (event.key === 'ArrowLeft')  { nextIndex = Math.max(currentIndex - step,    0);                scanStep = -1; }
    else if (event.key === 'ArrowDown')  { nextIndex = Math.min(currentIndex + rowStep, dots.length - 1); scanStep =  1; }
    else if (event.key === 'ArrowUp')    { nextIndex = Math.max(currentIndex - rowStep, 0);                scanStep = -1; }
    else if (event.key === 'Home')       { nextIndex = 0;                  scanStep =  1; }
    else if (event.key === 'End')        { nextIndex = dots.length - 1;    scanStep = -1; }
    else return;

    event.preventDefault();
    if (nextIndex === currentIndex) return;

    if (dots[nextIndex].disabled) {
      const fallbackIndex = findEnabledIndex(dots, nextIndex, scanStep);
      if (fallbackIndex < 0 || fallbackIndex === currentIndex) return;
      nextIndex = fallbackIndex;
    }

    dots[currentIndex].tabIndex = -1;
    dots[nextIndex].tabIndex = 0;
    dots[nextIndex].focus();
  });
}

function isReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setDotFromEntry(dot, entry) {
  const normalized = normalizeEntry(entry);
  const isToday = dot.dataset.today === 'true';
  const isFuture = dot.dataset.future === 'true';
  dot.dataset.logged = normalized.logged ? 'true' : 'false';
  dot.dataset.bucket = bucketFor(normalized);
  if (normalized.logged) dot.dataset.count = String(normalized.count);
  else delete dot.dataset.count;
  dot.setAttribute(
    'aria-label',
    ariaForDay(parseIsoDate(dot.dataset.date), entryForAria(normalized), isToday, isFuture),
  );
}

// =========================================================================
// Magnify
// =========================================================================

function clearMagnify(grid) {
  const dots = Array.from(grid.querySelectorAll('.dot'));
  dots.forEach((dot) => {
    delete dot.dataset.magnify;
    delete dot.dataset.magnified;
  });
}

function setMagnify(grid, centerDot) {
  const dots = Array.from(grid.querySelectorAll('.dot'));
  const centerIndex = dots.indexOf(centerDot);
  if (centerIndex < 0) return;
  const reduced = isReducedMotion();
  const orientation = grid.dataset.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const levels = computeMagnifyLevels(centerIndex, dots.length, reduced, orientation, 7);

  dots.forEach((dot, idx) => {
    const level = levels[idx];
    if (level > 0) {
      dot.dataset.magnify = String(level);
      if (idx === centerIndex) dot.dataset.magnified = 'true';
      else delete dot.dataset.magnified;
    } else {
      delete dot.dataset.magnify;
      delete dot.dataset.magnified;
    }
  });
}

function dotAtPoint(grid, x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const dot = el.closest('.dot');
  if (!(dot instanceof HTMLButtonElement)) return null;
  if (!grid.contains(dot)) return null;
  return dot;
}

// =========================================================================
// Bloom editor
// =========================================================================

function ensureBloomHost() {
  let host = document.querySelector('[data-bloom-host]');
  if (host) return host;
  host = document.createElement('section');
  host.dataset.bloomHost = 'true';
  host.hidden = true;
  document.body.appendChild(host);
  return host;
}

function positionBloomHost(host, dot) {
  if (!host || !dot) return;
  const dotRect = dot.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  if (!hostRect.width || !hostRect.height) return;

  const margin = 8;
  const halfW = hostRect.width / 2;
  const halfH = hostRect.height / 2;
  const minX = margin + halfW;
  const maxX = window.innerWidth - margin - halfW;
  const minY = margin + halfH;
  const maxY = window.innerHeight - margin - halfH;
  const rawX = dotRect.left + (dotRect.width / 2);
  const rawY = dotRect.top + (dotRect.height / 2);
  const x = Math.max(minX, Math.min(maxX, rawX));
  const y = Math.max(minY, Math.min(maxY, rawY));

  host.style.left = `${Math.round(x)}px`;
  host.style.top = `${Math.round(y)}px`;
  host.style.setProperty('--bloom-origin-x', `${Math.round(rawX - x)}px`);
  host.style.setProperty('--bloom-origin-y', `${Math.round(rawY - y)}px`);
}

function repositionOpenBloomHost() {
  if (!APP_STATE.openDate) return;
  const host = document.querySelector('[data-bloom-host]');
  if (!host || host.hidden) return;
  const grid = document.querySelector('[data-grid]');
  const dot = grid?.querySelector(`.dot[data-date="${APP_STATE.openDate}"]`);
  if (!dot || dot.disabled) return;
  positionBloomHost(host, dot);
}

function wireBloomViewportTracking() {
  if (APP_STATE.bloomViewportWired) return;
  APP_STATE.bloomViewportWired = true;
  window.addEventListener('resize', repositionOpenBloomHost, { passive: true });
  document.addEventListener('scroll', repositionOpenBloomHost, { passive: true, capture: true });
}

function announceSaved() {
  const live = document.querySelector('[data-live]');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => {
    live.textContent = 'saved ✓';
  });
}

function announceLive(text) {
  const live = document.querySelector('[data-live]');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
}

function showSavedIndicator() {
  const saved = document.querySelector('[data-bloom-saved]');
  if (!saved) return;
  saved.hidden = false;
  saved.textContent = 'saved ✓';
  saved.dataset.tone = 'ok';
  if (APP_STATE.savedHideTimer) clearTimeout(APP_STATE.savedHideTimer);
  APP_STATE.savedHideTimer = setTimeout(() => {
    saved.hidden = true;
    APP_STATE.savedHideTimer = null;
  }, 1400);
}

function showSaveError() {
  const saved = document.querySelector('[data-bloom-saved]');
  if (saved) {
    saved.hidden = false;
    saved.textContent = "couldn't save — we'll retry";
    saved.dataset.tone = 'error';
  }
  announceLive("couldn't save");
}

function scheduleSave(delay = AUTO_SAVE_IDLE_MS) {
  if (APP_STATE.saveTimer) clearTimeout(APP_STATE.saveTimer);
  if (APP_STATE.savedShowTimer) {
    clearTimeout(APP_STATE.savedShowTimer);
    APP_STATE.savedShowTimer = null;
  }
  APP_STATE.saveTimer = setTimeout(() => {
    APP_STATE.saveTimer = null;
    void persistOpenEntry();
  }, delay);
}

async function persistOpenEntry() {
  const iso = APP_STATE.openDate;
  if (!iso) return;
  const entry = normalizeEntry(APP_STATE.entriesByDate.get(iso));
  // Demo mode: don't hit the API.
  if (APP_STATE.demo) {
    announceSaved();
    showSavedIndicator();
    return;
  }
  if (!entry.logged && entry.count === 0 && entry.note.length === 0) {
    // Nothing to persist for an empty entry — treat as no-op.
    announceSaved();
    showSavedIndicator();
    return;
  }
  try {
    await api.upsertLog({ date: iso, drinks: entry.count, note: entry.note });
    announceSaved();
    showSavedIndicator();
  } catch (err) {
    showSaveError();
  }
}

function updateBloomCharCount(host, noteLength) {
  const countEl = host.querySelector('[data-note-count]');
  if (!countEl) return;
  countEl.textContent = `${noteLength}/${NOTE_MAX}`;
  countEl.hidden = noteLength < NOTE_MAX - 60;
}

function updateOpenDotFromEditor(host) {
  const iso = host.dataset.date;
  if (!iso) return;
  const countInput = host.querySelector('[data-count-input]');
  const noteInput = host.querySelector('[data-note-input]');
  if (!(countInput instanceof HTMLInputElement) || !(noteInput instanceof HTMLTextAreaElement)) return;
  const count = clampDrinkCount(countInput.value);
  const note = String(noteInput.value ?? '');
  const current = normalizeEntry(APP_STATE.entriesByDate.get(iso));
  const next = {
    logged: current.logged,
    count,
    note: note.slice(0, NOTE_MAX),
  };
  APP_STATE.entriesByDate.set(iso, next);
  const grid = document.querySelector('[data-grid]');
  const dot = grid?.querySelector(`.dot[data-date="${iso}"]`);
  if (dot) setDotFromEntry(dot, next);
  updateBloomCharCount(host, next.note.length);
  refreshLastLogged();
}

function updateEntryField(host, iso, updates) {
  const current = normalizeEntry(APP_STATE.entriesByDate.get(iso));
  APP_STATE.entriesByDate.set(iso, { ...current, ...updates });
  const del = host.querySelector('[data-delete-day]');
  if (del) del.hidden = false;
  updateOpenDotFromEditor(host);
  scheduleSave();
}

function closeBloomEditor({ restoreFocus = false } = {}) {
  const host = document.querySelector('[data-bloom-host]');
  if (!host || host.hidden) {
    APP_STATE.openDate = null;
    return;
  }
  // Flush any pending save before tearing down the editor.
  if (APP_STATE.saveTimer) {
    clearTimeout(APP_STATE.saveTimer);
    APP_STATE.saveTimer = null;
    void persistOpenEntry();
  }
  const grid = document.querySelector('[data-grid]');
  const activeDot = APP_STATE.openDate
    ? grid?.querySelector(`.dot[data-date="${APP_STATE.openDate}"]`)
    : null;
  if (activeDot) {
    delete activeDot.dataset.open;
    activeDot.setAttribute('aria-expanded', 'false');
  }
  host.hidden = true;
  host.replaceChildren();
  delete host.dataset.date;
  host.style.left = '';
  host.style.top = '';
  host.style.removeProperty('--bloom-origin-x');
  host.style.removeProperty('--bloom-origin-y');
  if (APP_STATE.savedHideTimer) {
    clearTimeout(APP_STATE.savedHideTimer);
    APP_STATE.savedHideTimer = null;
  }
  if (APP_STATE.savedShowTimer) {
    clearTimeout(APP_STATE.savedShowTimer);
    APP_STATE.savedShowTimer = null;
  }
  if (restoreFocus && activeDot) activeDot.focus();
  APP_STATE.openDate = null;
}

function openDay(dot, { focusEditor = true } = {}) {
  if (dot.disabled) return;
  const iso = dot.dataset.date;
  if (!iso) return;
  if (APP_STATE.openDate && APP_STATE.openDate !== iso) closeBloomEditor();
  const grid = document.querySelector('[data-grid]');
  if (grid) clearMagnify(grid);
  APP_STATE.openDate = iso;
  dot.dataset.open = 'true';
  dot.setAttribute('aria-expanded', 'true');

  const entry = normalizeEntry(APP_STATE.entriesByDate.get(iso));
  const host = ensureBloomHost();
  host.hidden = false;
  host.dataset.date = iso;
  host.replaceChildren();

  const title = document.createElement('h2');
  title.id = `bloom-title-${iso}`;
  title.textContent = longDate(parseIsoDate(iso));
  host.setAttribute('aria-labelledby', title.id);

  const controls = document.createElement('div');
  controls.className = 'bloom-controls';
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.dataset.step = '-1';
  minus.textContent = '−';
  minus.setAttribute('aria-label', 'Decrease drink count by 1');
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.dataset.step = '1';
  plus.textContent = '+';
  plus.setAttribute('aria-label', 'Increase drink count by 1');
  const count = document.createElement('input');
  count.type = 'number';
  count.inputMode = 'numeric';
  count.min = '0';
  count.max = '30';
  count.step = '1';
  count.value = String(entry.count);
  count.dataset.countInput = 'true';
  count.setAttribute('aria-label', 'Drink count');
  const countLabel = document.createElement('span');
  countLabel.className = 'count-label';
  countLabel.textContent = entry.count === 1 ? 'drink' : 'drinks';
  countLabel.dataset.countLabel = 'true';
  controls.append(minus, count, plus, countLabel);

  const note = document.createElement('textarea');
  note.dataset.noteInput = 'true';
  note.maxLength = NOTE_MAX;
  note.rows = 3;
  note.placeholder = 'Add a note (optional)';
  note.value = entry.note;
  note.setAttribute('aria-label', 'Note for this day');

  const meta = document.createElement('div');
  meta.className = 'bloom-meta';
  const noteCount = document.createElement('p');
  noteCount.dataset.noteCount = 'true';
  noteCount.setAttribute('role', 'status');
  noteCount.setAttribute('aria-live', 'polite');
  noteCount.hidden = true;
  const saved = document.createElement('p');
  saved.dataset.bloomSaved = 'true';
  saved.textContent = 'saved ✓';
  saved.dataset.tone = 'ok';
  saved.hidden = true;
  meta.append(noteCount, saved);

  const del = document.createElement('button');
  del.type = 'button';
  del.dataset.deleteDay = 'true';
  del.className = 'btn btn-ghost';
  del.textContent = 'Delete this day';
  del.setAttribute('aria-label', `Delete entry for ${longDate(parseIsoDate(iso))}`);
  del.hidden = !entry.logged && entry.note.length === 0;

  host.append(title, controls, note, meta, del);
  updateBloomCharCount(host, entry.note.length);
  positionBloomHost(host, dot);
  requestAnimationFrame(() => positionBloomHost(host, dot));
  wireBloomViewportTracking();

  host.onfocusin = () => {
    if (APP_STATE.blurTimer) {
      clearTimeout(APP_STATE.blurTimer);
      APP_STATE.blurTimer = null;
    }
  };

  host.onfocusout = (event) => {
    const next = event.relatedTarget;
    if (next && host.contains(next)) return;
    if (APP_STATE.blurTimer) clearTimeout(APP_STATE.blurTimer);
    APP_STATE.blurTimer = setTimeout(() => {
      APP_STATE.blurTimer = null;
      scheduleSave(0);
    }, BLUR_SAVE_GRACE_MS);
  };

  host.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.step) {
      const delta = Number(target.dataset.step);
      const current = normalizeEntry(APP_STATE.entriesByDate.get(iso));
      const nextEntry = { ...current, logged: true, count: clampDrinkCount(current.count + delta) };
      APP_STATE.entriesByDate.set(iso, nextEntry);
      count.value = String(nextEntry.count);
      countLabel.textContent = nextEntry.count === 1 ? 'drink' : 'drinks';
      del.hidden = false;
      updateOpenDotFromEditor(host);
      scheduleSave();
      return;
    }
    if (target.dataset.deleteDay === 'true') {
      const cleared = { logged: false, count: 0, note: '' };
      APP_STATE.entriesByDate.set(iso, cleared);
      count.value = '0';
      countLabel.textContent = 'drinks';
      note.value = '';
      del.hidden = true;
      const grid = document.querySelector('[data-grid]');
      const dot2 = grid?.querySelector(`.dot[data-date="${iso}"]`);
      if (dot2) setDotFromEntry(dot2, cleared);
      refreshLastLogged();
      // Persist the deletion.
      if (APP_STATE.saveTimer) { clearTimeout(APP_STATE.saveTimer); APP_STATE.saveTimer = null; }
      if (!APP_STATE.demo) {
        api.deleteLog(iso)
          .then(() => { announceSaved(); showSavedIndicator(); })
          .catch(showSaveError);
      } else {
        announceSaved();
        showSavedIndicator();
      }
    }
  };

  count.addEventListener('input', () => {
    const c = clampDrinkCount(count.value);
    countLabel.textContent = c === 1 ? 'drink' : 'drinks';
    updateEntryField(host, iso, { logged: true, count: c });
  });

  note.addEventListener('input', () => {
    updateEntryField(host, iso, { note: note.value.slice(0, NOTE_MAX) });
  });

  host.onkeydown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeBloomEditor({ restoreFocus: true });
  };

  if (focusEditor) count.focus();
}

function wireGridPointerAndOpen() {
  if (APP_STATE.pointerWired) return;
  APP_STATE.pointerWired = true;
  const grid = document.querySelector('[data-grid]');
  if (!grid) return;

  grid.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') {
      if (APP_STATE.activeTouchPointerId !== event.pointerId) return;
      const dot = dotAtPoint(grid, event.clientX, event.clientY);
      if (!dot || dot.disabled) { clearMagnify(grid); return; }
      setMagnify(grid, dot);
      return;
    }
    const dot = event.target instanceof Element ? event.target.closest('.dot') : null;
    if (!(dot instanceof HTMLButtonElement) || dot.disabled) { clearMagnify(grid); return; }
    setMagnify(grid, dot);
  });

  grid.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch' && APP_STATE.activeTouchPointerId !== null) return;
    clearMagnify(grid);
  });

  grid.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    APP_STATE.activeTouchPointerId = event.pointerId;
    const dot = dotAtPoint(grid, event.clientX, event.clientY);
    if (!dot || dot.disabled) { clearMagnify(grid); return; }
    setMagnify(grid, dot);
  });

  grid.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch') return;
    if (APP_STATE.activeTouchPointerId !== event.pointerId) return;
    const dot = dotAtPoint(grid, event.clientX, event.clientY);
    APP_STATE.activeTouchPointerId = null;
    clearMagnify(grid);
    if (!dot || dot.disabled) return;
    APP_STATE.suppressClickUntil = Date.now() + TOUCH_CLICK_SUPPRESS_MS;
    openDay(dot);
  });

  grid.addEventListener('pointercancel', () => {
    APP_STATE.activeTouchPointerId = null;
    clearMagnify(grid);
  });

  grid.addEventListener('click', (event) => {
    const dot = event.target instanceof Element ? event.target.closest('.dot') : null;
    if (!(dot instanceof HTMLButtonElement) || dot.disabled) return;
    if (Date.now() < APP_STATE.suppressClickUntil) {
      event.preventDefault();
      return;
    }
    openDay(dot);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!APP_STATE.openDate) return;
    const host = document.querySelector('[data-bloom-host]');
    const target = event.target instanceof Node ? event.target : null;
    if (!host || !target) return;
    if (host.contains(target)) return;
    if (target instanceof Element && target.closest(`.dot[data-date="${APP_STATE.openDate}"]`)) return;
    // Don't auto-close when clicking inside the avatar sheet (or its backdrop).
    if (target instanceof Element && target.closest('[data-sheet], [data-sheet-backdrop]')) return;
    closeBloomEditor();
  });
}

// =========================================================================
// Layout switching
// =========================================================================

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
  if (!grid) return;

  renderGrid(grid, cfg, startOfDay(new Date()));

  if (key === 'C' && cfg.range === 'rolling26') {
    if (footer) footer.hidden = false;
    if (seeMore) {
      seeMore.hidden = false;
      seeMore.textContent = 'See more — show the full year';
    }
  } else if (footer) {
    footer.hidden = true;
  }
}

function wireSeeMore() {
  if (APP_STATE.seeMoreWired) return;
  const seeMore = document.querySelector('[data-see-more]');
  if (!seeMore) return;
  APP_STATE.seeMoreWired = true;
  seeMore.addEventListener('click', () => {
    const grid = document.querySelector('[data-grid]');
    const footer = document.querySelector('[data-grid-footer]');
    if (!grid) return;
    renderGrid(grid, { orientation: 'vertical', range: 'year' }, startOfDay(new Date()));
    if (footer) footer.hidden = true;
  });
}

// =========================================================================
// API client
// =========================================================================

async function callApi(method, path, body) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { error: text }; }
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const api = {
  me:            ()    => callApi('GET',    '/api/me'),
  login:         (b)   => callApi('POST',   '/api/login', b),
  register:      (b)   => callApi('POST',   '/api/register', b),
  logout:        ()    => callApi('POST',   '/api/logout'),
  getLogs:       ()    => callApi('GET',    '/api/logs'),
  upsertLog:     (b)   => callApi('POST',   '/api/logs', b),
  deleteLog:     (iso) => callApi('DELETE', `/api/logs/${encodeURIComponent(iso)}`),
  addDrink:      ()    => callApi('POST',   '/api/drinks/add'),
  updateAccount: (b)   => callApi('PUT',    '/api/account', b),
  deleteAccount: ()    => callApi('DELETE', '/api/account'),
  updatePassword:(b)   => callApi('PUT',    '/api/account/password', b),
};

// =========================================================================
// Settings (localStorage-backed; safe if storage is unavailable)
// =========================================================================

function safeStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__itspt_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch { return null; }
}

function readSettings() {
  const ls = safeStorage();
  const defaults = { autoOpenWhenAway: true };
  if (!ls) return defaults;
  try {
    const raw = ls.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch { return defaults; }
}

function writeSettings(patch) {
  const ls = safeStorage();
  const current = readSettings();
  const next = { ...current, ...patch };
  if (ls) {
    try { ls.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  return next;
}

function getLastSeenIso() {
  const ls = safeStorage();
  if (!ls) return null;
  try { return ls.getItem(LAST_SEEN_KEY); } catch { return null; }
}

function touchLastSeenIso(iso) {
  const ls = safeStorage();
  if (!ls) return;
  try { ls.setItem(LAST_SEEN_KEY, iso); } catch { /* ignore */ }
}

// =========================================================================
// Last-logged microcopy
// =========================================================================

function findMostRecentLoggedIso(today) {
  // Walk the entries map; find the latest iso ≤ today with logged=true.
  let best = null;
  for (const [iso, entry] of APP_STATE.entriesByDate) {
    if (!entry || entry.logged !== true) continue;
    if (iso > isoDate(today)) continue;
    if (!best || iso > best) best = iso;
  }
  return best;
}

function refreshLastLogged() {
  const el = document.querySelector('[data-last-logged]');
  if (!el) return;
  const today = startOfDay(new Date());
  el.textContent = lastLoggedText(findMostRecentLoggedIso(today), today);
}

// =========================================================================
// Toast (FAB +1 with Undo)
// =========================================================================

function clearToast() {
  const region = document.querySelector('[data-toast-region]');
  if (!region) return;
  region.replaceChildren();
  if (APP_STATE.toastUndoTimer) {
    clearTimeout(APP_STATE.toastUndoTimer);
    APP_STATE.toastUndoTimer = null;
  }
}

function showToast(message, { actionLabel, onAction } = {}) {
  const region = document.querySelector('[data-toast-region]');
  if (!region) return;
  clearToast();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(text);
  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      clearToast();
      onAction();
    });
    toast.append(btn);
  }
  region.append(toast);
  APP_STATE.toastUndoTimer = setTimeout(clearToast, TOAST_DURATION_MS);
}

// =========================================================================
// Quick add (+1 today)
// =========================================================================

function pulseTodayDot() {
  const grid = document.querySelector('[data-grid]');
  const todayDot = grid?.querySelector('.dot[data-today="true"]');
  if (!todayDot) return;
  // If today is currently open in the bloom editor, the dot already has a
  // persistent scale(1.4) ring — don't fight it with a WAAPI animation.
  if (todayDot.dataset.open === 'true') return;
  // Lightweight pulse via Web Animations API; falls back gracefully if missing.
  if (typeof todayDot.animate !== 'function' || isReducedMotion()) return;
  try {
    todayDot.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.45)' },
        { transform: 'scale(1)' },
      ],
      { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
  } catch { /* ignore */ }
}

async function handleQuickAdd() {
  const today = startOfDay(new Date());
  const iso = isoDate(today);
  const previous = normalizeEntry(APP_STATE.entriesByDate.get(iso));
  const optimistic = { logged: true, count: clampDrinkCount(previous.count + 1), note: previous.note };
  APP_STATE.entriesByDate.set(iso, optimistic);
  const grid = document.querySelector('[data-grid]');
  const todayDot = grid?.querySelector(`.dot[data-date="${iso}"]`);
  if (todayDot) setDotFromEntry(todayDot, optimistic);
  refreshLastLogged();
  pulseTodayDot();
  // Update bloom editor too if today is open.
  if (APP_STATE.openDate === iso) {
    const host = document.querySelector('[data-bloom-host]');
    const c = host?.querySelector('[data-count-input]');
    const cl = host?.querySelector('[data-count-label]');
    if (c instanceof HTMLInputElement) c.value = String(optimistic.count);
    if (cl) cl.textContent = optimistic.count === 1 ? 'drink' : 'drinks';
  }

  if (APP_STATE.demo) {
    showToast('+1 for today', {
      actionLabel: 'Undo',
      onAction: () => {
        APP_STATE.entriesByDate.set(iso, previous);
        if (todayDot) setDotFromEntry(todayDot, previous);
        refreshLastLogged();
      },
    });
    return;
  }

  try {
    const res = await api.addDrink();
    // Reconcile with server-authoritative count (handles concurrent updates).
    const reconciled = { logged: true, count: clampDrinkCount(res.drinks), note: previous.note };
    APP_STATE.entriesByDate.set(iso, reconciled);
    if (todayDot) setDotFromEntry(todayDot, reconciled);
    refreshLastLogged();
    showToast('+1 for today', {
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          if (reconciled.count <= 1) {
            await api.deleteLog(iso);
            const cleared = { logged: false, count: 0, note: previous.note };
            APP_STATE.entriesByDate.set(iso, cleared);
            if (todayDot) setDotFromEntry(todayDot, cleared);
          } else {
            const reverted = { logged: true, count: reconciled.count - 1, note: previous.note };
            await api.upsertLog({ date: iso, drinks: reverted.count, note: reverted.note });
            APP_STATE.entriesByDate.set(iso, reverted);
            if (todayDot) setDotFromEntry(todayDot, reverted);
          }
          refreshLastLogged();
          announceLive('undone');
        } catch {
          showToast("couldn't undo");
        }
      },
    });
  } catch (err) {
    // Roll back optimistic update.
    APP_STATE.entriesByDate.set(iso, previous);
    if (todayDot) setDotFromEntry(todayDot, previous);
    refreshLastLogged();
    showToast(err?.status === 401 ? 'please sign in' : "couldn't save — try again");
  }
}

// =========================================================================
// Avatar sheet
// =========================================================================

function ensureSheetHost() {
  let backdrop = document.querySelector('[data-sheet-backdrop]');
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.dataset.sheetBackdrop = 'true';
  backdrop.hidden = true;
  document.body.append(backdrop);
  return backdrop;
}

function closeSheet({ restoreFocus = true } = {}) {
  const backdrop = document.querySelector('[data-sheet-backdrop]');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.replaceChildren();
  }
  const avatar = document.querySelector('[data-avatar]');
  if (avatar) avatar.setAttribute('aria-expanded', 'false');
  APP_STATE.sheetOpen = false;
  if (restoreFocus && avatar instanceof HTMLElement) avatar.focus();
}

function openSheet() {
  if (APP_STATE.sheetOpen) return;
  const backdrop = ensureSheetHost();
  backdrop.hidden = false;
  backdrop.replaceChildren();

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.dataset.sheet = 'true';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'sheet-title');

  const handle = document.createElement('div');
  handle.className = 'sheet-handle';
  handle.setAttribute('aria-hidden', 'true');

  const title = document.createElement('h2');
  title.id = 'sheet-title';
  title.textContent = 'Account & settings';

  // --- Account section ---
  const accountSection = document.createElement('section');
  accountSection.className = 'sheet-section';
  const accH = document.createElement('h3'); accH.textContent = 'Account';
  const nameLabel = document.createElement('label');
  nameLabel.append('Name');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 64;
  nameInput.value = APP_STATE.user?.display_name ?? '';
  nameInput.dataset.acctName = 'true';
  nameInput.autocomplete = 'name';
  nameLabel.append(nameInput);
  const emailLabel = document.createElement('label');
  emailLabel.append('Email');
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.value = APP_STATE.user?.email ?? '';
  emailInput.dataset.acctEmail = 'true';
  emailInput.autocomplete = 'email';
  emailLabel.append(emailInput);
  const acctMsg = document.createElement('p');
  acctMsg.className = 'sheet-msg';
  acctMsg.dataset.acctMsg = 'true';
  acctMsg.setAttribute('role', 'status');
  acctMsg.setAttribute('aria-live', 'polite');
  const acctActions = document.createElement('div');
  acctActions.className = 'sheet-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save changes';
  acctActions.append(saveBtn);
  accountSection.append(accH, nameLabel, emailLabel, acctMsg, acctActions);

  // --- Password section ---
  const passSection = document.createElement('section');
  passSection.className = 'sheet-section';
  const passH = document.createElement('h3'); passH.textContent = 'Change password';
  const currLabel = document.createElement('label'); currLabel.append('Current password');
  const currInput = document.createElement('input');
  currInput.type = 'password'; currInput.autocomplete = 'current-password';
  currLabel.append(currInput);
  const newLabel = document.createElement('label'); newLabel.append('New password (≥ 8 characters)');
  const newInput = document.createElement('input');
  newInput.type = 'password'; newInput.minLength = 8; newInput.autocomplete = 'new-password';
  newLabel.append(newInput);
  const passMsg = document.createElement('p');
  passMsg.className = 'sheet-msg'; passMsg.dataset.passMsg = 'true';
  passMsg.setAttribute('role', 'status');
  passMsg.setAttribute('aria-live', 'polite');
  const passActions = document.createElement('div');
  passActions.className = 'sheet-actions';
  const changeBtn = document.createElement('button');
  changeBtn.type = 'button'; changeBtn.className = 'btn'; changeBtn.textContent = 'Update password';
  passActions.append(changeBtn);
  passSection.append(passH, currLabel, newLabel, passMsg, passActions);

  // --- Settings section ---
  const settingsSection = document.createElement('section');
  settingsSection.className = 'sheet-section';
  const setH = document.createElement('h3'); setH.textContent = 'Settings';
  const settings = readSettings();
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'sheet-toggle';
  const labelText = document.createElement('span');
  labelText.className = 'label-text';
  const strong = document.createElement('strong');
  strong.textContent = 'Auto-open today when I’ve been away';
  const sub = document.createElement('span');
  sub.textContent = "If you haven't logged in a few days, today's card opens for you.";
  labelText.append(strong, sub);
  const switchEl = document.createElement('span');
  switchEl.className = 'switch';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = settings.autoOpenWhenAway === true;
  toggleInput.setAttribute('aria-label', 'Auto-open today when I’ve been away');
  const track = document.createElement('span'); track.className = 'track'; track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('span'); thumb.className = 'thumb'; thumb.setAttribute('aria-hidden', 'true');
  switchEl.append(toggleInput, track, thumb);
  toggleLabel.append(labelText, switchEl);
  settingsSection.append(setH, toggleLabel);

  // --- Danger / session section ---
  const dangerSection = document.createElement('section');
  dangerSection.className = 'sheet-section';
  const dH = document.createElement('h3'); dH.textContent = 'Session';
  const dActions = document.createElement('div');
  dActions.className = 'sheet-actions';
  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button'; logoutBtn.className = 'btn'; logoutBtn.textContent = 'Log out';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button'; deleteBtn.className = 'btn btn-danger'; deleteBtn.textContent = 'Delete account';
  dActions.append(logoutBtn, deleteBtn);
  const dMsg = document.createElement('p');
  dMsg.className = 'sheet-msg'; dMsg.dataset.dangerMsg = 'true';
  dMsg.setAttribute('role', 'status');
  dMsg.setAttribute('aria-live', 'polite');
  dangerSection.append(dH, dActions, dMsg);

  sheet.append(handle, title, accountSection, passSection, settingsSection, dangerSection);
  backdrop.append(sheet);

  // --- Wiring ---

  toggleInput.addEventListener('change', () => {
    writeSettings({ autoOpenWhenAway: toggleInput.checked });
  });

  saveBtn.addEventListener('click', async () => {
    if (APP_STATE.demo) { acctMsg.textContent = 'demo mode — changes not saved'; acctMsg.dataset.tone = 'error'; return; }
    acctMsg.textContent = 'Saving…'; acctMsg.dataset.tone = '';
    try {
      const res = await api.updateAccount({
        email: emailInput.value.trim(),
        display_name: nameInput.value.trim(),
      });
      APP_STATE.user = { ...APP_STATE.user, ...res };
      acctMsg.textContent = 'Saved.'; acctMsg.dataset.tone = 'ok';
      updateAvatarInitial();
    } catch (err) {
      acctMsg.textContent = err?.message || "couldn't save";
      acctMsg.dataset.tone = 'error';
    }
  });

  changeBtn.addEventListener('click', async () => {
    if (APP_STATE.demo) { passMsg.textContent = 'demo mode — password changes disabled'; passMsg.dataset.tone = 'error'; return; }
    if (!currInput.value) { passMsg.textContent = 'Enter your current password.'; passMsg.dataset.tone = 'error'; return; }
    if (newInput.value.length < 8) { passMsg.textContent = 'New password must be at least 8 characters.'; passMsg.dataset.tone = 'error'; return; }
    passMsg.textContent = 'Updating…'; passMsg.dataset.tone = '';
    try {
      await api.updatePassword({ current_password: currInput.value, new_password: newInput.value });
      passMsg.textContent = 'Password updated.'; passMsg.dataset.tone = 'ok';
      currInput.value = ''; newInput.value = '';
    } catch (err) {
      passMsg.textContent = err?.message || "couldn't update password";
      passMsg.dataset.tone = 'error';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    if (APP_STATE.demo) { closeSheet({ restoreFocus: false }); location.search = ''; return; }
    try { await api.logout(); } catch { /* ignore */ }
    APP_STATE.user = null;
    closeSheet({ restoreFocus: false });
    showAuthScreen();
  });

  deleteBtn.addEventListener('click', async () => {
    if (APP_STATE.demo) { dMsg.textContent = 'demo mode — nothing to delete'; dMsg.dataset.tone = 'error'; return; }
    const ok = confirm('Delete your account and all of your logs? This cannot be undone.');
    if (!ok) return;
    try {
      await api.deleteAccount();
      APP_STATE.user = null;
      closeSheet({ restoreFocus: false });
      showAuthScreen();
    } catch (err) {
      dMsg.textContent = err?.message || "couldn't delete";
      dMsg.dataset.tone = 'error';
    }
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSheet();
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    // Basic focus trap — keep tabbing inside the sheet.
    const focusables = Array.from(
      sheet.querySelectorAll(
        'input:not([disabled]):not([type="hidden"]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  const avatar = document.querySelector('[data-avatar]');
  if (avatar) avatar.setAttribute('aria-expanded', 'true');
  APP_STATE.sheetOpen = true;
  // Focus the first interactive element.
  setTimeout(() => { nameInput.focus(); nameInput.select?.(); }, 30);
}

function updateAvatarInitial() {
  const avatarSpan = document.querySelector('[data-avatar-initial]');
  if (!avatarSpan) return;
  if (APP_STATE.demo) {
    avatarSpan.textContent = '·';
    return;
  }
  avatarSpan.textContent = displayInitial(APP_STATE.user?.display_name, APP_STATE.user?.email);
}

function wireAvatar() {
  if (APP_STATE.avatarWired) return;
  const avatar = document.querySelector('[data-avatar]');
  if (!avatar) return;
  APP_STATE.avatarWired = true;
  avatar.addEventListener('click', () => {
    if (APP_STATE.sheetOpen) closeSheet();
    else openSheet();
  });
}

// =========================================================================
// Auth screen
// =========================================================================

function showAuthScreen() {
  const auth = document.querySelector('[data-auth-screen]');
  const app  = document.querySelector('[data-app-root]');
  if (auth) auth.hidden = false;
  if (app) app.hidden = true;
  // Focus the email field.
  const email = document.querySelector('[data-auth-email]');
  if (email instanceof HTMLInputElement) email.focus();
}

function hideAuthScreen() {
  const auth = document.querySelector('[data-auth-screen]');
  const app  = document.querySelector('[data-app-root]');
  if (auth) auth.hidden = true;
  if (app) app.hidden = false;
}

function setAuthMode(mode) {
  const title    = document.querySelector('[data-auth-title]');
  const subtitle = document.querySelector('[data-auth-subtitle]');
  const submit   = document.querySelector('[data-auth-submit]');
  const switchBtn= document.querySelector('[data-auth-switch]');
  const nameField= document.querySelector('[data-auth-name-field]');
  const password = document.querySelector('[data-auth-password]');
  const form     = document.querySelector('[data-auth-form]');
  if (!form) return;
  form.dataset.mode = mode;
  if (mode === 'register') {
    if (title)    title.textContent = 'Create an account';
    if (subtitle) subtitle.textContent = "It's just for you. No tracking, no shame.";
    if (submit)   submit.textContent = 'Create account';
    if (switchBtn)switchBtn.textContent = 'Have an account? Sign in';
    if (nameField)nameField.hidden = false;
    if (password) password.autocomplete = 'new-password';
  } else {
    if (title)    title.textContent = 'Sign in';
    if (subtitle) subtitle.textContent = 'Track your drinks. Quietly. For yourself.';
    if (submit)   submit.textContent = 'Sign in';
    if (switchBtn)switchBtn.textContent = 'Need an account?';
    if (nameField)nameField.hidden = true;
    if (password) password.autocomplete = 'current-password';
  }
}

function wireAuth() {
  if (APP_STATE.authWired) return;
  const form = document.querySelector('[data-auth-form]');
  const switchBtn = document.querySelector('[data-auth-switch]');
  if (!form || !switchBtn) return;
  APP_STATE.authWired = true;
  setAuthMode('login');

  switchBtn.addEventListener('click', () => {
    const current = form.dataset.mode === 'register' ? 'register' : 'login';
    setAuthMode(current === 'register' ? 'login' : 'register');
    const msg = document.querySelector('[data-auth-msg]');
    if (msg) { msg.textContent = ''; msg.dataset.tone = ''; }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const mode = form.dataset.mode === 'register' ? 'register' : 'login';
    const emailEl = document.querySelector('[data-auth-email]');
    const passEl  = document.querySelector('[data-auth-password]');
    const nameEl  = document.querySelector('[data-auth-name]');
    const msg     = document.querySelector('[data-auth-msg]');
    const submit  = document.querySelector('[data-auth-submit]');
    if (!(emailEl instanceof HTMLInputElement) || !(passEl instanceof HTMLInputElement)) return;
    const emailValue = emailEl.value.trim();
    const passValue  = passEl.value;
    const nameValue  = nameEl instanceof HTMLInputElement ? nameEl.value.trim() : '';
    if (!emailValue || !passValue) {
      if (msg) { msg.textContent = 'Please enter your email and password.'; msg.dataset.tone = 'error'; }
      return;
    }
    if (mode === 'register' && passValue.length < 8) {
      if (msg) { msg.textContent = 'Password must be at least 8 characters.'; msg.dataset.tone = 'error'; }
      return;
    }
    if (msg) { msg.textContent = mode === 'register' ? 'Creating account…' : 'Signing in…'; msg.dataset.tone = ''; }
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    try {
      if (mode === 'register') {
        await api.register({ email: emailValue, password: passValue, display_name: nameValue });
        await api.login({ email: emailValue, password: passValue });
      } else {
        await api.login({ email: emailValue, password: passValue });
      }
      if (msg) { msg.textContent = ''; msg.dataset.tone = ''; }
      passEl.value = '';
      void boot();
    } catch (err) {
      if (msg) {
        msg.textContent = err?.message || 'Something went wrong.';
        msg.dataset.tone = 'error';
      }
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
}

// =========================================================================
// Auto-open today when away
// =========================================================================

function maybeAutoOpenToday() {
  const settings = readSettings();
  if (!settings.autoOpenWhenAway) return;
  const today = startOfDay(new Date());
  const todayIso = isoDate(today);
  // Don't auto-open if today already has an entry.
  const existing = APP_STATE.entriesByDate.get(todayIso);
  if (existing && existing.logged) return;
  const last = getLastSeenIso();
  if (last) {
    const delta = daysBetween(parseIsoDate(last), today);
    if (delta < AUTO_OPEN_AWAY_DAYS) return;
  }
  // Open today's bloom card.
  const grid = document.querySelector('[data-grid]');
  const dot = grid?.querySelector(`.dot[data-date="${todayIso}"]`);
  if (dot instanceof HTMLButtonElement && !dot.disabled) {
    openDay(dot, { focusEditor: false });
  }
}

// =========================================================================
// Bootstrapping
// =========================================================================

function logsToEntries(logs) {
  const map = new Map();
  if (!Array.isArray(logs)) return map;
  for (const l of logs) {
    if (!l || typeof l.date !== 'string') continue;
    map.set(l.date, {
      logged: true,
      count: clampDrinkCount(l.drinks ?? 0),
      note: String(l.note ?? ''),
    });
  }
  return map;
}

async function loadEntries() {
  if (APP_STATE.demo) {
    // Mock data is seeded lazily in renderGrid.
    APP_STATE.entriesByDate = new Map();
    return { authExpired: false };
  }
  try {
    const logs = await api.getLogs();
    APP_STATE.entriesByDate = logsToEntries(logs);
    return { authExpired: false };
  } catch (err) {
    if (err?.status === 401) {
      APP_STATE.user = null;
      // Don't render the app shell if the session expired between /api/me and
      // /api/logs — kick back to the auth screen instead of leaving the user
      // staring at an empty grid.
      return { authExpired: true };
    }
    // Other errors → render empty grid; show a quiet error.
    APP_STATE.entriesByDate = new Map();
    announceLive("couldn't load logs");
    return { authExpired: false };
  }
}

function wireQuickAdd() {
  if (APP_STATE.quickAddWired) return;
  const btns = document.querySelectorAll('[data-quick-add], [data-fab]');
  if (!btns.length) return;
  APP_STATE.quickAddWired = true;
  btns.forEach((btn) => {
    btn.addEventListener('click', () => { void handleQuickAdd(); });
  });
}

async function boot() {
  const params = new URLSearchParams(location.search);
  APP_STATE.demo = params.get('demo') === '1';

  if (APP_STATE.demo) {
    APP_STATE.user = null;
    hideAuthScreen();
  } else {
    try {
      const me = await api.me();
      APP_STATE.user = me;
      hideAuthScreen();
    } catch (err) {
      APP_STATE.user = null;
      showAuthScreen();
      return;
    }
  }

  await loadEntries().then((res) => {
    if (res && res.authExpired) {
      showAuthScreen();
      return;
    }
    applyLayout(pickLayout());
    wireSeeMore();
    wireGridKeyboard();
    wireGridPointerAndOpen();
    wireQuickAdd();
    wireAvatar();
    updateAvatarInitial();
    refreshLastLogged();

    // Touch lastSeen and (maybe) auto-open today.
    const today = startOfDay(new Date());
    maybeAutoOpenToday();
    touchLastSeenIso(isoDate(today));
  });
}

if (typeof document !== 'undefined') {
  // Auth wiring is independent of /api/me — wire it once on first load.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      wireAuth();
      void boot();
    }, { once: true });
  } else {
    wireAuth();
    void boot();
  }
}

// =========================================================================
// Named exports for unit testing
// =========================================================================

export {
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
};
