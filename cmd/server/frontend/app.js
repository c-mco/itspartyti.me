'use strict';

/* ═══════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════ */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                'Jul','Aug','Sep','Oct','Nov','Dec'];
const DOWS   = ['S','M','T','W','T','F','S'];

// Graph: base cell size and fisheye scale curve
const CG_BASE   = 24;
const CG_GAP    = 3;
const CG_STEP   = CG_BASE + CG_GAP; // 27px per column at natural size
const CG_SCALES = [3.2, 2.1, 1.4, 1.05, 0.82, 0.76]; // scale by column distance

// River view
const R_W = 5, R_GAP = 1, R_STEP = R_W + R_GAP, R_H = 100;

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

const pad    = n  => String(n).padStart(2, '0');
const $id    = id => document.getElementById(id);
const fmtD   = d  => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today  = () => fmtD(new Date());
const parseD = s  => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const isFut  = s  => s > today();
const daysIn = (y, m) => new Date(y, m, 0).getDate();

function drinkCls(n) {
  if (n == null) return 'none';
  if (n === 0)   return 'sober';
  if (n <= 2)    return 'light';
  if (n <= 4)    return 'moderate';
  return 'heavy';
}

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null && v !== '') e.setAttribute(k, String(v));
  }
  if (text != null) e.textContent = text;
  return e;
}

/* ═══════════════════════════════════════════════════════
   API
   ═══════════════════════════════════════════════════════ */

class ApiError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const api = {
  async req(method, path, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body != null) opts.body = JSON.stringify(body);
    const res  = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || 'request failed');
    return data;
  },
  get:  p     => api.req('GET',    p),
  post: (p,b) => api.req('POST',   p, b),
  del:  p     => api.req('DELETE', p),
};

/* ═══════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════ */

const S = {
  user:        null,
  logs:        [],
  stats:       null,
  map:         new Map(),   // date → log (fast lookup)
  view:        'graph',
  graphMode:   'overview',  // 'overview' | 'scroll'
  graphTarget: null,        // dateStr to center on / open after mode switch
  moYear:      new Date().getFullYear(),
  moMonth:     new Date().getMonth(),
};

function rebuildMap() {
  S.map = new Map(S.logs.map(l => [l.date, l]));
}

function applyLogSave(log) {
  const i = S.logs.findIndex(l => l.date === log.date);
  if (i >= 0) S.logs[i] = log; else S.logs.push(log);
  rebuildMap();
}

function applyLogDelete(date) {
  S.logs = S.logs.filter(l => l.date !== date);
  rebuildMap();
}

/* ═══════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════ */

let _authMode = 'login';

function showAuth() {
  $id('app').hidden  = true;
  $id('auth').hidden = false;
  $id('auth-err').textContent = '';
}

function showApp() {
  $id('auth').hidden = true;
  $id('app').hidden  = false;
  $id('hdr-user').textContent = S.user;
  loadAll();
}

async function checkAuth() {
  try {
    const d = await api.get('/api/me');
    S.user = d.username;
    showApp();
  } catch { showAuth(); }
}

