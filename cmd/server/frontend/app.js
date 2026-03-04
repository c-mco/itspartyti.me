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
  yearView:  new Date().getFullYear(),   // year shown in Year view
  monthView: new Date().getMonth(),      // month shown in Month view (0-indexed)
  modal:     { date: null },
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
    case 'year':  renderYearGrid();  break;
    case 'river': renderRiver();     break;
    case 'month': renderMonthGrid(); break;
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

function renderYearGrid() {
  const year  = S.yearView;
  const today = todayStr();
  const grid  = $id('year-grid');

  $id('year-label').textContent = year;
  $id('btn-year-next').disabled = year >= new Date().getFullYear();

  const frag = document.createDocumentFragment();

  // ── Header row: blank corner + month abbreviations ──
  frag.appendChild(el('div', { class: 'ygrid-corner', 'aria-hidden': 'true' }));
  for (let m = 0; m < 12; m++) {
    frag.appendChild(el('div', { class: 'ygrid-mhdr', 'aria-hidden': 'true' }, MONTHS_ABBR[m]));
  }

  // ── Day rows 1–31 ──
  for (let day = 1; day <= 31; day++) {
    frag.appendChild(el('div', { class: 'ygrid-dlbl', 'aria-hidden': 'true' }, day));

    for (let m = 0; m < 12; m++) {
      // Days that don't exist for this month (e.g. Feb 30)
      if (day > daysInMonth(year, m + 1)) {
        frag.appendChild(el('div', { class: 'ygrid-cell invalid', 'aria-hidden': 'true' }));
        continue;
      }

      const dateStr = `${year}-${pad(m + 1)}-${pad(day)}`;
      const log     = S.map.get(dateStr);
      const future  = dateStr > today;
      const isToday = dateStr === today;
      const dc      = drinkClass(log != null ? log.drinks : null);

      const classes = ['ygrid-cell', dc, future ? 'future' : '', isToday ? 'is-today' : '']
        .filter(Boolean).join(' ');

      const attrs = { class: classes, 'data-date': dateStr };
      if (!future) {
        attrs.role     = 'gridcell';
        attrs.tabindex = '0';
        const drinks   = log != null ? log.drinks : null;
        const dText    = drinks == null ? 'not logged'
          : drinks === 0 ? 'sober'
          : `${drinks} drink${drinks !== 1 ? 's' : ''}`;
        attrs['aria-label'] = `${dateStr}: ${dText}`;
      }

      frag.appendChild(el('div', attrs));
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
}

/* ─── Loupe: mobile magnifier ─────────────────────────────────
   When the user holds or drags a finger across the year grid, a
   floating card appears above their finger showing the date and
   drink count — so the thumb doesn't obscure the cell.
   A minimal-movement touch (< 8px) is treated as a tap → opens modal.
   ─────────────────────────────────────────────────────────────── */

let _lTouching = false;
let _lTimer    = null;
let _lStartX   = 0;
let _lStartY   = 0;
let _lMoved    = false;

function initLoupe() {
  // Attach to the static scroll wrapper, not the rebuilt grid
  const wrap = $id('year-scroll-outer');
  wrap.addEventListener('touchstart',  _lTouchStart, { passive: true });
  wrap.addEventListener('touchmove',   _lTouchMove,  { passive: true });
  wrap.addEventListener('touchend',    _lTouchEnd);
  wrap.addEventListener('touchcancel', _lTouchEnd);
}

function _lTouchStart(e) {
  const t   = e.touches[0];
  _lTouching = true;
  _lStartX   = t.clientX;
  _lStartY   = t.clientY;
  _lMoved    = false;
  clearTimeout(_lTimer);
  // Small delay so fast taps don't flash the loupe
  _lTimer = setTimeout(() => {
    if (_lTouching) _loupeShow(t.clientX, t.clientY);
  }, 80);
}

function _lTouchMove(e) {
  const t  = e.touches[0];
  if (Math.abs(t.clientX - _lStartX) > 8 || Math.abs(t.clientY - _lStartY) > 8) {
    _lMoved = true;
  }
  if (_lTouching) _loupeShow(t.clientX, t.clientY);
}

function _lTouchEnd(e) {
  clearTimeout(_lTimer);
  _lTouching = false;
  _loupeHide();
  // Tap = finger barely moved → open the modal
  if (!_lMoved) {
    const t    = e.changedTouches[0];
    const cell = document.elementFromPoint(t.clientX, t.clientY)
                          ?.closest('.ygrid-cell[data-date]');
    if (cell && !cell.classList.contains('future')) openModal(cell.dataset.date);
  }
}

function _loupeShow(x, y) {
  const target = document.elementFromPoint(x, y);
  const cell   = target?.closest('.ygrid-cell[data-date]');
  if (!cell) { _loupeHide(); return; }

  const dateStr    = cell.dataset.date;
  const log        = S.map.get(dateStr);
  const d          = parseDate(dateStr);
  const dc         = drinkClass(log != null ? log.drinks : null);

  const dateLabel  = d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const drinkLabel = log == null   ? 'not logged'
    : log.drinks === 0             ? 'sober'
    : `${log.drinks} drink${log.drinks !== 1 ? 's' : ''}`;
  const noteHtml   = log?.note
    ? `<span class="loupe-note">${esc(log.note.slice(0, 60))}</span>`
    : '';

  const loupe = $id('loupe');
  loupe.className = `loupe ${dc}`;
  loupe.innerHTML = `
    <span class="loupe-date">${esc(dateLabel)}</span>
    <span class="loupe-count">${esc(drinkLabel)}</span>
    ${noteHtml}
  `;

  // Clamp position so the loupe stays within the viewport
  const W = 160, margin = 12;
  let lx = x - W / 2;
  let ly = y - 85;
  lx = Math.max(margin, Math.min(window.innerWidth - W - margin, lx));
  if (ly < margin) ly = y + 32; // flip below if near the top edge

  loupe.style.left  = `${lx}px`;
  loupe.style.top   = `${ly}px`;
  loupe.style.width = `${W}px`;
  loupe.hidden = false;
}

function _loupeHide() {
  $id('loupe').hidden = true;
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
  initYearNav();
  initMonthNav();
  initModal();
  initLoupe();
  initDeleteAccount();
  checkAuth();
}

document.addEventListener('DOMContentLoaded', init);
