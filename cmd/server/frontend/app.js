'use strict';

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_ABBR  = ['J','F','M','A','M','J','J','A','S','O','N','D'];

// River view: each day = BAR_W + BAR_GAP pixels wide
const BAR_W    = 5;
const BAR_GAP  = 1;
const BAR_STEP = BAR_W + BAR_GAP;  // 6px per day
const RIVER_MAX_H = 100;           // max bar height in px

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

/** Zero-pad a number to 2 digits. */
const pad = n => String(n).padStart(2, '0');

/** Format a Date object as YYYY-MM-DD using local time. */
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's date as a YYYY-MM-DD string. */
function todayStr() { return fmtDate(new Date()); }

/** Parse a YYYY-MM-DD string as a local-timezone Date (avoids UTC offset issues). */
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Number of days in a given month. m = 1–12. */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Is a YYYY-MM-DD date string strictly in the future? */
function isFuture(dateStr) { return dateStr > todayStr(); }

/** CSS colour-class for a drink count (null = not logged). */
function drinkClass(n) {
  if (n == null) return 'none';
  if (n === 0)   return 'sober';
  if (n <= 2)    return 'light';
  if (n <= 4)    return 'moderate';
  return 'heavy';
}

/** Escape HTML special characters for safe innerHTML insertion. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** getElementById shorthand. */
const $id = id => document.getElementById(id);

/**
 * Create a DOM element with attributes and optional text content.
 * Skips attributes whose value is undefined, null, or empty string.
 */
function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null && v !== '') e.setAttribute(k, String(v));
  }
  if (text != null) e.textContent = text;
  return e;
}

/* ═══════════════════════════════════════════════════════════════
   API LAYER
   ═══════════════════════════════════════════════════════════════ */

class APIError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const api = {
  async req(method, path, body) {
    const init = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body != null) init.body = JSON.stringify(body);
    const res  = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new APIError(res.status, data.error || 'Request failed');
    return data;
  },
  get:  p     => api.req('GET',    p),
  post: (p,b) => api.req('POST',   p, b),
  del:  p     => api.req('DELETE', p),
};

/* ═══════════════════════════════════════════════════════════════
   APPLICATION STATE
   All views read from this shared object — data is loaded once
   on login and mutated in-place after saves/deletes.
   ═══════════════════════════════════════════════════════════════ */

const S = {
  user:           null,           // logged-in username string
  logs:           [],             // array of log objects from API
  stats:          null,           // stats object from API
  map:            new Map(),      // date string → log object  (derived)
  view:           'year',         // active view: 'year' | 'river' | 'month'
  yearView:       new Date().getFullYear(),   // year shown in Year view
  monthView:      new Date().getMonth(),      // month shown in Month view (0-indexed)
  yearTransposed: localStorage.getItem('yearTransposed') === '1',  // swap X/Y axes
  modal:          { date: null },
};

/** Rebuild the fast-lookup map from S.logs. Call after every mutation. */
function rebuildMap() {
  S.map = new Map(S.logs.map(l => [l.date, l]));
}

/* ═══════════════════════════════════════════════════════════════
   AUTH SCREEN
   ═══════════════════════════════════════════════════════════════ */

function showAuth() {
  $id('main-screen').hidden = true;
  $id('auth-screen').hidden = false;
}

function showMain() {
  $id('auth-screen').hidden = true;
  $id('main-screen').hidden = false;
  $id('btn-account-toggle').textContent = S.user + ' ▾';
  loadAllData();
}

async function checkAuth() {
  try {
    const d = await api.get('/api/me');
    S.user = d.username;
    showMain();
  } catch {
    showAuth();
  }
}

