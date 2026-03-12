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
  user:      null,           // logged-in username string
  logs:      [],             // array of log objects from API
  stats:     null,           // stats object from API
  map:       new Map(),      // date string → log object  (derived)
  view:      'year',         // active view: 'year' | 'river' | 'month'
  yearView:  new Date().getFullYear(),   // year shown in Year view (kept for month nav compat)
  monthView: new Date().getMonth(),      // month shown in Month view (0-indexed)
  modal:     { date: null },
  graphMode:         'overview', // 'overview' | 'scroll'
  graphScrollTarget: null,       // dateStr to center on after mode switch
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
  $id('header-username').textContent = S.user;
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

  $id('modal').hidden = false;
  $id('input-drinks').focus();
}

function closeModal() {
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

  // Delete entry
  $id('btn-modal-delete').addEventListener('click', async () => {
    if (!confirm('Delete this entry?')) return;
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
  $id('st-streak').textContent = s.current_streak  + 'd';
  $id('st-best').textContent   = s.longest_streak  + 'd';
  $id('st-avg').textContent    = s.avg_drinking_days || '—';
  $id('st-sober').textContent  = s.pct_sober_days  + '%';
}

/* ═══════════════════════════════════════════════════════════════
   VIEW ROUTING
   ═══════════════════════════════════════════════════════════════ */

function switchView(name) {
  if (S.view === name) return;
  if (S.view === 'year') { FisheyeEngine.destroy(); CellEditor.close(true); }
  S.view = name;
  document.querySelectorAll('.view-tab').forEach(btn => {
    const active = btn.dataset.view === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  ['year', 'river', 'month'].forEach(v => {
    $id(`panel-${v}`).hidden = v !== name;
  });
  renderCurrentView();
}

function renderCurrentView() {
  switch (S.view) {
    case 'year':  renderCommitGraph(); break;
    case 'river': renderRiver();       break;
    case 'month': renderMonthGrid();   break;
  }
}

function initViewTabs() {
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

/* ═══════════════════════════════════════════════════════════════
   VIEW: COMMIT GRAPH
   GitHub-style 7-row × 52-column rolling heatmap.
   Two modes:
     overview – all 52 weeks fit the container; click to drill in
     scroll   – pannable, larger cells, fisheye zoom on hover/touch
   ═══════════════════════════════════════════════════════════════ */

const CG_BASE  = 28;                          // natural cell size (px) in scroll mode
const CG_GAP   = 3;                           // gap between cells (px)
const CG_STEP  = CG_BASE + CG_GAP;           // 31px per column at natural size
// Fisheye scale by column distance (index = distance 0, 1, 2 … )
const CG_SCALES = [2.8, 2.0, 1.4, 1.05, 0.85, 0.8];
const CG_DOW   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/** Compute 52 week-columns of {dateStr, log, isFuture, isToday} entries.
 *  Week 0 = oldest, week 51 = the week containing today (Sun-start). */
function buildWeekColumns() {
  const t    = new Date();
  const ts   = todayStr();
  // Sunday of the current week
  const ws   = new Date(t);
  ws.setDate(t.getDate() - t.getDay());
  // Start of the 52-week window
  const gs   = new Date(ws);
  gs.setDate(ws.getDate() - 51 * 7);

  const cols = [];
  for (let w = 0; w < 52; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const dt  = new Date(gs);
      dt.setDate(gs.getDate() + w * 7 + d);
      const ds  = fmtDate(dt);
      const log = S.map.get(ds) ?? null;
      week.push({ dateStr: ds, log, isFuture: ds > ts, isToday: ds === ts });
    }
    cols.push(week);
  }
  return cols;
}

/** Returns array of 52 month-abbreviation strings (non-empty only where month changes). */
function buildMonthLabels(cols) {
  const out = new Array(52).fill('');
  let last  = -1;
  for (let w = 0; w < 52; w++) {
    const m = parseInt(cols[w][0].dateStr.split('-')[1], 10) - 1;
    if (m !== last) { out[w] = MONTHS_SHORT[m]; last = m; }
  }
  return out;
}

/** Create a single .cg-cell element. mode = 'overview' | 'scroll'. */
function makeCgCell(entry, mode) {
  const { dateStr, log, isFuture, isToday } = entry;
  const dc  = drinkClass(log != null ? log.drinks : null);
  const cls = ['cg-cell', dc,
    isFuture ? 'future' : '',
    isToday  ? 'is-today' : '',
  ].filter(Boolean).join(' ');

  const cell = el('div', { class: cls, 'data-date': dateStr });

  if (!isFuture) {
    cell.setAttribute('tabindex', '0');
    const drinks = log != null ? log.drinks : null;
    const dText  = drinks == null ? 'not logged'
      : drinks === 0 ? 'sober'
      : `${drinks} drink${drinks !== 1 ? 's' : ''}`;
    cell.setAttribute('aria-label', `${dateStr}: ${dText}`);
  }

  if (mode === 'scroll') {
    const inner = el('div', { class: 'cg-cell-inner' });
    inner.appendChild(el('span', { class: 'cg-cell-day' },
      String(parseDate(dateStr).getDate())));
    if (log != null) {
      inner.appendChild(el('span', { class: 'cg-cell-count' }, String(log.drinks)));
      if (log.note) {
        const note = el('span', { class: 'cg-cell-note' });
        note.textContent = log.note.length > 36 ? log.note.slice(0, 36) + '…' : log.note;
        inner.appendChild(note);
      }
    }
    cell.appendChild(inner);
  }

  return cell;
}

/** Update just the affected cell(s) in the DOM without a full re-render.
 *  Called after inline saves to avoid destroying the fisheye engine. */
function updateCgCell(dateStr) {
  const log    = S.map.get(dateStr) ?? null;
  const dc     = drinkClass(log != null ? log.drinks : null);
  const drinks = log != null ? log.drinks : null;
  const dText  = drinks == null ? 'not logged'
    : drinks === 0 ? 'sober'
    : `${drinks} drink${drinks !== 1 ? 's' : ''}`;

  document.querySelectorAll(`.cg-cell[data-date="${CSS.escape(dateStr)}"]`).forEach(cell => {
    // Rebuild class list, preserving state classes
    const keep = ['future','is-today'].filter(c => cell.classList.contains(c));
    cell.className = ['cg-cell', dc, ...keep].join(' ');
    cell.setAttribute('aria-label', `${dateStr}: ${dText}`);

    // Rebuild inner content if in scroll mode
    const inner = cell.querySelector('.cg-cell-inner');
    if (inner) {
      inner.replaceChildren();
      inner.appendChild(el('span', { class: 'cg-cell-day' },
        String(parseDate(dateStr).getDate())));
      if (log != null) {
        inner.appendChild(el('span', { class: 'cg-cell-count' }, String(log.drinks)));
        if (log.note) {
          const noteEl = el('span', { class: 'cg-cell-note' });
          noteEl.textContent = log.note.length > 36 ? log.note.slice(0, 36) + '…' : log.note;
          inner.appendChild(noteEl);
        }
      }
    }
  });
}

/* ── Entry point ──────────────────────────────────────────────── */

function renderCommitGraph() {
  CellEditor.close(false); // close without saving if a re-render is forced externally
  FisheyeEngine.destroy();
  const mount    = $id('cg-mount');
  const controls = $id('cg-controls');
  if (S.graphMode === 'overview') {
    renderOverview(mount, controls);
  } else {
    renderScrollView(mount, controls);
  }
}

/* ── Overview mode ────────────────────────────────────────────── */

function renderOverview(mount, controls) {
  controls.replaceChildren(); // no controls in overview mode

  const cols       = buildWeekColumns();
  const monthLbls  = buildMonthLabels(cols);
  const wrap       = el('div', { class: 'cg-overview' });

  // Month label row
  const mRow = el('div', { class: 'cg-ov-month-row', 'aria-hidden': 'true' });
  mRow.appendChild(el('div', { class: 'cg-ov-dow-spacer' }));
  const mWrap = el('div', { class: 'cg-ov-months' });
  for (let w = 0; w < 52; w++) {
    mWrap.appendChild(el('div', { class: 'cg-ov-month-lbl' }, monthLbls[w]));
  }
  mRow.appendChild(mWrap);
  wrap.appendChild(mRow);

  // Body: DOW labels + week columns
  const body   = el('div', { class: 'cg-ov-body' });
  const dowCol = el('div', { class: 'cg-ov-dow-col', 'aria-hidden': 'true' });
  CG_DOW.forEach((d, i) => {
    dowCol.appendChild(el('div', { class: 'cg-ov-dow-lbl' }, i % 2 === 1 ? d[0] : ''));
  });
  body.appendChild(dowCol);

  const weeksWrap = el('div', { class: 'cg-ov-weeks' });
  for (let w = 0; w < 52; w++) {
    const col = el('div', { class: 'cg-ov-col', 'data-col': String(w) });
    for (let d = 0; d < 7; d++) {
      col.appendChild(makeCgCell(cols[w][d], 'overview'));
    }
    weeksWrap.appendChild(col);
  }
  body.appendChild(weeksWrap);
  wrap.appendChild(body);
  mount.replaceChildren(wrap);

  // Click or keyboard → switch to scroll mode
  weeksWrap.addEventListener('click', e => {
    const cell = e.target.closest('.cg-cell[data-date]');
    if (!cell) return;
    S.graphMode        = 'scroll';
    S.graphScrollTarget = cell.dataset.date;
    renderCommitGraph();
  });
  weeksWrap.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cell = e.target.closest('.cg-cell[data-date]');
    if (cell && !cell.classList.contains('future')) {
      e.preventDefault();
      S.graphMode        = 'scroll';
      S.graphScrollTarget = cell.dataset.date;
      renderCommitGraph();
    }
  });
}

/* ── Scroll mode ──────────────────────────────────────────────── */

function renderScrollView(mount, controls) {
  // Back button
  controls.replaceChildren();
  const backBtn = el('button', { class: 'icon-btn', 'aria-label': 'Back to overview' }, '← overview');
  controls.appendChild(backBtn);
  backBtn.addEventListener('click', () => {
    S.graphMode = 'overview';
    renderCommitGraph();
  });

  const cols      = buildWeekColumns();
  const monthLbls = buildMonthLabels(cols);
  const wrap      = el('div', { class: 'cg-scroll-wrap' });

  // Body row: DOW area (sticky left) + scrollable columns
  const body    = el('div', { class: 'cg-sc-body' });
  const dowArea = el('div', { class: 'cg-sc-dow-area' });
  dowArea.appendChild(el('div', { class: 'cg-sc-dow-spacer' })); // aligns with month row
  const dowCol  = el('div', { class: 'cg-sc-dow-col', 'aria-hidden': 'true' });
  CG_DOW.forEach((d, i) => {
    dowCol.appendChild(el('div', { class: 'cg-sc-dow-lbl' }, i % 2 === 1 ? d.slice(0, 2) : ''));
  });
  dowArea.appendChild(dowCol);
  body.appendChild(dowArea);

  // Scrollable container
  const scrollOuter = el('div', { class: 'cg-sc-outer', id: 'cg-sc-outer' });
  const scrollInner = el('div', { class: 'cg-sc-inner', id: 'cg-sc-inner' });

  for (let w = 0; w < 52; w++) {
    const weekCol = el('div', { class: 'cg-sc-col', 'data-col': String(w) });
    // Month label at top of each column
    const mLbl = el('div', { class: 'cg-sc-month-lbl', 'aria-hidden': 'true' }, monthLbls[w]);
    weekCol.appendChild(mLbl);
    // 7 day cells
    for (let d = 0; d < 7; d++) {
      weekCol.appendChild(makeCgCell(cols[w][d], 'scroll'));
    }
    scrollInner.appendChild(weekCol);
  }

  scrollOuter.appendChild(scrollInner);
  body.appendChild(scrollOuter);
  wrap.appendChild(body);
  mount.replaceChildren(wrap);

  // Scroll to target date after DOM is in place
  requestAnimationFrame(() => {
    const target = S.graphScrollTarget || todayStr();
    S.graphScrollTarget = null;

    let targetCol = 51;
    for (let w = 0; w < 52; w++) {
      if (cols[w].some(e => e.dateStr === target)) { targetCol = w; break; }
    }
    // Put target ~2 columns from the right edge
    const outer = $id('cg-sc-outer');
    outer.scrollLeft = Math.max(0, targetCol * CG_STEP - outer.clientWidth + 2 * CG_STEP);

    FisheyeEngine.init(scrollInner, outer, cols);
  });

  // Click / keyboard → open inline editor
  scrollInner.addEventListener('click', e => {
    const cell = e.target.closest('.cg-cell[data-date]');
    if (cell && !cell.classList.contains('future')) CellEditor.open(cell.dataset.date, cell);
  });
  scrollInner.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cell = e.target.closest('.cg-cell[data-date]');
    if (cell && !cell.classList.contains('future')) {
      e.preventDefault();
      CellEditor.open(cell.dataset.date, cell);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   FISHEYE ENGINE
   Scales week-columns by distance from the cursor/touch.
   Only mutates a ±5 column neighbourhood per frame.
   ═══════════════════════════════════════════════════════════════ */

const FisheyeEngine = {
  _outer:      null,
  _inner:      null,
  _colEls:     null,
  _pendingX:   -1,
  _rafId:      null,
  _dirtyRange: null,
  _touchTimer: null,
  _touchArmed: false,
  _touchX0:    0,
  _touchY0:    0,

  init(inner, outer) {
    this._outer  = outer;
    this._inner  = inner;
    this._colEls = Array.from(inner.querySelectorAll('.cg-sc-col'));

    this._mm  = e => { this._pendingX = e.clientX; this._frame(); };
    this._ml  = ()  => { this._pendingX = -1; this._frame(); };
    this._ts  = e => this._touchStart(e);
    this._tm  = e => this._touchMove(e);
    this._te  = ()  => { this._pendingX = -1; clearTimeout(this._touchTimer); this._touchArmed = false; this._frame(); };

    outer.addEventListener('mousemove',   this._mm);
    outer.addEventListener('mouseleave',  this._ml);
    outer.addEventListener('touchstart',  this._ts, { passive: true });
    outer.addEventListener('touchmove',   this._tm, { passive: false });
    outer.addEventListener('touchend',    this._te);
    outer.addEventListener('touchcancel', this._te);
  },

  destroy() {
    if (!this._outer) return;
    this._outer.removeEventListener('mousemove',   this._mm);
    this._outer.removeEventListener('mouseleave',  this._ml);
    this._outer.removeEventListener('touchstart',  this._ts);
    this._outer.removeEventListener('touchmove',   this._tm);
    this._outer.removeEventListener('touchend',    this._te);
    this._outer.removeEventListener('touchcancel', this._te);
    clearTimeout(this._touchTimer);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._resetAll();
    this._outer = this._inner = this._colEls = null;
  },

  _touchStart(e) {
    const t = e.touches[0];
    this._touchX0 = t.clientX; this._touchY0 = t.clientY;
    this._touchArmed = false;
    clearTimeout(this._touchTimer);
    this._touchTimer = setTimeout(() => {
      this._touchArmed = true;
      this._pendingX   = this._touchX0;
      this._frame();
    }, 80);
  },

  _touchMove(e) {
    const t  = e.touches[0];
    const dx = Math.abs(t.clientX - this._touchX0);
    const dy = Math.abs(t.clientY - this._touchY0);
    if (!this._touchArmed) {
      if (dx > 8 || dy > 8) clearTimeout(this._touchTimer);
      return;
    }
    e.preventDefault();
    this._pendingX = t.clientX;
    this._frame();
  },

  _frame() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._apply();
    });
  },

  _apply() {
    if (!this._colEls) return;
    if (this._pendingX < 0) { this._resetAll(); return; }

    const rect      = this._outer.getBoundingClientRect();
    const contentX  = this._pendingX - rect.left + this._outer.scrollLeft;
    const cursorCol = Math.floor(contentX / CG_STEP);
    if (cursorCol < 0 || cursorCol >= 52) { this._resetAll(); return; }

    const R      = 5;
    const lo     = Math.max(0,  cursorCol - R);
    const hi     = Math.min(51, cursorCol + R);

    // Reset columns that were dirty but are now outside the neighbourhood
    if (this._dirtyRange) {
      for (let i = this._dirtyRange.lo; i <= this._dirtyRange.hi; i++) {
        if (i < lo || i > hi) this._setCol(i, CG_BASE);
      }
    }

    for (let i = lo; i <= hi; i++) {
      const dist  = Math.abs(i - cursorCol);
      const scale = CG_SCALES[Math.min(dist, CG_SCALES.length - 1)];
      this._setCol(i, Math.round(CG_BASE * scale));
    }
    this._dirtyRange = { lo, hi };

    // Reveal inner content only in the peak column
    this._colEls.forEach((col, i) => {
      const w = parseFloat(col.style.width) || CG_BASE;
      col.querySelectorAll('.cg-cell-inner').forEach(inn => {
        inn.style.opacity = w >= 48 ? '1' : '0';
      });
    });
  },

  _setCol(i, w) {
    const col = this._colEls[i];
    if (!col) return;
    col.style.width    = `${w}px`;
    col.style.minWidth = `${w}px`;
    col.querySelectorAll('.cg-cell').forEach(c => { c.style.height = `${w}px`; });
  },

  _resetAll() {
    if (this._dirtyRange) {
      for (let i = this._dirtyRange.lo; i <= this._dirtyRange.hi; i++) {
        this._setCol(i, CG_BASE);
      }
      this._dirtyRange = null;
    }
    this._inner?.querySelectorAll('.cg-cell-inner').forEach(inn => {
      inn.style.opacity = '0';
    });
  },
};

/* ═══════════════════════════════════════════════════════════════
   INLINE CELL EDITOR
   Opens an absolute-positioned card anchored near the clicked cell.
   Auto-saves on close; shows undo toast.
   ═══════════════════════════════════════════════════════════════ */

const CellEditor = {
  _dateStr:     null,
  _cardEl:      null,
  _originalLog: null,
  _dirty:       false,
  _countEl:     null,
  _noteEl:      null,
  _outsideClick: null,
  _escKey:      null,
  _vvResize:    null,

  open(dateStr, anchorEl) {
    // Commit any in-flight quick-add before opening editor
    if (_qaTimer !== null) {
      clearTimeout(_qaTimer);
      _qaTimer = null;
      hideToast();
      _commitQuickAdd();
    }
    // Close any currently open card (save it)
    if (this._cardEl) this.close(true);

    this._dateStr     = dateStr;
    this._originalLog = S.map.get(dateStr) ?? null;
    this._dirty       = false;

    const log = this._originalLog;
    const dateLabel = parseDate(dateStr).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    const card = el('div', {
      class: 'cg-edit-card', id: 'cg-edit-card',
      role: 'dialog', 'aria-label': 'Edit log entry',
    });

    // Header
    const hdr = el('div', { class: 'cg-edit-hdr' });
    hdr.appendChild(el('span', { class: 'cg-edit-date' }, dateLabel));
    const closeBtn = el('button', {
      class: 'icon-btn cg-edit-close', type: 'button', 'aria-label': 'Close',
    }, '✕');
    hdr.appendChild(closeBtn);
    card.appendChild(hdr);

    // Drink stepper
    const stepper  = el('div', { class: 'drink-stepper', role: 'group', 'aria-label': 'Drink count' });
    const decBtn   = el('button', { class: 'stepper-btn', type: 'button', 'aria-label': 'Fewer' }, '−');
    const countInp = el('input', {
      type: 'number', class: 'cg-edit-count',
      min: '0', max: '100', value: String(log ? log.drinks : 0),
      'aria-label': 'Number of drinks',
    });
    const incBtn = el('button', { class: 'stepper-btn', type: 'button', 'aria-label': 'More' }, '+');
    stepper.append(decBtn, countInp, incBtn);
    card.appendChild(stepper);

    // Note textarea
    const noteWrap = el('div', { class: 'field' });
    const noteLbl  = el('label', {});
    noteLbl.textContent = 'note';
    const noteHintEl = el('span', { class: 'hint' }, 'optional · max 500 chars');
    noteLbl.appendChild(noteHintEl);
    const noteTA = el('textarea', {
      class: 'cg-edit-note', rows: '2', maxlength: '500',
      placeholder: 'what were you drinking?',
    });
    noteTA.value = log ? (log.note || '') : '';
    noteWrap.append(noteLbl, noteTA);
    card.appendChild(noteWrap);

    // Delete action
    const actions = el('div', { class: 'cg-edit-actions' });
    const delBtn  = el('button', { class: 'btn-ghost cg-edit-delete', type: 'button' }, 'delete');
    if (!log) delBtn.hidden = true;
    actions.appendChild(delBtn);
    card.appendChild(actions);

    // Wire up events
    const markDirty = () => { this._dirty = true; };
    decBtn.addEventListener('click', () => {
      countInp.value = String(Math.max(0, (parseInt(countInp.value, 10) || 0) - 1));
      markDirty();
    });
    incBtn.addEventListener('click', () => {
      countInp.value = String(Math.min(100, (parseInt(countInp.value, 10) || 0) + 1));
      markDirty();
    });
    countInp.addEventListener('input', markDirty);
    noteTA.addEventListener('input', markDirty);
    closeBtn.addEventListener('click', () => this.close(true));

    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      try {
        await api.del(`/api/logs/${this._dateStr}`);
        applyLogDelete(this._dateStr);
        const d = this._dateStr;
        this._dirty = false;
        this.close(false);
        updateCgCell(d);
        refreshStats();
      } catch (err) { console.error('delete:', err); }
    });

    // Outside-click closes (saves)
    this._outsideClick = e => {
      if (this._cardEl && !this._cardEl.contains(e.target) && e.target !== anchorEl) {
        this.close(true);
      }
    };
    this._escKey = e => { if (e.key === 'Escape' && this._cardEl) this.close(true); };

    // Mobile: lift card above software keyboard
    this._vvResize = () => {
      const vv = window.visualViewport;
      if (!vv || !this._cardEl) return;
      const bottom = vv.offsetTop + vv.height - 12;
      const rect   = this._cardEl.getBoundingClientRect();
      if (rect.bottom > bottom) {
        this._cardEl.style.top = `${parseFloat(this._cardEl.style.top) - (rect.bottom - bottom)}px`;
      }
    };
    noteTA.addEventListener('focus', () => window.visualViewport?.addEventListener('resize', this._vvResize));
    noteTA.addEventListener('blur',  () => window.visualViewport?.removeEventListener('resize', this._vvResize));

    document.body.appendChild(card);
    this._cardEl  = card;
    this._countEl = countInp;
    this._noteEl  = noteTA;

    this._position(anchorEl);
    setTimeout(() => {
      document.addEventListener('click', this._outsideClick, { capture: true });
      document.addEventListener('keydown', this._escKey);
    }, 0);

    countInp.focus();
    countInp.select();
  },

  close(save) {
    if (!this._cardEl) return;
    document.removeEventListener('click', this._outsideClick, { capture: true });
    document.removeEventListener('keydown', this._escKey);
    window.visualViewport?.removeEventListener('resize', this._vvResize);

    const needsSave = save && this._dirty;
    const dateStr   = this._dateStr;
    this._cardEl.remove();
    this._cardEl = this._dateStr = this._originalLog = null;
    this._dirty  = false;

    if (needsSave) this._save(dateStr);
  },

  async _save(dateStr) {
    const drinks = parseInt(this._countEl?.value ?? '0', 10);
    if (isNaN(drinks) || drinks < 0 || drinks > 100) return;
    const note        = (this._noteEl?.value ?? '').trim();
    const originalLog = S.map.get(dateStr) ?? null;

    // Optimistic
    applyLogSave({ id: originalLog?.id || '', date: dateStr, drinks, note });
    updateCgCell(dateStr);
    refreshStats();

    // Toast with undo
    const shortDate = parseDate(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    showToast(`Saved ${shortDate}`, () => {
      if (originalLog === null) applyLogDelete(dateStr);
      else applyLogSave(originalLog);
      updateCgCell(dateStr);
      refreshStats();
    });

    // Persist
    try {
      const saved = await api.post('/api/logs', { date: dateStr, drinks, note });
      applyLogSave(saved);
      updateCgCell(dateStr);
    } catch {
      if (originalLog === null) applyLogDelete(dateStr);
      else applyLogSave(originalLog);
      updateCgCell(dateStr);
    }
  },

  _position(anchorEl) {
    const card    = this._cardEl;
    const rect    = anchorEl.getBoundingClientRect();
    const cardW   = 260;
    const margin  = 10;
    const estH    = 280;

    let left = rect.left;
    let top  = rect.bottom + margin;

    // Clamp horizontal
    if (left + cardW > window.innerWidth - margin) left = window.innerWidth - cardW - margin;
    if (left < margin) left = margin;

    // Flip above if card would go off bottom
    if (top + estH > window.innerHeight - margin) {
      top = rect.top - estH - margin;
    }
    if (top < margin) top = margin;

    card.style.left  = `${left}px`;
    card.style.top   = `${top}px`;
    card.style.width = `${cardW}px`;
  },
};

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

  // Disable "next" if we're already at the current month
  $id('btn-month-next').disabled =
    year > now.getFullYear() ||
    (year === now.getFullYear() && month >= now.getMonth());

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
    if (log != null) {
      cell.appendChild(el('span', { class: 'mcell-drinks', 'aria-hidden': 'true' }, log.drinks));
    }
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
}

