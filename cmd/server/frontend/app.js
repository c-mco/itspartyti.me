// itspartyti.me — frontend
//
// COMMIT 3: interaction pass.
// Grid A/B/C rendering stays intact while we add the JS interaction layer:
// neighbourhood magnify, touch scrub-and-release-to-open, and a bloom editor
// scaffold with autosave behavior (local-only for now; API wiring comes later).

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
const TOUCH_LABEL_OFFSET_X = -20;
const TOUCH_LABEL_OFFSET_Y = -56;
const MOUSE_LABEL_OFFSET_Y = 12;
const TOUCH_CLICK_SUPPRESS_MS = 600;
const WEEKDAY_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_LONG   = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const APP_STATE = {
  entriesByDate: new Map(),
  openDate: null,
  saveTimer: null,
  savedShowTimer: null,
  blurTimer: null,
  savedHideTimer: null,
  activeTouchPointerId: null,
  suppressClickUntil: 0,
  pointerWired: false,
};

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

function magnifyWeight(distance, reducedMotion = false) {
  if (distance < 0 || distance > MAGNIFY_RADIUS) return 0;
  if (reducedMotion) return distance === 0 ? 1 : 0;
  if (distance === 0) return 1;
  if (distance === 1) return 0.6;
  return 0.24;
}

function computeMagnifyLevels(centerIndex, total, reducedMotion = false) {
  const levels = Array.from({ length: total }, () => 0);
  if (centerIndex < 0 || centerIndex >= total) return levels;
  for (let i = 0; i < total; i++) {
    levels[i] = magnifyWeight(Math.abs(i - centerIndex), reducedMotion);
  }
  return levels;
}

function renderGrid(gridEl, { orientation, range }, today) {
  const { days, weeks } = buildDays(range, today);
  const entriesByDate = new Map();

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
    const existing = APP_STATE.entriesByDate.get(iso);
    const seeded = normalizeEntry(mockEntry(date, today));
    const entry = normalizeEntry(existing ?? seeded);
    entriesByDate.set(iso, entry);

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
    // CSS uses ::before/::after for the dot/ring; keep button text empty.
    frag.appendChild(btn);
  }

  gridEl.replaceChildren(frag);
  APP_STATE.entriesByDate = entriesByDate;
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

/**
 * Anchor the horizontal grid (layout A) to today on first render so the
 * most recent week is visible without the user having to scroll. Vertical
 * layouts already render today near the bottom, where the page scroll lands
 * naturally — no work needed there.
 */
function scrollTodayIntoView(gridEl) {
  if (gridEl.dataset.orientation !== 'horizontal') return;
  const todayDot = gridEl.querySelector('.dot[data-today="true"]');
  if (!todayDot) {
    // No "today" in range (shouldn't happen with current ranges) — fall back
    // to scrolling to the end so the most recent week is visible.
    gridEl.scrollLeft = gridEl.scrollWidth;
    return;
  }
  // Place today near the right edge with a bit of breathing room.
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
  const grid = document.querySelector('[data-grid]');
  if (!grid) return;

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
    // horizontal (auto-flow: column): right = next week (+7), down = next day (+1).
    // vertical   (auto-flow: row):    right = next day  (+1), down = next week (+7).
    const step    = orientation === 'vertical' ? 1 : 7;
    const rowStep = orientation === 'vertical' ? 7 : 1;

    let nextIndex = currentIndex;
    let scanStep = 0;
    if (event.key === 'ArrowRight') {
      nextIndex = Math.min(currentIndex + step, dots.length - 1);
      scanStep = 1;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = Math.max(currentIndex - step, 0);
      scanStep = -1;
    } else if (event.key === 'ArrowDown') {
      nextIndex = Math.min(currentIndex + rowStep, dots.length - 1);
      scanStep = 1;
    } else if (event.key === 'ArrowUp') {
      nextIndex = Math.max(currentIndex - rowStep, 0);
      scanStep = -1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
      scanStep = 1;
    } else if (event.key === 'End') {
      nextIndex = dots.length - 1;
      scanStep = -1;
    } else {
      return;
    }

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

function ensureMagnifyLabel() {
  let label = document.querySelector('[data-magnify-label]');
  if (label) return label;
  label = document.createElement('div');
  label.dataset.magnifyLabel = 'true';
  label.hidden = true;
  label.style.position = 'fixed';
  label.style.left = '0';
  label.style.top = '0';
  label.style.transform = 'translate(-9999px,-9999px)';
  label.style.pointerEvents = 'none';
  label.style.zIndex = '30';
  document.body.appendChild(label);
  return label;
}

function clearMagnify(grid) {
  const dots = Array.from(grid.querySelectorAll('.dot'));
  dots.forEach((dot) => {
    delete dot.dataset.magnify;
    delete dot.dataset.magnified;
  });
  const label = ensureMagnifyLabel();
  label.hidden = true;
}

function setMagnify(grid, centerDot, point = null) {
  const dots = Array.from(grid.querySelectorAll('.dot'));
  const centerIndex = dots.indexOf(centerDot);
  if (centerIndex < 0) return;
  const reduced = isReducedMotion();
  const levels = computeMagnifyLevels(centerIndex, dots.length, reduced);

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

  const label = ensureMagnifyLabel();
  const iso = centerDot.dataset.date;
  const entry = APP_STATE.entriesByDate.get(iso) ?? { logged: false, count: 0, note: '' };
  const date = parseIsoDate(iso);
  label.textContent = `${longDate(date)} · ${countSummary(entry)}`;
  label.hidden = false;
  const rect = centerDot.getBoundingClientRect();
  const xRaw = point ? point.clientX + TOUCH_LABEL_OFFSET_X : rect.left + (rect.width / 2);
  const yRaw = point ? point.clientY + TOUCH_LABEL_OFFSET_Y : rect.top - MOUSE_LABEL_OFFSET_Y;
  const x = Math.max(16, Math.min(window.innerWidth - 16, xRaw));
  const y = Math.max(20, Math.min(window.innerHeight - 20, yRaw));
  label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
}

function dotAtPoint(grid, x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const dot = el.closest('.dot');
  if (!(dot instanceof HTMLButtonElement)) return null;
  if (!grid.contains(dot)) return null;
  return dot;
}

function ensureBloomHost() {
  let host = document.querySelector('[data-bloom-host]');
  if (host) return host;
  host = document.createElement('section');
  host.dataset.bloomHost = 'true';
  host.hidden = true;
  const app = document.querySelector('.app');
  const quickAdd = document.querySelector('.quick-add');
  if (app && quickAdd) app.insertBefore(host, quickAdd);
  else if (app) app.appendChild(host);
  return host;
}

function announceSaved() {
  const live = document.querySelector('[data-live]');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => {
    live.textContent = 'saved ✓';
  });
}