function initAuth() {
  const form   = $id('auth-form');
  const toggle = $id('auth-toggle');
  const submit = $id('auth-submit');
  const errEl  = $id('auth-err');

  toggle.addEventListener('click', () => {
    _authMode = _authMode === 'login' ? 'register' : 'login';
    const isLogin = _authMode === 'login';
    submit.textContent = isLogin ? 'log in' : 'create account';
    toggle.textContent = isLogin ? "don't have an account? register →" : 'already have an account? log in →';
    errEl.textContent  = '';
    $id('f-user').value = '';
    $id('f-pass').value = '';
    $id('f-user').focus();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.textContent = '';
    submit.disabled   = true;
    const username = $id('f-user').value.trim();
    const password = $id('f-pass').value;
    try {
      if (_authMode === 'register') {
        await api.post('/api/register', { username, password });
      }
      const d = await api.post('/api/login', { username, password });
      S.user = d.username;
      showApp();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  $id('btn-logout').addEventListener('click', async () => {
    try { await api.post('/api/logout'); } catch { /* ignore */ }
    S.user = null; S.logs = []; S.stats = null; S.map.clear();
    showAuth();
  });
}

/* ═══════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════ */

async function loadAll() {
  try {
    const [logs, stats] = await Promise.all([api.get('/api/logs'), api.get('/api/stats')]);
    S.logs  = logs  || [];
    S.stats = stats;
    rebuildMap();
    renderView();
    renderStats();
  } catch (e) { console.error('loadAll:', e); }
}

async function refreshStats() {
  try { S.stats = await api.get('/api/stats'); renderStats(); } catch { /* ignore */ }
}

/* ═══════════════════════════════════════════════════════
   VIEW ROUTING
   ═══════════════════════════════════════════════════════ */

function switchView(name) {
  if (S.view === name) return;
  if (S.view === 'graph') { FisheyeEngine.destroy(); Editor.close(false); }
  S.view = name;
  document.querySelectorAll('.vtab').forEach(b => {
    const on = b.dataset.view === name;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  ['graph','month','river'].forEach(v => { $id(`panel-${v}`).hidden = v !== name; });
  renderView();
}

function renderView() {
  switch (S.view) {
    case 'graph': renderGraph(); break;
    case 'month': renderMonth(); break;
    case 'river': renderRiver(); break;
  }
}

function initViewNav() {
  document.querySelectorAll('.vtab').forEach(b => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
}

/* ═══════════════════════════════════════════════════════
   STATS
   ═══════════════════════════════════════════════════════ */

function renderStats() {
  const s = S.stats;
  if (!s) return;
  $id('s-week').textContent   = s.total_this_week;
  $id('s-month').textContent  = s.total_this_month;
  $id('s-all').textContent    = s.total_all_time;
  $id('s-streak').textContent = s.current_streak  + 'd';
  $id('s-best').textContent   = s.longest_streak  + 'd';
  $id('s-avg').textContent    = s.avg_drinking_days || '—';
  $id('s-sober').textContent  = s.pct_sober_days  + '%';
}

/* ═══════════════════════════════════════════════════════
   COMMIT GRAPH — data
   ═══════════════════════════════════════════════════════ */

/** Build 52 week-columns (Sun-start). col[0] = oldest, col[51] = week containing today. */
function buildWeekCols() {
  const t  = new Date();
  const ts = today();
  const ws = new Date(t);
  ws.setDate(t.getDate() - t.getDay()); // Sunday of current week
  const gs = new Date(ws);
  gs.setDate(ws.getDate() - 51 * 7);   // 52 weeks back

  return Array.from({ length: 52 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const dt = new Date(gs);
      dt.setDate(gs.getDate() + w * 7 + d);
      const ds = fmtD(dt);
      return { ds, log: S.map.get(ds) ?? null, fut: ds > ts, tod: ds === ts };
    })
  );
}

/** Month label per column — only non-empty where month changes. */
function buildMonthLabels(cols) {
  let last = -1;
  return cols.map(week => {
    const m = parseInt(week[0].ds.split('-')[1], 10) - 1;
    if (m !== last) { last = m; return MONTHS[m]; }
    return '';
  });
}

/** Create a single .gc element. */
function makeCell(entry, mode) {
  const { ds, log, fut, tod } = entry;
  const dc  = drinkCls(log != null ? log.drinks : null);
  const cls = ['gc', dc, fut ? 'future' : '', tod ? 'today' : ''].filter(Boolean).join(' ');
  const c   = el('div', { class: cls, 'data-date': ds });

  if (!fut) {
    c.setAttribute('tabindex', '0');
    const lbl = log == null ? 'not logged'
      : log.drinks === 0   ? 'sober'
      : `${log.drinks} drink${log.drinks !== 1 ? 's' : ''}`;
    c.setAttribute('aria-label', `${ds}: ${lbl}`);
  }

  if (mode === 'scroll') {
    const inn = el('div', { class: 'gc-inner' });
    inn.appendChild(el('span', { class: 'gc-day'   }, String(parseD(ds).getDate())));
    if (log != null) {
      inn.appendChild(el('span', { class: 'gc-count' }, String(log.drinks)));
      if (log.note) {
        const ne = el('span', { class: 'gc-note' });
        ne.textContent = log.note.length > 28 ? log.note.slice(0, 28) + '…' : log.note;
        inn.appendChild(ne);
      }
    }
    c.appendChild(inn);
  }
  return c;
}

/** Update a single cell's appearance in-place after a save. Avoids full re-render. */
function patchCell(ds) {
  const log = S.map.get(ds) ?? null;
  const dc  = drinkCls(log != null ? log.drinks : null);
  const lbl = log == null ? 'not logged'
    : log.drinks === 0    ? 'sober'
    : `${log.drinks} drink${log.drinks !== 1 ? 's' : ''}`;

  document.querySelectorAll(`.gc[data-date="${CSS.escape(ds)}"]`).forEach(c => {
    const keep = ['future','today'].filter(k => c.classList.contains(k));
    c.className = ['gc', dc, ...keep].join(' ');
    c.setAttribute('aria-label', `${ds}: ${lbl}`);

    const inn = c.querySelector('.gc-inner');
    if (!inn) return;
    inn.replaceChildren();
    inn.appendChild(el('span', { class: 'gc-day' }, String(parseD(ds).getDate())));
    if (log != null) {
      inn.appendChild(el('span', { class: 'gc-count' }, String(log.drinks)));
      if (log.note) {
        const ne = el('span', { class: 'gc-note' });
        ne.textContent = log.note.length > 28 ? log.note.slice(0, 28) + '…' : log.note;
        inn.appendChild(ne);
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════
   COMMIT GRAPH — rendering
   ═══════════════════════════════════════════════════════ */

function renderGraph() {
  Editor.close(false);
  FisheyeEngine.destroy();
  if (S.graphMode === 'overview') renderOverview();
  else renderScrollMode();
}

/* ── Overview ───────────────────────────────────────── */

function renderOverview() {
  const ctrl  = $id('graph-ctrl');
  const mount = $id('graph-mount');
  ctrl.replaceChildren();

  const cols   = buildWeekCols();
  const mlbls  = buildMonthLabels(cols);
  const wrap   = el('div', { class: 'ov' });

  // Month labels row
  const mrow = el('div', { class: 'ov-months', 'aria-hidden': 'true' });
  cols.forEach((_, w) => mrow.appendChild(el('div', { class: 'ov-mlbl' }, mlbls[w])));
  wrap.appendChild(mrow);

  // Body: DOW labels + week columns
  const body  = el('div', { class: 'ov-body' });
  const dows  = el('div', { class: 'ov-dows', 'aria-hidden': 'true' });
  DOWS.forEach((d, i) => dows.appendChild(el('div', { class: 'ov-dow' }, i % 2 === 1 ? d : '')));
  body.appendChild(dows);

  const grid = el('div', { class: 'ov-grid' });
  cols.forEach((week, w) => {
    const col = el('div', { class: 'ov-col', 'data-col': String(w) });
    week.forEach(entry => col.appendChild(makeCell(entry, 'overview')));
    grid.appendChild(col);
  });
  body.appendChild(grid);
  wrap.appendChild(body);
  mount.replaceChildren(wrap);

  // Click or keyboard → switch to scroll mode and open editor
  const handleActivate = ds => {
    S.graphMode   = 'scroll';
    S.graphTarget = ds;
    renderGraph();
  };

  grid.addEventListener('click', e => {
    const c = e.target.closest('.gc[data-date]');
    if (c && !c.classList.contains('future')) handleActivate(c.dataset.date);
  });
  grid.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.gc[data-date]');
    if (c && !c.classList.contains('future')) { e.preventDefault(); handleActivate(c.dataset.date); }
  });
}

/* ── Scroll mode ─────────────────────────────────────── */

function renderScrollMode() {
  const ctrl  = $id('graph-ctrl');
  const mount = $id('graph-mount');

  // Back button
  ctrl.replaceChildren();
  const backBtn = el('button', { class: 'btn-ghost sm', 'aria-label': 'Back to overview' }, '← overview');
  ctrl.appendChild(backBtn);
  backBtn.addEventListener('click', () => { S.graphMode = 'overview'; renderGraph(); });

  const cols  = buildWeekCols();
  const mlbls = buildMonthLabels(cols);
  const wrap  = el('div', { class: 'sc' });

  const body = el('div', { class: 'sc-body' });

  // DOW labels (fixed left)
  const dowArea = el('div', { class: 'sc-dows', 'aria-hidden': 'true' });
  dowArea.appendChild(el('div', { class: 'sc-dow-gap' }));
  const dowCol = el('div', { class: 'sc-dow-col' });
  DOWS.forEach((d, i) => dowCol.appendChild(el('div', { class: 'sc-dow-lbl' }, i % 2 === 1 ? d : '')));
  dowArea.appendChild(dowCol);
  body.appendChild(dowArea);

  // Scrollable week columns
  const outer = el('div', { class: 'sc-outer', id: 'sc-outer' });
  const inner = el('div', { class: 'sc-inner', id: 'sc-inner' });

  cols.forEach((week, w) => {
    const col = el('div', { class: 'sc-col', 'data-col': String(w) });
    col.appendChild(el('div', { class: 'sc-mlbl', 'aria-hidden': 'true' }, mlbls[w]));
    week.forEach(entry => col.appendChild(makeCell(entry, 'scroll')));
    inner.appendChild(col);
  });

  outer.appendChild(inner);
  body.appendChild(outer);
  wrap.appendChild(body);
  mount.replaceChildren(wrap);

  const target = S.graphTarget;
  S.graphTarget = null;

  requestAnimationFrame(() => {
    // Scroll target column near right edge
    let targetCol = 51;
    if (target) {
      for (let w = 0; w < 52; w++) {
        if (cols[w].some(e => e.ds === target)) { targetCol = w; break; }
      }
    }
    outer.scrollLeft = Math.max(0, targetCol * CG_STEP - outer.clientWidth + 3 * CG_STEP);

    FisheyeEngine.init(inner, outer);

    // If we drilled in from overview, open the editor for that date
    if (target) {
      const cell = inner.querySelector(`.gc[data-date="${CSS.escape(target)}"]`);
      if (cell && !cell.classList.contains('future')) {
        setTimeout(() => Editor.open(target, cell), 60);
      }
    }
  });

  // Click / keyboard → inline editor
  inner.addEventListener('click', e => {
    const c = e.target.closest('.gc[data-date]');
    if (c && !c.classList.contains('future')) Editor.open(c.dataset.date, c);
  });
  inner.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.gc[data-date]');
    if (c && !c.classList.contains('future')) { e.preventDefault(); Editor.open(c.dataset.date, c); }
  });
}

/* ═══════════════════════════════════════════════════════
   FISHEYE ENGINE
   Scales week-columns by distance from cursor/touch.
   Only mutates a ±5-column neighbourhood per frame.
   ═══════════════════════════════════════════════════════ */

const FisheyeEngine = {
  _outer: null, _inner: null, _cols: null,
  _px:    -1,   _raf:   null,  _dirty: null,
  _tt:    null, _armed: false, _tx: 0, _ty: 0,

  init(inner, outer) {
    this._inner = inner;
    this._outer = outer;
    this._cols  = Array.from(inner.querySelectorAll('.sc-col'));

    this._mm = e  => { this._px = e.clientX; this._sched(); };
    this._ml = () => { this._px = -1;        this._sched(); };
    this._ts = e  => this._touchStart(e);
    this._tm = e  => this._touchMove(e);
    this._te = () => { this._px = -1; clearTimeout(this._tt); this._armed = false; this._sched(); };

    outer.addEventListener('mousemove',   this._mm);
    outer.addEventListener('mouseleave',  this._ml);
    outer.addEventListener('touchstart',  this._ts, { passive: true });
    outer.addEventListener('touchmove',   this._tm, { passive: false });
    outer.addEventListener('touchend',    this._te);
    outer.addEventListener('touchcancel', this._te);
  },

  destroy() {
    if (!this._outer) return;
    const outer = this._outer;
    outer.removeEventListener('mousemove',   this._mm);
    outer.removeEventListener('mouseleave',  this._ml);
    outer.removeEventListener('touchstart',  this._ts);
    outer.removeEventListener('touchmove',   this._tm);
    outer.removeEventListener('touchend',    this._te);
    outer.removeEventListener('touchcancel', this._te);
    clearTimeout(this._tt);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._resetAll();
    this._outer = this._inner = this._cols = null;
  },

  _touchStart(e) {
    const t = e.touches[0];
    this._tx = t.clientX; this._ty = t.clientY; this._armed = false;
    clearTimeout(this._tt);
    this._tt = setTimeout(() => {
      this._armed = true;
      this._px    = this._tx;
      this._sched();
    }, 80);
  },

  _touchMove(e) {
    const t = e.touches[0];
    if (!this._armed) {
      if (Math.abs(t.clientX - this._tx) > 8 || Math.abs(t.clientY - this._ty) > 8) {
        clearTimeout(this._tt);
      }
      return;
    }
    e.preventDefault();
    this._px = t.clientX;
    this._sched();
  },

  _sched() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._apply(); });
  },

  _apply() {
    if (!this._cols) return;
    if (this._px < 0) { this._resetAll(); return; }

    const rect    = this._outer.getBoundingClientRect();
    const cx      = this._px - rect.left + this._outer.scrollLeft;
    const curCol  = Math.floor(cx / CG_STEP);
    if (curCol < 0 || curCol >= 52) { this._resetAll(); return; }

    const R  = 5;
    const lo = Math.max(0, curCol - R);
    const hi = Math.min(51, curCol + R);

    // Reset previously dirtied columns that are now out of range
    if (this._dirty) {
      for (let i = this._dirty.lo; i <= this._dirty.hi; i++) {
        if (i < lo || i > hi) this._setCol(i, CG_BASE);
      }
    }

    for (let i = lo; i <= hi; i++) {
      const d     = Math.abs(i - curCol);
      const scale = CG_SCALES[Math.min(d, CG_SCALES.length - 1)];
      this._setCol(i, Math.round(CG_BASE * scale));
    }
    this._dirty = { lo, hi };

    // Reveal inner content in sufficiently large columns
    this._cols.forEach(col => {
      const w = parseFloat(col.style.width) || CG_BASE;
      col.querySelectorAll('.gc-inner').forEach(inn => {
        inn.style.opacity = w >= 46 ? '1' : '0';
      });
    });
  },

  _setCol(i, w) {
    const col = this._cols[i];
    if (!col) return;
    col.style.width    = `${w}px`;
    col.style.minWidth = `${w}px`;
    col.querySelectorAll('.gc').forEach(c => { c.style.height = `${w}px`; });
  },

  _resetAll() {
    if (this._dirty) {
      for (let i = this._dirty.lo; i <= this._dirty.hi; i++) this._setCol(i, CG_BASE);
      this._dirty = null;
    }
    this._inner?.querySelectorAll('.gc-inner').forEach(inn => { inn.style.opacity = '0'; });
  },
};

/* ═══════════════════════════════════════════════════════
   INLINE EDITOR
   Fixed-position card anchored near the clicked cell.
   Auto-saves on close (outside click, Escape, X button).
   ═══════════════════════════════════════════════════════ */

const Editor = {
  _ds:    null, _card:  null, _orig:  null, _dirty: false,
  _cEl:   null, _nEl:   null,
  _oc:    null, _ek:    null, _vv:    null,

  open(ds, anchor) {
    // Commit any pending quick-add before we start editing
    if (_qaTimer !== null) {
      clearTimeout(_qaTimer); _qaTimer = null;
      hideToast(); _commitQA();
    }
    // Close any existing editor (saving it)
    if (this._card) this.close(true);

    this._ds    = ds;
    this._orig  = S.map.get(ds) ?? null;
    this._dirty = false;
    const log   = this._orig;

    const dlbl = parseD(ds).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    // Build card
    const card = el('div', { class: 'edit-card', id: 'edit-card',
      role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit log entry' });

    // Header
    const hdr = el('div', { class: 'edit-hdr' });
    hdr.appendChild(el('span', { class: 'edit-date' }, dlbl));
    const xBtn = el('button', { class: 'edit-x', type: 'button', 'aria-label': 'Close' }, '✕');
    hdr.appendChild(xBtn);
    card.appendChild(hdr);

    // Drink stepper
    const step = el('div', { class: 'edit-stepper', role: 'group', 'aria-label': 'Drink count' });
    const dec  = el('button', { class: 'step-btn', type: 'button', 'aria-label': 'Remove one' }, '−');
    const cnt  = el('input',  { type: 'number', class: 'edit-count', min: '0', max: '100',
                                  value: String(log ? log.drinks : 0), 'aria-label': 'Number of drinks' });
    const inc  = el('button', { class: 'step-btn', type: 'button', 'aria-label': 'Add one' }, '+');
    step.append(dec, cnt, inc);
    card.appendChild(step);

    // Note
    const noteTA = el('textarea', { class: 'edit-note', rows: '2', maxlength: '500',
                                     placeholder: 'notes…' });
    noteTA.value = log?.note || '';
    card.appendChild(noteTA);

    // Footer
    const foot   = el('div', { class: 'edit-footer' });
    const delBtn = el('button', { class: 'edit-del', type: 'button' }, 'delete entry');
    if (!log) delBtn.hidden = true;
    foot.appendChild(delBtn);
    foot.appendChild(el('span', { class: 'edit-hint' }, 'click away to save'));
    card.appendChild(foot);

    // Events
    const dirty = () => { this._dirty = true; };
    dec.addEventListener('click', () => { cnt.value = String(Math.max(0,   (parseInt(cnt.value,10)||0)-1)); dirty(); });
    inc.addEventListener('click', () => { cnt.value = String(Math.min(100, (parseInt(cnt.value,10)||0)+1)); dirty(); });
    cnt.addEventListener('input', dirty);
    noteTA.addEventListener('input', dirty);
    xBtn.addEventListener('click', () => this.close(true));

    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      try {
        await api.del(`/api/logs/${this._ds}`);
        applyLogDelete(this._ds);
        const d = this._ds; this._dirty = false; this.close(false);
        patchCell(d); refreshStats();
      } catch (err) { console.error('delete failed:', err); }
    });

    // Outside click = save & close
    this._oc = e => {
      if (this._card && !this._card.contains(e.target) && e.target !== anchor) {
        this.close(true);
      }
    };
    this._ek = e => { if (e.key === 'Escape' && this._card) this.close(true); };

    // Mobile: float above keyboard
    this._vv = () => {
      const vv = window.visualViewport;
      if (!vv || !this._card) return;
      const bot = vv.offsetTop + vv.height - 12;
      const r   = this._card.getBoundingClientRect();
      if (r.bottom > bot) {
        this._card.style.top = `${parseFloat(this._card.style.top) - (r.bottom - bot)}px`;
      }
    };
    noteTA.addEventListener('focus', () => window.visualViewport?.addEventListener('resize', this._vv));
    noteTA.addEventListener('blur',  () => window.visualViewport?.removeEventListener('resize', this._vv));

    document.body.appendChild(card);
    this._card = card;
    this._cEl  = cnt;
    this._nEl  = noteTA;

    this._position(anchor);

    // Delay attaching outside listener so the opening click doesn't immediately fire it
    setTimeout(() => {
      document.addEventListener('click',   this._oc, { capture: true });
      document.addEventListener('keydown', this._ek);
    }, 0);

    cnt.focus();
    cnt.select();
  },

  close(save) {
    if (!this._card) return;
    document.removeEventListener('click',   this._oc, { capture: true });
    document.removeEventListener('keydown', this._ek);
    window.visualViewport?.removeEventListener('resize', this._vv);

    const doSave = save && this._dirty;
    const ds = this._ds;
    this._card.remove();
    this._card = this._ds = this._orig = null;
    this._dirty = false;

    if (doSave) this._save(ds);
  },

  async _save(ds) {
    const drinks = parseInt(this._cEl?.value ?? '0', 10);
    if (isNaN(drinks) || drinks < 0 || drinks > 100) return;
    const note = (this._nEl?.value ?? '').trim();
    const orig = S.map.get(ds) ?? null;

    // Optimistic update
    applyLogSave({ id: orig?.id || '', date: ds, drinks, note });
    patchCell(ds);
    refreshStats();

    // Toast with undo
    const label = parseD(ds).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    showToast(`saved · ${label}`, () => {
      if (orig === null) applyLogDelete(ds);
      else applyLogSave(orig);
      patchCell(ds);
      refreshStats();
    });

    // Persist
    try {
      const saved = await api.post('/api/logs', { date: ds, drinks, note });
      applyLogSave(saved);
      patchCell(ds);
    } catch {
      // Revert on API failure
      if (orig === null) applyLogDelete(ds);
      else applyLogSave(orig);
      patchCell(ds);
    }
  },

  _position(anchor) {
    const r  = anchor.getBoundingClientRect();
    const W  = 248;
    const M  = 10;
    const EH = 260; // estimated card height

    let l = r.left;
    let t = r.bottom + M;

    if (l + W > window.innerWidth  - M) l = window.innerWidth  - W - M;
    if (l < M) l = M;
    if (t + EH > window.innerHeight - M) t = r.top - EH - M;
    if (t < M) t = M;

    this._card.style.left = `${l}px`;
    this._card.style.top  = `${t}px`;
  },
};

/* ═══════════════════════════════════════════════════════
   MONTH VIEW
   ═══════════════════════════════════════════════════════ */

function renderMonth() {
  const y   = S.moYear;
  const m   = S.moMonth;
  const ts  = today();
  const now = new Date();

  $id('mo-label').textContent =
    new Date(y, m, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  $id('btn-mo-next').disabled =
    y > now.getFullYear() ||
    (y === now.getFullYear() && m >= now.getMonth());

  const grid = $id('mo-grid');
  grid.replaceChildren();

  // Day-of-week headers
  ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d =>
    grid.appendChild(el('div', { class: 'mo-hdr', 'aria-hidden': 'true' }, d)));

  // Blank offset (Mon-start)
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const frag   = document.createDocumentFragment();
  for (let i = 0; i < offset; i++) {
    frag.appendChild(el('div', { class: 'mo-cell blank', 'aria-hidden': 'true' }));
  }

  const total = daysIn(y, m + 1);
  for (let d = 1; d <= total; d++) {
    const ds  = `${y}-${pad(m+1)}-${pad(d)}`;
    const log = S.map.get(ds);
    const fut = ds > ts;
    const tod = ds === ts;
    const dc  = drinkCls(log != null ? log.drinks : null);
    const cls = ['mo-cell', dc, fut ? 'future' : '', tod ? 'today' : ''].filter(Boolean).join(' ');
    const c   = el('div', { class: cls, 'data-date': ds });

    if (!fut) {
      c.setAttribute('tabindex', '0');
      c.setAttribute('role', 'gridcell');
    }
    c.appendChild(el('span', { class: 'mo-day', 'aria-hidden': 'true' }, String(d)));
    if (log != null) {
      c.appendChild(el('span', { class: 'mo-n', 'aria-hidden': 'true' }, String(log.drinks)));
    }
    frag.appendChild(c);
  }
  grid.appendChild(frag);

  grid.onclick = e => {
    const c = e.target.closest('.mo-cell[data-date]');
    if (c && !c.classList.contains('future')) Editor.open(c.dataset.date, c);
  };
  grid.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.mo-cell[data-date]');
    if (c && !c.classList.contains('future')) { e.preventDefault(); Editor.open(c.dataset.date, c); }
  };
}

function initMonthNav() {
  $id('btn-mo-prev').addEventListener('click', () => {
    S.moMonth--;
    if (S.moMonth < 0) { S.moMonth = 11; S.moYear--; }
    if (S.view === 'month') renderMonth();
  });
  $id('btn-mo-next').addEventListener('click', () => {
    const now   = new Date();
    const atLim = S.moYear > now.getFullYear() ||
      (S.moYear === now.getFullYear() && S.moMonth >= now.getMonth());
    if (!atLim) {
      S.moMonth++;
      if (S.moMonth > 11) { S.moMonth = 0; S.moYear++; }
      if (S.view === 'month') renderMonth();
    }
  });
}

/* ═══════════════════════════════════════════════════════
   RIVER VIEW
   ═══════════════════════════════════════════════════════ */

function renderRiver() {
  const year  = new Date().getFullYear();
  const ts    = today();

  let maxD = 0;
  S.logs.forEach(l => { if (l.drinks > maxD) maxD = l.drinks; });
  const scale = Math.max(maxD, 5);

  const barsEl   = $id('river-bars');
  const monthsEl = $id('river-months');
  const yEl      = $id('river-y');

  // Y axis
  yEl.style.height = `${R_H + 20}px`;
  const yFrag  = document.createDocumentFragment();
  const tStep  = Math.max(1, Math.ceil(scale / 4));
  for (let v = scale; v >= 0; v -= tStep) {
    yFrag.appendChild(el('span', { class: 'ry-tick' }, String(v)));
  }
  yEl.replaceChildren(yFrag);

  const barFrag   = document.createDocumentFragment();
  const monthFrag = document.createDocumentFragment();
  let todayIdx    = -1;
  let dayIdx      = 0;

  for (let mo = 0; mo < 12; mo++) {
    const days  = daysIn(year, mo + 1);
    const mlbl  = el('div', { class: 'rm-lbl' }, MONTHS[mo]);
    mlbl.style.width    = `${days * R_STEP}px`;
    mlbl.style.minWidth = `${days * R_STEP}px`;
    monthFrag.appendChild(mlbl);

    for (let d = 1; d <= days; d++) {
      const ds  = `${year}-${pad(mo+1)}-${pad(d)}`;
      const log = S.map.get(ds);
      const fut = ds > ts;
      const tod = ds === ts;
      if (tod) todayIdx = dayIdx;

      let h, cls;
      if (fut) {
        h = 2; cls = 'future';
      } else if (log == null) {
        h = 2; cls = 'none-bar';
      } else if (log.drinks === 0) {
        h = 4; cls = 'sober';
      } else {
        h   = Math.max(6, Math.round((log.drinks / scale) * R_H));
        cls = drinkCls(log.drinks);
      }

      const bar = el('div', {
        class:       `rbar ${cls}${tod ? ' today' : ''}`,
        'data-date': ds,
        role:        fut ? undefined : 'button',
        tabindex:    fut ? '-1' : '0',
        'aria-label': fut ? undefined : (() => {
          const dl = parseD(ds).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const dk = log == null ? 'not logged' : log.drinks === 0 ? 'sober' : `${log.drinks}`;
          return `${dl}: ${dk}`;
        })(),
      });
      bar.style.height = `${h}px`;
      barFrag.appendChild(bar);
      dayIdx++;
    }
  }

  barsEl.replaceChildren(barFrag);
  monthsEl.replaceChildren(monthFrag);

  barsEl.onclick = e => {
    const b = e.target.closest('.rbar[data-date]');
    if (b && !b.classList.contains('future')) Editor.open(b.dataset.date, b);
  };
  barsEl.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const b = e.target.closest('.rbar[data-date]');
    if (b && !b.classList.contains('future')) { e.preventDefault(); Editor.open(b.dataset.date, b); }
  };

  if (todayIdx >= 0) {
    requestAnimationFrame(() => {
      const s = $id('river-scroll');
      s.scrollLeft = Math.max(0, todayIdx * R_STEP - s.clientWidth * 0.25);
    });
  }
}

/* ═══════════════════════════════════════════════════════
   TOAST (shared by quick-add and inline editor)
   ═══════════════════════════════════════════════════════ */

let _toastTimer  = null;
let _toastUndoFn = null;

function showToast(msg, undoFn) {
  clearTimeout(_toastTimer);
  _toastUndoFn = undoFn;
  $id('toast-msg').textContent = msg;
  $id('toast').hidden = false;
  _toastTimer = setTimeout(() => {
    $id('toast').hidden = true;
    _toastUndoFn = null;
    _toastTimer  = null;
  }, 5000);
}

function hideToast() {
  clearTimeout(_toastTimer);
  $id('toast').hidden = true;
  _toastUndoFn = null;
  _toastTimer  = null;
}

function initToast() {
  $id('toast-undo').addEventListener('click', () => {
    clearTimeout(_toastTimer);
    $id('toast').hidden = true;
    const fn = _toastUndoFn;
    _toastUndoFn = null;
    _toastTimer  = null;
    if (fn) fn();
  });
}

/* ═══════════════════════════════════════════════════════
   QUICK ADD
   Optimistic +1 with 5s deferred commit and undo.
   Rapid taps coalesce into one network request.
   ═══════════════════════════════════════════════════════ */

let _qaOrig  = null; // snapshot before this batch
let _qaTarget = 0;   // optimistic drink count
let _qaTimer  = null;

function initQuickAdd() {
  $id('btn-qa').addEventListener('click', handleQA);
}

function handleQA() {
  const ts  = today();
  const ex  = S.map.get(ts);

  if (_qaTimer === null) {
    _qaOrig = ex ? { ...ex } : null;
  }

  clearTimeout(_qaTimer);
  _qaTarget = (S.map.get(ts)?.drinks ?? 0) + 1;

  applyLogSave({ id: ex?.id || '', date: ts, drinks: _qaTarget, note: ex?.note || '' });

  // Refresh just the today cell if graph is visible; otherwise full render
  if (S.view === 'graph' && S.graphMode === 'scroll') {
    patchCell(ts);
  } else {
    renderView();
  }

  const label = `+1 · ${_qaTarget} today`;
  showToast(label, () => {
    clearTimeout(_qaTimer); _qaTimer = null;
    const t = today();
    if (_qaOrig === null) applyLogDelete(t);
    else applyLogSave(_qaOrig);
    if (S.view === 'graph' && S.graphMode === 'scroll') patchCell(t);
    else renderView();
  });

  _qaTimer = setTimeout(() => { _qaTimer = null; _commitQA(); }, 5000);
}

async function _commitQA() {
  _qaTimer = null;
  $id('toast').hidden = true;
  const ts   = today();
  const note = S.map.get(ts)?.note || '';
  try {
    const saved = await api.post('/api/logs', { date: ts, drinks: _qaTarget, note });
    applyLogSave(saved);
    if (S.view === 'graph' && S.graphMode === 'scroll') patchCell(ts);
    else renderView();
    refreshStats();
  } catch {
    // Revert
    if (_qaOrig === null) applyLogDelete(ts);
    else applyLogSave(_qaOrig);
    if (S.view === 'graph' && S.graphMode === 'scroll') patchCell(ts);
    else renderView();
  }
  _qaOrig = null;
}

/* ═══════════════════════════════════════════════════════
   DELETE ACCOUNT
   ═══════════════════════════════════════════════════════ */

function initDeleteAccount() {
  $id('btn-del-acct').addEventListener('click', async () => {
    if (!confirm('Delete your account and all logs permanently?\nThis cannot be undone.')) return;
    try {
      await api.del('/api/account');
      S.user = null; S.logs = []; S.stats = null; S.map.clear();
      showAuth();
    } catch (err) { alert('Error: ' + err.message); }
  });
}

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */

function init() {
  initAuth();
  initViewNav();
  initMonthNav();
  initToast();
  initQuickAdd();
  initDeleteAccount();
  checkAuth();
}

document.addEventListener('DOMContentLoaded', init);