/* ═══════════════════════════════════════════════════════════════
   SHARED TOAST
   Used by both quick-add and the inline cell editor.
   ═══════════════════════════════════════════════════════════════ */

let _toastTimer  = null;
let _toastUndoFn = null;

function showToast(msg, undoFn) {
  clearTimeout(_toastTimer);
  _toastUndoFn = undoFn;
  $id('quickadd-toast-msg').textContent = msg;
  $id('quickadd-toast').hidden = false;
  _toastTimer = setTimeout(() => {
    $id('quickadd-toast').hidden = true;
    _toastUndoFn = null;
    _toastTimer  = null;
  }, 5000);
}

function hideToast() {
  clearTimeout(_toastTimer);
  _toastTimer  = null;
  _toastUndoFn = null;
  $id('quickadd-toast').hidden = true;
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
  $id('btn-quickadd-undo').addEventListener('click', () => {
    clearTimeout(_toastTimer);
    $id('quickadd-toast').hidden = true;
    const fn = _toastUndoFn;
    _toastUndoFn = null;
    _toastTimer  = null;
    if (fn) fn();
  });
}

function handleQuickAdd() {
  const today    = todayStr();
  const existing = S.map.get(today);

  // Snapshot the original state on the first tap of a new batch
  if (_qaTimer === null) {
    _qaOriginal = existing
      ? { drinks: existing.drinks, note: existing.note || '', id: existing.id || '' }
      : null;
  }

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

  const label = _qaTarget === 1 ? '1 drink today' : `${_qaTarget} drinks today`;
  showToast(label, () => {
    clearTimeout(_qaTimer);
    _qaTimer = null;
    const t = todayStr();
    if (_qaOriginal === null) applyLogDelete(t);
    else applyLogSave({ id: _qaOriginal.id, date: t, drinks: _qaOriginal.drinks, note: _qaOriginal.note });
    _qaOriginal = null;
    renderCurrentView();
  });

  _qaTimer = setTimeout(() => { _qaTimer = null; _commitQuickAdd(); }, 5000);
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
   DELETE ACCOUNT
   ═══════════════════════════════════════════════════════════════ */

function initDeleteAccount() {
  $id('btn-delete-account').addEventListener('click', async () => {
    if (!confirm('Delete your account and all logs permanently?\nThis cannot be undone.')) return;
    try {
      await api.del('/api/account');
      S.user = null; S.logs = []; S.stats = null; S.map.clear();
      showAuth();
    } catch (err) {
      alert('Error: ' + err.message);
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
  initMonthNav();
  initModal();
  initQuickAdd();
  initDeleteAccount();
  checkAuth();
}

document.addEventListener('DOMContentLoaded', init);