function scheduleSave(delay = AUTO_SAVE_IDLE_MS) {
  if (APP_STATE.saveTimer) clearTimeout(APP_STATE.saveTimer);
  if (APP_STATE.savedShowTimer) {
    clearTimeout(APP_STATE.savedShowTimer);
    APP_STATE.savedShowTimer = null;
  }
  APP_STATE.saveTimer = setTimeout(() => {
    APP_STATE.saveTimer = null;
    announceSaved();
    const saved = document.querySelector('[data-bloom-saved]');
    if (!saved) return;
    APP_STATE.savedShowTimer = setTimeout(() => {
      APP_STATE.savedShowTimer = null;
      saved.hidden = false;
      if (APP_STATE.savedHideTimer) clearTimeout(APP_STATE.savedHideTimer);
      APP_STATE.savedHideTimer = setTimeout(() => {
        saved.hidden = true;
        APP_STATE.savedHideTimer = null;
      }, 1200);
    }, 16);
  }, delay);
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
  controls.append(minus, count, plus);

  const note = document.createElement('textarea');
  note.dataset.noteInput = 'true';
  note.maxLength = NOTE_MAX;
  note.rows = 3;
  note.placeholder = 'Add a note';
  note.value = entry.note;

  const noteCount = document.createElement('p');
  noteCount.dataset.noteCount = 'true';
  noteCount.setAttribute('role', 'status');
  noteCount.setAttribute('aria-live', 'polite');
  noteCount.hidden = true;

  const saved = document.createElement('p');
  saved.dataset.bloomSaved = 'true';
  saved.textContent = 'saved ✓';
  saved.hidden = true;

  const del = document.createElement('button');
  del.type = 'button';
  del.dataset.deleteDay = 'true';
  del.textContent = 'Delete';
  del.setAttribute('aria-label', `Delete entry for ${longDate(parseIsoDate(iso))}`);
  del.hidden = !entry.logged && entry.note.length === 0;

  host.append(title, controls, note, noteCount, saved, del);
  updateBloomCharCount(host, entry.note.length);

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
      const next = { ...current, logged: true, count: clampDrinkCount(current.count + delta) };
      APP_STATE.entriesByDate.set(iso, next);
      count.value = String(next.count);
      del.hidden = false;
      updateOpenDotFromEditor(host);
      scheduleSave();
      return;
    }
    if (target.dataset.deleteDay === 'true') {
      const cleared = { logged: false, count: 0, note: '' };
      APP_STATE.entriesByDate.set(iso, cleared);
      count.value = '0';
      note.value = '';
      del.hidden = true;
      updateOpenDotFromEditor(host);
      scheduleSave(0);
    }
  };

  count.addEventListener('input', () => {
    updateEntryField(host, iso, {
      logged: true,
      count: clampDrinkCount(count.value),
    });
  });

  note.addEventListener('input', () => {
    updateEntryField(host, iso, {
      note: note.value.slice(0, NOTE_MAX),
    });
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
      if (!dot || dot.disabled) {
        clearMagnify(grid);
        return;
      }
      setMagnify(grid, dot, event);
      return;
    }
    const dot = event.target instanceof Element ? event.target.closest('.dot') : null;
    if (!(dot instanceof HTMLButtonElement) || dot.disabled) {
      clearMagnify(grid);
      return;
    }
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
    if (!dot || dot.disabled) {
      clearMagnify(grid);
      return;
    }
    setMagnify(grid, dot, event);
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
    closeBloomEditor();
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
  wireGridPointerAndOpen();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

// Named exports for unit testing — harmless in a browser module context.
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
};