function initAuthForms() {
  // Tab switching
  $id('auth-screen').querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $id('auth-screen').querySelectorAll('.auth-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const tab = btn.dataset.tab;
      $id('panel-login').hidden    = tab !== 'login';
      $id('panel-register').hidden = tab !== 'register';
    });
  });

  // Login
  $id('form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const submit = e.target.querySelector('[type=submit]');
    const errEl  = $id('err-login');
    errEl.textContent = '';
    submit.disabled   = true;
    try {
      const d = await api.post('/api/login', {
        username: $id('login-user').value.trim(),
        password: $id('login-pass').value,
      });
      S.user = d.username;
      showMain();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  // Register → auto-login
  $id('form-register').addEventListener('submit', async e => {
    e.preventDefault();
    const submit = e.target.querySelector('[type=submit]');
    const errEl  = $id('err-register');
    errEl.textContent = '';
    submit.disabled   = true;
    try {
      const username = $id('reg-user').value.trim();
      const password = $id('reg-pass').value;
      await api.post('/api/register', { username, password });
      const d = await api.post('/api/login', { username, password });
      S.user = d.username;
      showMain();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function initLogout() {
  $id('btn-logout').addEventListener('click', async () => {
    try { await api.post('/api/logout'); } catch { /* ignore */ }
    S.user = null; S.logs = []; S.stats = null; S.map.clear();
    showAuth();
  });
}

/* ═══════════════════════════════════════════════════════════════
   DATA LOADING
   Load logs + stats once on login. All views use S.map.
   ═══════════════════════════════════════════════════════════════ */

async function loadAllData() {
  const ms = $id('main-screen');
  ms.dataset.loading = '1';
  try {
    const [logs, stats] = await Promise.all([
      api.get('/api/logs'),
      api.get('/api/stats'),
    ]);
    S.logs  = logs  || [];
    S.stats = stats;
    rebuildMap();
    renderCurrentView();
    renderStats();
  } catch (e) {
    console.error('loadAllData:', e);
  } finally {
    delete ms.dataset.loading;
  }
}

/** Refresh only the stats strip (after a save or delete). */
async function refreshStats() {
  try {
    S.stats = await api.get('/api/stats');
    renderStats();
  } catch { /* ignore */ }
}

/* ── In-memory log mutations (no re-fetch needed) ── */

function applyLogSave(log) {
  const i = S.logs.findIndex(l => l.date === log.date);
  if (i >= 0) S.logs[i] = log;
  else        S.logs.push(log);
  rebuildMap();
}

function applyLogDelete(date) {
  S.logs = S.logs.filter(l => l.date !== date);
  rebuildMap();
}

/* ═══════════════════════════════════════════════════════════════
   LOG MODAL  (shared by all three views)
   ═══════════════════════════════════════════════════════════════ */

let _saving = false;
let _deleteConfirmPending = false;
let _accountDeletePending = false;

function openModal(dateStr) {
  if (isFuture(dateStr)) return;
  S.modal.date = dateStr;

  const log = S.map.get(dateStr);
  $id('modal-date').textContent =
    parseDate(dateStr).toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  $id('input-drinks').value     = log ? log.drinks : 0;
  $id('input-note').value       = log ? (log.note  || '') : '';
  $id('modal-err').textContent  = '';
  $id('btn-modal-delete').hidden = !log;

  _deleteConfirmPending = false;
  $id('modal').hidden = false;
}

function closeModal() {
  _deleteConfirmPending = false;
  const delBtn = $id('btn-modal-delete');
  delBtn.textContent = 'delete';
  delBtn.classList.remove('btn-danger');
  delBtn.classList.add('btn-ghost');
  $id('modal').hidden = true;
  S.modal.date = null;
}

function initModal() {
  $id('btn-modal-close').addEventListener('click',  closeModal);
  $id('btn-modal-cancel').addEventListener('click', closeModal);

  $id('modal').addEventListener('click', e => {
    if (e.target === $id('modal')) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$id('modal').hidden) closeModal();
  });

  // Drink count stepper
  $id('btn-dec').addEventListener('click', () => {
    const v = parseInt($id('input-drinks').value, 10) || 0;
    $id('input-drinks').value = Math.max(0, v - 1);
  });
  $id('btn-inc').addEventListener('click', () => {
    const v = parseInt($id('input-drinks').value, 10) || 0;
    $id('input-drinks').value = Math.min(100, v + 1);
  });

  // Save — debounced with _saving flag
  $id('btn-modal-save').addEventListener('click', async () => {
    if (_saving) return;
    const drinks = parseInt($id('input-drinks').value, 10);
    if (isNaN(drinks) || drinks < 0 || drinks > 100) {
      $id('modal-err').textContent = 'Enter a number from 0 to 100.';
      return;
    }
    _saving = true;
    try {
      const saved = await api.post('/api/logs', {
        date:   S.modal.date,
        drinks,
        note:   $id('input-note').value.trim(),
      });
      applyLogSave(saved); // update S.map immediately
      closeModal();
      renderCurrentView(); // re-render from updated map — no reload
      refreshStats();
    } catch (err) {
      $id('modal-err').textContent = err.message;
    } finally {
      _saving = false;
    }
  });

  // Delete entry — two-tap confirm, no native dialog
  $id('btn-modal-delete').addEventListener('click', async () => {
    if (!_deleteConfirmPending) {
      _deleteConfirmPending = true;
      const btn = $id('btn-modal-delete');
      btn.textContent = 'confirm delete';
      btn.classList.remove('btn-ghost');
      btn.classList.add('btn-danger');
      return;
    }
    try {
      await api.del(`/api/logs/${S.modal.date}`);
      applyLogDelete(S.modal.date);
      closeModal();
      renderCurrentView();
      refreshStats();
    } catch (err) {
      $id('modal-err').textContent = err.message;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   STATS STRIP
   ═══════════════════════════════════════════════════════════════ */

function renderStats() {
  const s = S.stats;
  if (!s) return;
  $id('st-week').textContent   = s.total_this_week;
  $id('st-month').textContent  = s.total_this_month;
  $id('st-all').textContent    = s.total_all_time;
  $id('st-streak').textContent = s.current_streak + 'd';
  $id('st-best').textContent   = s.longest_streak + 'd';
  $id('st-avg').textContent    = s.avg_drinking_days || '—';
  $id('st-sober').textContent  = s.pct_sober_days  + '%';
}

/* ═══════════════════════════════════════════════════════════════
   VIEW ROUTING
   ═══════════════════════════════════════════════════════════════ */

function switchView(name) {
  if (S.view === name) return;
  S.view = name;
  document.querySelectorAll('.view-tab').forEach(btn => {
    const active = btn.dataset.view === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  ['year', 'river', 'month', 'journal'].forEach(v => {
    $id(`panel-${v}`).hidden = v !== name;
  });
  $id('journal-scrubber').hidden = name !== 'journal';
  renderCurrentView();
}

function renderCurrentView() {
  switch (S.view) {
    case 'year':    renderYearGrid();  break;
    case 'river':   renderRiver();     break;
    case 'month':   renderMonthGrid(); break;
    case 'journal': renderJournal();   break;
  }
}

function initViewTabs() {
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: YEAR GRID
   Rows = days 1–31, columns = months Jan–Dec.
   Colour encodes drink level per cell.
   Mobile: loupe magnifier follows the finger (see below).
   ═══════════════════════════════════════════════════════════════ */

/**
 * Build a single year-grid cell for (month m+1, day).
 * row/col are the logical grid coordinates used for magnification distance math.
 */
function _ygridCell(year, m, day, today, row, col) {
  if (day > daysInMonth(year, m + 1)) {
    return el('div', { class: 'ygrid-cell invalid', 'aria-hidden': 'true',
                       'data-row': row, 'data-col': col });
  }
  const dateStr = `${year}-${pad(m + 1)}-${pad(day)}`;
  const log     = S.map.get(dateStr);
  const future  = dateStr > today;
  const isToday = dateStr === today;
  const dc      = drinkClass(log != null ? log.drinks : null);

  const classes = ['ygrid-cell', dc, future ? 'future' : '', isToday ? 'is-today' : '']
    .filter(Boolean).join(' ');
  const attrs = { class: classes, 'data-date': dateStr, 'data-row': row, 'data-col': col };
  if (!future) {
    attrs.role     = 'gridcell';
    attrs.tabindex = '0';
    const drinks   = log != null ? log.drinks : null;
    const dText    = drinks == null ? 'not logged'
      : drinks === 0 ? 'sober'
      : `${drinks} drink${drinks !== 1 ? 's' : ''}`;
    attrs['aria-label'] = `${dateStr}: ${dText}`;
  }
  return el('div', attrs);
}

function renderYearGrid() {
  const year  = S.yearView;
  const today = todayStr();
  const grid  = $id('year-grid');

  const currentYear = new Date().getFullYear();
  $id('year-label').textContent = year;
  $id('btn-year-next').disabled = year >= currentYear;
  $id('btn-year-today').hidden  = year >= currentYear;

  const transposed = S.yearTransposed;
  grid.classList.toggle('transposed', transposed);
  $id('btn-year-transpose').classList.toggle('active', transposed);
  grid.setAttribute('aria-label', transposed
    ? 'Yearly drink heatmap. Rows are months, columns are days.'
    : 'Yearly drink heatmap. Columns are months, rows are days.');

  const frag = document.createDocumentFragment();

  if (transposed) {
    // ── Transposed: columns = days 1–31, rows = months ──
    // Header row: blank corner + day labels 1–31
    frag.appendChild(el('div', { class: 'ygrid-corner', 'aria-hidden': 'true' }));
    for (let day = 1; day <= 31; day++) {
      frag.appendChild(el('div', { class: 'ygrid-dlbl', 'aria-hidden': 'true' }, day));
    }
    // Month rows — row = month index, col = day index
    for (let m = 0; m < 12; m++) {
      frag.appendChild(el('div', { class: 'ygrid-mhdr', 'aria-hidden': 'true' }, MONTHS_ABBR[m]));
      for (let day = 1; day <= 31; day++) {
        frag.appendChild(_ygridCell(year, m, day, today, m, day - 1));
      }
    }
  } else {
    // ── Normal: columns = months, rows = days 1–31 ──
    // Header row: blank corner + month abbreviations
    frag.appendChild(el('div', { class: 'ygrid-corner', 'aria-hidden': 'true' }));
    for (let m = 0; m < 12; m++) {
      frag.appendChild(el('div', { class: 'ygrid-mhdr', 'aria-hidden': 'true' }, MONTHS_ABBR[m]));
    }
    // Day rows 1–31 — row = day index, col = month index
    for (let day = 1; day <= 31; day++) {
      frag.appendChild(el('div', { class: 'ygrid-dlbl', 'aria-hidden': 'true' }, day));
      for (let m = 0; m < 12; m++) {
        frag.appendChild(_ygridCell(year, m, day, today, day - 1, m));
      }
    }
  }

  grid.replaceChildren(frag);

  // Event delegation — one handler for the whole grid
  grid.onclick = e => {
    const cell = e.target.closest('.ygrid-cell[data-date]');
    if (cell && !cell.classList.contains('future')) openModal(cell.dataset.date);
  };
  grid.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cell = e.target.closest('.ygrid-cell[data-date]');
    if (cell && !cell.classList.contains('future')) {
      e.preventDefault();
      openModal(cell.dataset.date);
    }
  };
}

function initYearTranspose() {
  $id('btn-year-transpose').addEventListener('click', () => {
    S.yearTransposed = !S.yearTransposed;
    localStorage.setItem('yearTransposed', S.yearTransposed ? '1' : '0');
    renderYearGrid();
  });
}

function initYearNav() {
  $id('btn-year-prev').addEventListener('click', () => {
    S.yearView--;
    renderYearGrid();
  });
  $id('btn-year-next').addEventListener('click', () => {
    if (S.yearView < new Date().getFullYear()) {
      S.yearView++;
      renderYearGrid();
    }
  });
  $id('btn-year-today').addEventListener('click', () => {
    S.yearView = new Date().getFullYear();
    renderYearGrid();
  });
}

/* ─── Scrub: dock-magnification touch interaction for year grid ──
   Touch and hold/drag across the year grid to scrub through cells.
   Nearby cells scale up (dock magnification). A small bubble above
   the finger shows the date and drink count. Lifting the finger
   on a cell opens the log modal.

   Gesture disambiguation:
   - Horizontal swipe (dx > dy * 1.8): treated as scroll → not intercepted
   - Hold, tap, or non-horizontal drag: selection mode → preventDefault
   ─────────────────────────────────────────────────────────────── */

const _SCRUB_LIFT = 72; // px: offset hit-test above finger so magnified area is visible

let _scrubActive   = false;  // currently in selection mode
let _scrollGesture = false;  // committed to letting browser handle scroll
let _scrubStartX   = 0;
let _scrubStartY   = 0;
let _scrubCell     = null;   // cell currently under the finger
let _scaledCells   = new Map(); // cell el → applied scale value
let _scrubActiveCell = null;  // cell with scrub-active ring

function initYearScrub() {
  const wrap = $id('year-scroll-outer');
  // Non-passive so we can call preventDefault when in scrub mode
  wrap.addEventListener('touchstart',  _scrubTouchStart,  { passive: false });
  wrap.addEventListener('touchmove',   _scrubTouchMove,   { passive: false });
  wrap.addEventListener('touchend',    _scrubTouchEnd,    { passive: false });
  wrap.addEventListener('touchcancel', _scrubTouchCancel, { passive: false });
}

function _scrubTouchStart(e) {
  const t      = e.touches[0];
  _scrubActive   = false;
  _scrollGesture = false;
  _scrubStartX   = t.clientX;
  _scrubStartY   = t.clientY;
  _scrubCell     = null;
}

function _scrubTouchMove(e) {
  const t  = e.touches[0];
  const dx = Math.abs(t.clientX - _scrubStartX);
  const dy = Math.abs(t.clientY - _scrubStartY);

  // Commit to a gesture type once the finger has moved enough
  if (!_scrubActive && !_scrollGesture && dx + dy > 8) {
    if (dx > dy * 1.8) {
      _scrollGesture = true; // horizontal pan → let browser scroll
    } else {
      _scrubActive = true;   // tap/hold/drag → selection mode
    }
  }

  if (_scrubActive) {
    e.preventDefault(); // stop page + container scroll
    $id('year-scroll-outer').classList.add('scrubbing');

    const cell = _scrubCellAt(t.clientX, t.clientY - _SCRUB_LIFT);
    if (cell !== _scrubCell) {
      _scrubCell = cell;
      if (cell) {
        _applyMagnification(cell);
        _showScrubBubble(cell, t.clientX, t.clientY);
      } else {
        _clearMagnification();
        _hideScrubBubble();
      }
    } else if (cell) {
      // Update bubble position as finger moves
      _showScrubBubble(cell, t.clientX, t.clientY);
    }
  }
}

function _scrubTouchEnd(e) {
  if (_scrubActive) {
    e.preventDefault(); // prevent synthesised click so modal doesn't open twice
    _clearMagnification();
    _hideScrubBubble();
    $id('year-scroll-outer').classList.remove('scrubbing');

    // Open the modal for whatever cell the finger lifted on (same offset as move)
    const t    = e.changedTouches[0];
    const cell = _scrubCellAt(t.clientX, t.clientY - _SCRUB_LIFT) || _scrubCell;
    if (cell && !cell.classList.contains('future') && !cell.classList.contains('invalid')) {
      openModal(cell.dataset.date);
    }
  }
  _scrubActive   = false;
  _scrollGesture = false;
  _scrubCell     = null;
}

function _scrubTouchCancel() {
  _clearMagnification();
  _hideScrubBubble();
  $id('year-scroll-outer').classList.remove('scrubbing');
  _scrubActive   = false;
  _scrollGesture = false;
  _scrubCell     = null;
}

/** Find the grid cell at viewport coords (x, y) using data-row/col lookup. */
function _scrubCellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest('.ygrid-cell[data-date]') ?? null;
}

/**
 * Apply dock-style magnification centred on `centerCell`.
 * Uses data-row / data-col attributes for distance math — no layout reads.
 * Max scale: 2.2× at centre, tapering to 1× at radius 3.5 cells.
 */
function _applyMagnification(centerCell) {
  const cr = +centerCell.dataset.row;
  const cc = +centerCell.dataset.col;
  const RADIUS    = 3.5;
  const MAX_SCALE = 2.2;

  const newMap = new Map();

  // Collect all data cells from the rendered grid
  const cells = $id('year-grid').querySelectorAll('.ygrid-cell');

  // Phase 1: compute scales (reads only — no DOM writes yet)
  for (const cell of cells) {
    const dr   = +cell.dataset.row - cr;
    const dc   = +cell.dataset.col - cc;
    const dist = Math.sqrt(dr * dr + dc * dc);
    if (dist < RADIUS) {
      const t     = Math.pow(1 - dist / RADIUS, 1.6); // falloff curve
      const scale = 1 + (MAX_SCALE - 1) * t;
      newMap.set(cell, scale);
    }
  }

  // Phase 2: apply (writes — no reads)
  for (const [cell] of _scaledCells) {
    if (!newMap.has(cell)) {
      cell.style.transform = '';
      cell.style.zIndex    = '';
    }
  }
  for (const [cell, scale] of newMap) {
    cell.style.transform = `scale(${scale.toFixed(3)})`;
    cell.style.zIndex    = String(Math.round(scale * 10));
  }

  _scaledCells = newMap;

  // Ring on the active center cell
  if (_scrubActiveCell && _scrubActiveCell !== centerCell) {
    _scrubActiveCell.classList.remove('scrub-active');
  }
  centerCell.classList.add('scrub-active');
  _scrubActiveCell = centerCell;
}

function _clearMagnification() {
  for (const [cell] of _scaledCells) {
    cell.style.transform = '';
    cell.style.zIndex    = '';
  }
  _scaledCells.clear();
  if (_scrubActiveCell) {
    _scrubActiveCell.classList.remove('scrub-active');
    _scrubActiveCell = null;
  }
}

/** Show the scrub info bubble above the touch point. */
function _showScrubBubble(cell, x, y) {
  const dateStr    = cell.dataset.date;
  const log        = S.map.get(dateStr);
  const d          = parseDate(dateStr);
  const dateLabel  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const drinkLabel = log == null  ? '—'
    : log.drinks === 0            ? 'sober'
    : `${log.drinks} drink${log.drinks !== 1 ? 's' : ''}`;

  const bubble = $id('scrub-bubble');
  bubble.querySelector('.scrub-bubble-date').textContent  = dateLabel;
  bubble.querySelector('.scrub-bubble-count').textContent = drinkLabel;

  // Position above the selected cell (which is _SCRUB_LIFT above the finger)
  const margin = 8;
  const bh     = bubble.offsetHeight || 36;
  let   by     = y - _SCRUB_LIFT - bh - 8;
  if (by < margin) by = margin; // clamp to top of viewport

  bubble.style.left = `${x}px`;
  bubble.style.top  = `${by}px`;
  bubble.hidden     = false;
}

function _hideScrubBubble() {
  $id('scrub-bubble').hidden = true;
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: TIMELINE RIVER
   Every day of the current year as a vertical bar.
   Bar height is proportional to drink count.
   Scrolls horizontally — automatically positions today ~25% from left.
   ═══════════════════════════════════════════════════════════════ */

function renderRiver() {
  const year  = new Date().getFullYear(); // river always shows current year
  const today = todayStr();

  // Auto-scale: use max drinks in data, minimum 5
  let maxDrinks = 0;
  S.logs.forEach(l => { if (l.drinks > maxDrinks) maxDrinks = l.drinks; });
  const scale = Math.max(maxDrinks, 5);

  const barsEl   = $id('river-bars');
  const monthsEl = $id('river-months');
  const yEl      = $id('river-y');

  // ── Y axis ticks ──
  const yFrag = document.createDocumentFragment();
  yEl.style.height = `${RIVER_MAX_H + 20}px`; // bars + month label row below
  const tickStep = Math.max(1, Math.ceil(scale / 4));
  for (let v = scale; v >= 0; v -= tickStep) {
    yFrag.appendChild(el('span', { class: 'river-y-tick' }, v));
  }
  yEl.replaceChildren(yFrag);

  // ── Bars and month labels ──
  const barFrag   = document.createDocumentFragment();
  const monthFrag = document.createDocumentFragment();
  let todayIndex  = -1;
  let dayIndex    = 0;

  for (let m = 0; m < 12; m++) {
    const days = daysInMonth(year, m + 1);

    // Month label — width matches the number of bars for that month
    const label = el('div', { class: 'river-month-label' }, MONTHS_SHORT[m]);
    label.style.width    = `${days * BAR_STEP}px`;
    label.style.minWidth = `${days * BAR_STEP}px`;
    monthFrag.appendChild(label);

    for (let d = 1; d <= days; d++) {
      const dateStr = `${year}-${pad(m + 1)}-${pad(d)}`;
      const log     = S.map.get(dateStr);
      const future  = dateStr > today;
      const isToday = dateStr === today;

      if (isToday) todayIndex = dayIndex;

      // Determine bar height and colour class
      let h, dc;
      if (future) {
        h = 2; dc = 'future';
      } else if (log == null) {
        h = 2; dc = 'none';         // unlogged: thin stub, barely visible
      } else if (log.drinks === 0) {
        h = 4; dc = 'sober';        // sober: small but distinct
      } else {
        h  = Math.max(6, Math.round((log.drinks / scale) * RIVER_MAX_H));
        dc = drinkClass(log.drinks);
      }

      const bar = el('div', {
        class:       `river-bar ${dc}${isToday ? ' is-today' : ''}`,
        'data-date': dateStr,
        role:        future ? undefined : 'button',
        tabindex:    future ? '-1' : '0',
        'aria-label': future ? undefined : (() => {
          const dl = parseDate(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const dk = log == null ? 'not logged'
            : log.drinks === 0   ? 'sober'
            : `${log.drinks} drinks`;
          return `${dl}: ${dk}`;
        })(),
      });
      bar.style.height = `${h}px`;
      barFrag.appendChild(bar);
      dayIndex++;
    }
  }

  barsEl.replaceChildren(barFrag);
  monthsEl.replaceChildren(monthFrag);

  // Event delegation
  barsEl.onclick = e => {
    const bar = e.target.closest('.river-bar[data-date]');
    if (bar && !bar.classList.contains('future')) openModal(bar.dataset.date);
  };
  barsEl.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const bar = e.target.closest('.river-bar[data-date]');
    if (bar && !bar.classList.contains('future')) {
      e.preventDefault();
      openModal(bar.dataset.date);
    }
  };

  // Scroll so today is visible ~25% from the left
  if (todayIndex >= 0) {
    requestAnimationFrame(() => {
      const scroll = $id('river-scroll');
      scroll.scrollLeft = Math.max(0, todayIndex * BAR_STEP - scroll.clientWidth * 0.25);
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: MONTH GRID
   Standard Mon–Sun calendar. Drink count shown in each cell.
   ═══════════════════════════════════════════════════════════════ */

function renderMonthGrid() {
  const year  = S.yearView;
  const month = S.monthView;   // 0-indexed
  const today = todayStr();
  const now   = new Date();

  $id('month-label').textContent =
    new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  // Disable "next" and show "today" based on whether we're at the current month
  const atCurrentMonth =
    year > now.getFullYear() ||
    (year === now.getFullYear() && month >= now.getMonth());
  $id('btn-month-next').disabled  = atCurrentMonth;
  $id('btn-month-today').hidden   = atCurrentMonth;

  const grid = $id('month-grid');

  // Keep the 7 static header cells; clear everything else
  const headers = Array.from(grid.querySelectorAll('.mcell-hdr'));
  grid.replaceChildren(...headers);

  // Empty offset slots (Monday = 0, …, Sunday = 6)
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const frag   = document.createDocumentFragment();

  for (let i = 0; i < offset; i++) {
    frag.appendChild(el('div', { class: 'mcell empty', 'aria-hidden': 'true' }));
  }

  const total = daysInMonth(year, month + 1);
  for (let d = 1; d <= total; d++) {
    const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`;
    const log     = S.map.get(dateStr);
    const future  = dateStr > today;
    const isToday = dateStr === today;
    const dc      = drinkClass(log != null ? log.drinks : null);

    const classes = ['mcell', dc, future ? 'future' : '', isToday ? 'is-today' : '']
      .filter(Boolean).join(' ');
    const attrs   = { class: classes, 'data-date': dateStr };

    if (!future) {
      attrs.role     = 'gridcell';
      attrs.tabindex = '0';
      const dText    = log == null ? 'not logged'
        : log.drinks === 0 ? 'sober'
        : `${log.drinks} drink${log.drinks !== 1 ? 's' : ''}`;
      attrs['aria-label'] = `${dateStr}: ${dText}`;
    }

    const cell = el('div', attrs);
    cell.appendChild(el('span', { class: 'mcell-num', 'aria-hidden': 'true' }, d));
    frag.appendChild(cell);
  }

  grid.appendChild(frag);

  // Event delegation
  grid.onclick = e => {
    const cell = e.target.closest('.mcell[data-date]');
    if (cell && !cell.classList.contains('future')) openModal(cell.dataset.date);
  };
  grid.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cell = e.target.closest('.mcell[data-date]');
    if (cell && !cell.classList.contains('future')) {
      e.preventDefault();
      openModal(cell.dataset.date);
    }
  };
}

function initMonthNav() {
  $id('btn-month-prev').addEventListener('click', () => {
    S.monthView--;
    if (S.monthView < 0) { S.monthView = 11; S.yearView--; }
    if (S.view === 'month') renderMonthGrid();
  });
  $id('btn-month-next').addEventListener('click', () => {
    const now      = new Date();
    const atLimit  =
      S.yearView > now.getFullYear() ||
      (S.yearView === now.getFullYear() && S.monthView >= now.getMonth());
    if (!atLimit) {
      S.monthView++;
      if (S.monthView > 11) { S.monthView = 0; S.yearView++; }
      if (S.view === 'month') renderMonthGrid();
    }
  });
  $id('btn-month-today').addEventListener('click', () => {
    const now = new Date();
    S.yearView  = now.getFullYear();
    S.monthView = now.getMonth();
    renderMonthGrid();
  });
}

/* ═══════════════════════════════════════════════════════════════
   QUICK-ADD (+1 BUTTON)
   Optimistic UI: the count updates instantly; the API call is
   deferred until the 5-second undo toast expires (or is dismissed).
   Rapid taps are coalesced — only one network request fires per batch.
   ═══════════════════════════════════════════════════════════════ */

let _qaOriginal = null; // snapshot of {drinks, note, id} before this batch
let _qaTarget   = 0;    // optimistic target count
let _qaTimer    = null; // setTimeout handle for the deferred commit

function initQuickAdd() {
  $id('btn-quickadd').addEventListener('click', handleQuickAdd);
  $id('btn-quickadd-undo').addEventListener('click', undoQuickAdd);
}

/** Spray rising bubbles from the +1 button — called on each tap. */
function spawnBubbles() {
  const btn  = $id('btn-quickadd');
  const rect = btn.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;

  // Colours: mostly white/pearl, some golden/amber for the beer vibe
  const colours = [
    'rgba(255,255,255,0.75)',
    'rgba(255,255,255,0.55)',
    'rgba(255,220,100,0.65)',
    'rgba(255,200,60,0.50)',
    'rgba(255,255,255,0.85)',
  ];

  const count = 10 + Math.floor(Math.random() * 6); // 10–15 per tap
  for (let i = 0; i < count; i++) {
    const b     = document.createElement('div');
    b.className = 'drink-bubble';
    const size  = 4 + Math.random() * 9;           // 4–13 px
    const startX = cx + (Math.random() - 0.5) * rect.width * 0.7;
    const drift  = (Math.random() - 0.5) * 70;     // ±35 px horizontal
    const rise   = 90 + Math.random() * 80;        // 90–170 px up
    const dur    = (0.7 + Math.random() * 0.8).toFixed(2);
    const delay  = (Math.random() * 0.25).toFixed(2);
    const colour = colours[Math.floor(Math.random() * colours.length)];

    b.style.cssText = `
      left: ${startX}px; top: ${rect.top}px;
      width: ${size}px; height: ${size}px;
      background: ${colour};
      border: 1px solid rgba(255,255,255,0.3);
      --rise: -${rise}px; --drift: ${drift}px;
      --dur: ${dur}s; --delay: ${delay}s;
    `;
    document.body.appendChild(b);
    b.addEventListener('animationend', () => b.remove(), { once: true });
  }

  // Pop animation on the button
  btn.classList.remove('popping');
  void btn.offsetWidth; // reflow to restart
  btn.classList.add('popping');
  btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
}

function handleQuickAdd() {
  spawnBubbles();
  const today    = todayStr();
  const existing = S.map.get(today);

  // Snapshot the original state on the first tap of a new batch
  if (_qaTimer === null) {
    _qaOriginal = existing
      ? { drinks: existing.drinks, note: existing.note || '', id: existing.id || '' }
      : null;
  }

  // Reset the timer on every tap (coalesce rapid taps into one deferred commit)
  clearTimeout(_qaTimer);

  _qaTarget = (S.map.get(today)?.drinks ?? 0) + 1;

  // Optimistic update
  applyLogSave({
    id:     existing?.id || '',
    date:   today,
    drinks: _qaTarget,
    note:   existing?.note || '',
  });
  renderCurrentView();

  // Toast
  const label = _qaTarget === 1 ? '1 drink today' : `${_qaTarget} drinks today`;
  $id('quickadd-toast-msg').textContent = label;
  $id('quickadd-toast').hidden = false;

  _qaTimer = setTimeout(_commitQuickAdd, 5000);
}

function undoQuickAdd() {
  clearTimeout(_qaTimer);
  _qaTimer = null;

  const today = todayStr();
  if (_qaOriginal === null) {
    applyLogDelete(today);
  } else {
    applyLogSave({ id: _qaOriginal.id, date: today, drinks: _qaOriginal.drinks, note: _qaOriginal.note });
  }
  _qaOriginal = null;

  $id('quickadd-toast').hidden = true;
  renderCurrentView();
}

async function _commitQuickAdd() {
  _qaTimer = null;
  $id('quickadd-toast').hidden = true;

  const today = todayStr();
  const note  = S.map.get(today)?.note || '';

  try {
    const saved = await api.post('/api/logs', { date: today, drinks: _qaTarget, note });
    applyLogSave(saved);
    renderCurrentView();
    refreshStats();
  } catch {
    // Revert on failure
    if (_qaOriginal === null) {
      applyLogDelete(today);
    } else {
      applyLogSave({ id: _qaOriginal.id, date: today, drinks: _qaOriginal.drinks, note: _qaOriginal.note });
    }
    renderCurrentView();
  }
  _qaOriginal = null;
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: JOURNAL / DIARY
   All logged days that have a note, newest first.
   ═══════════════════════════════════════════════════════════════ */

function renderJournal() {
  const list = $id('journal-list');
  list.style.paddingRight = '24px'; // space for side scrubber

  const entries = S.logs
    .filter(l => l.note && l.note.trim())
    .sort((a, b) => b.date.localeCompare(a.date));

  if (entries.length === 0) {
    list.innerHTML =
      '<p class="journal-empty">No diary entries yet.<br>Tap any day to log a note — it\'ll show up here.</p>';
    window._journalMonths = [];
    _buildScrubberLabels();
    return;
  }

  // Group by YYYY-MM, preserving newest-first order
  const groups = new Map();
  for (const log of entries) {
    const key = log.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  }
  window._journalMonths = [...groups.keys()];

  const frag = document.createDocumentFragment();
  for (const [key, logs] of groups) {
    const [y, m] = key.split('-').map(Number);
    const monthLabel = new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    frag.appendChild(el('div', { class: 'journal-month-hdr', id: `jm-${key}` }, monthLabel));

    for (const log of logs) {
      const card = el('div', { class: `journal-card ${drinkClass(log.drinks)}`, 'data-date': log.date });

      const d = parseDate(log.date);
      const dateLabel = d.toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const drinkLabel = log.drinks === 0 ? 'dry'
        : `${log.drinks} drink${log.drinks !== 1 ? 's' : ''}`;

      const meta = el('div', { class: 'journal-meta' });
      meta.appendChild(el('span', { class: 'journal-date' }, dateLabel));
      meta.appendChild(el('span', { class: `journal-badge ${drinkClass(log.drinks)}` }, drinkLabel));
      card.appendChild(meta);

      const noteEl = el('p', { class: 'journal-note' });
      noteEl.textContent = log.note;
      card.appendChild(noteEl);

      card.addEventListener('click', () => openModal(log.date));
      frag.appendChild(card);
    }
  }

  list.replaceChildren(frag);
  _buildScrubberLabels();
}

function _buildScrubberLabels() {
  const scrubber = $id('journal-scrubber');
  const months   = window._journalMonths || [];
  if (!months.length) { scrubber.replaceChildren(); return; }

  const frag = document.createDocumentFragment();
  for (const key of months) {
    const m = parseInt(key.split('-')[1], 10) - 1;
    frag.appendChild(el('div', { class: 'journal-scrubber-label', 'data-key': key }, MONTHS_SHORT[m]));
  }
  scrubber.replaceChildren(frag);
  _positionScrubber();
}

function _positionScrubber() {
  const scrubber  = $id('journal-scrubber');
  const navBottom = document.querySelector('.view-nav').getBoundingClientRect().bottom;
  const vpH       = window.innerHeight;
  const centerY   = navBottom + (vpH - navBottom) / 2;
  scrubber.style.top = `${centerY}px`;
}

function initJournalScrubber() {
  const scrubber = $id('journal-scrubber');

  function monthFromY(clientY) {
    const months = window._journalMonths || [];
    if (!months.length) return null;
    const rect  = scrubber.getBoundingClientRect();
    const relY  = clientY - rect.top;
    const slotH = rect.height / months.length;
    const idx   = Math.max(0, Math.min(months.length - 1, Math.floor(relY / slotH)));
    return months[idx];
  }

  function scrollToMonth(key) {
    const hdr = $id(`jm-${key}`);
    if (!hdr) return;
    document.querySelector('.view-area').scrollTo({ top: hdr.offsetTop - 4, behavior: 'smooth' });
    scrubber.querySelectorAll('.journal-scrubber-label').forEach(l => {
      l.classList.toggle('active', l.dataset.key === key);
    });
  }

  scrubber.addEventListener('click', e => {
    const lbl = e.target.closest('.journal-scrubber-label');
    if (lbl) scrollToMonth(lbl.dataset.key);
  });

  scrubber.addEventListener('touchstart', e => {
    e.preventDefault();
    const key = monthFromY(e.touches[0].clientY);
    if (key) scrollToMonth(key);
  }, { passive: false });

  scrubber.addEventListener('touchmove', e => {
    e.preventDefault();
    const key = monthFromY(e.touches[0].clientY);
    if (key) scrollToMonth(key);
  }, { passive: false });
}

/* ═══════════════════════════════════════════════════════════════
   ACCOUNT PANEL
   ═══════════════════════════════════════════════════════════════ */

function _closeAccountPanel() {
  $id('account-panel').hidden = true;
  _accountDeletePending = false;
  $id('btn-delete-account').textContent = 'delete account';
  $id('err-delete-account').textContent = '';
}

function initAccountPanel() {
  $id('btn-account-toggle').addEventListener('click', e => {
    e.stopPropagation();
    const panel = $id('account-panel');
    if (panel.hidden) {
      panel.hidden = false;
    } else {
      _closeAccountPanel();
    }
  });

  document.addEventListener('click', e => {
    const panel = $id('account-panel');
    if (!panel.hidden && !panel.contains(e.target) && e.target !== $id('btn-account-toggle')) {
      _closeAccountPanel();
    }
  });
}

function initDeleteAccount() {
  const btn = $id('btn-delete-account');

  btn.addEventListener('click', async () => {
    if (!_accountDeletePending) {
      _accountDeletePending = true;
      btn.textContent = 'confirm — delete everything';
      return;
    }
    _accountDeletePending = false;
    btn.textContent = 'delete account';
    try {
      await api.del('/api/account');
      S.user = null; S.logs = []; S.stats = null; S.map.clear();
      $id('account-panel').hidden = true;
      showAuth();
    } catch (err) {
      $id('err-delete-account').textContent = err.message;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */

function init() {
  initAuthForms();
  initLogout();
  initViewTabs();
  initYearNav();
  initYearTranspose();
  initMonthNav();
  initModal();
  initYearScrub();
  initQuickAdd();
  initAccountPanel();
  initDeleteAccount();
  initJournalScrubber();
  checkAuth();
}

document.addEventListener('DOMContentLoaded', init);
