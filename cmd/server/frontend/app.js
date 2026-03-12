'use strict';

// ── Utilities ────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function isoToday() { return toISO(new Date()); }

function fmtShort(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
}

function fmtToday(date) {
  return date.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
}

function level(drinks) {
  if (drinks === 0) return 0;
  if (drinks <= 2) return 1;
  if (drinks <= 4) return 2;
  return 3;
}

function weekMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0,0,0,0);
  return d;
}

// ── State ────────────────────────────────────────────────
const TODAY = isoToday();
const S = {
  user: null,
  logs: new Map(),   // iso -> {drinks, note}
  stats: null,
  view: 'graph',
};

// ── API ──────────────────────────────────────────────────
async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(()=>'');
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch {}
    throw new Error(msg || r.statusText);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json() : null;
}

// ── Boot ─────────────────────────────────────────────────
async function init() {
  try {
    const me = await api('GET', '/api/me');
    S.user = me.username;
    await loadAll();
    showApp();
  } catch {
    showAuth();
  }
}

async function loadAll() {
  const [logs, stats] = await Promise.all([api('GET','/api/logs'), api('GET','/api/stats')]);
  S.logs.clear();
  for (const l of logs) S.logs.set(l.date, {drinks: l.drinks, note: l.note || ''});
  S.stats = stats;
}

// ── Auth ─────────────────────────────────────────────────
let _authMode = 'login';

function showAuth() {
  $('app').hidden = true;
  $('auth').hidden = false;
}

function showApp() {
  $('auth').hidden = true;
  $('app').hidden = false;
  window.scrollTo(0, 0);
  $('hdr-name').textContent = S.user;
  renderToday();
  renderStats();
  renderGraph();
}

$('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = $('f-user').value.trim();
  const password = $('f-pass').value;
  $('auth-err').textContent = '';
  $('auth-btn').disabled = true;
  try {
    if (_authMode === 'register') await api('POST', '/api/register', {username, password});
    await api('POST', '/api/login', {username, password});
    S.user = username;
    await loadAll();
    showApp();
  } catch(err) {
    $('auth-err').textContent = err.message;
  } finally {
    $('auth-btn').disabled = false;
  }
});

$('auth-toggle').addEventListener('click', () => {
  _authMode = _authMode === 'login' ? 'register' : 'login';
  $('auth-err').textContent = '';
  $('auth-btn').textContent      = _authMode === 'login' ? 'log in' : 'register';
  $('auth-toggle').textContent   = _authMode === 'login' ? 'no account? register →' : 'have an account? log in →';
});

// ── Header / Account ─────────────────────────────────────
$('user-btn').addEventListener('click', e => {
  e.stopPropagation();
  const open = $('user-menu').classList.toggle('is-open');
  $('user-btn').setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', () => {
  $('user-menu').classList.remove('is-open');
  $('user-btn').setAttribute('aria-expanded', 'false');
});

$('btn-logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(()=>{});
  location.reload();
});

$('btn-del').addEventListener('click', async () => {
  if (!confirm('Permanently delete your account and all data?')) return;
  await api('DELETE', '/api/account');
  location.reload();
});

// ── Today bar ────────────────────────────────────────────
function renderToday() {
  $('today-date').textContent = fmtToday(new Date());
  const log = S.logs.get(TODAY);
  $('today-n').textContent = log ? log.drinks : 0;
}

async function adjustToday(delta) {
  const log = S.logs.get(TODAY);
  const cur = log ? log.drinks : 0;
  const next = Math.max(0, cur + delta);
  const note = log ? log.note : '';

  S.logs.set(TODAY, {drinks: next, note});
  $('today-n').textContent = next;
  patchCell(TODAY);

  try {
    if (next === 0 && !note) {
      if (log) await api('DELETE', `/api/logs/${TODAY}`);
      S.logs.delete(TODAY);
    } else {
      await api('POST', '/api/logs', {date: TODAY, drinks: next, note});
    }
    S.stats = await api('GET', '/api/stats');
    renderStats();
  } catch {
    if (log) S.logs.set(TODAY, log); else S.logs.delete(TODAY);
    renderToday();
    patchCell(TODAY);
  }
}

$('btn-minus').addEventListener('click', () => adjustToday(-1));
$('btn-plus').addEventListener('click',  () => adjustToday(+1));

// ── Stats ────────────────────────────────────────────────
function renderStats() {
  if (!S.stats) return;
  $('s-week').textContent   = S.stats.total_this_week   ?? '—';
  $('s-month').textContent  = S.stats.total_this_month  ?? '—';
  $('s-all').textContent    = S.stats.total_all_time    ?? '—';
  $('s-streak').textContent = S.stats.current_streak    ?? '—';
}

// ── Tabs ─────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    S.view = btn.dataset.view;
    $('view-graph').hidden = S.view !== 'graph';
    $('view-feed').hidden  = S.view !== 'feed';
    if (S.view === 'feed') renderFeed();
  });
});

// ── Graph rendering ───────────────────────────────────────
function renderGraph() {
  const grid = $('graph');
  grid.innerHTML = '';

  // Determine earliest week to show
  const allDates = [...S.logs.keys()].sort();
  const earliest = allDates.length
    ? weekMonday(new Date(allDates[0] + 'T00:00:00'))
    : (() => { const d = new Date(); d.setDate(d.getDate() - 7*8); return weekMonday(d); })();

  const curMonday = weekMonday(new Date());
  const todayMs   = new Date(TODAY + 'T00:00:00').getTime();

  // Collect weeks newest-first
  const weeks = [];
  for (let w = new Date(curMonday); w >= earliest; w.setDate(w.getDate()-7)) {
    weeks.push(new Date(w));
  }

  const frag = document.createDocumentFragment();
  for (const weekStart of weeks) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + d);
      const iso = toISO(date);
      const future = date.getTime() > todayMs;

      const el = document.createElement('div');
      el.className = 'gc';
      el.dataset.date = iso;
      if (future) {
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
      } else {
        const log = S.logs.get(iso);
        if (log !== undefined) el.dataset.level = level(log.drinks);
      }
      frag.appendChild(el);
    }
  }
  grid.appendChild(frag);
}

function patchCell(iso) {
  const el = $('graph').querySelector(`[data-date="${iso}"]`);
  if (!el) return;
  const log = S.logs.get(iso);
  if (log !== undefined) el.dataset.level = level(log.drinks);
  else delete el.dataset.level;
}

// ── Bubble engine ────────────────────────────────────────
const COLS = 7;

function applyBubble(grid, focusEl) {
  const cells = [...grid.querySelectorAll('.gc')];
  if (!focusEl) {
    cells.forEach(c => { c.style.transform = ''; c.style.transition = ''; c.style.zIndex = ''; });
    return;
  }
  const fi = cells.indexOf(focusEl);
  if (fi < 0) return;
  const fr = Math.floor(fi / COLS), fc = fi % COLS;

  cells.forEach((el, i) => {
    const dist = Math.sqrt((Math.floor(i/COLS)-fr)**2 + (i%COLS-fc)**2);
    let scale;
    if      (dist === 0)  scale = 1.75;
    else if (dist < 1.5)  scale = 0.88;
    else if (dist < 2.5)  scale = 0.93;
    else                  scale = 1;
    el.style.transition = 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1)';
    el.style.transform  = `scale(${scale})`;
    el.style.zIndex     = dist === 0 ? '10' : '';
  });
}

function clearBubble(grid) { applyBubble(grid, null); }

// Returns the .gc cell under a point (or null)
function cellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest('.gc') || null;
}

// ── Graph interaction ────────────────────────────────────
let _scrub = false, _touchId = null, _holdTimer = null, _moved = false;

const grid = $('graph');

grid.addEventListener('touchstart', e => {
  const t = e.changedTouches[0];
  _touchId = t.identifier;
  _moved   = false;
  const el = cellAt(t.clientX, t.clientY);
  if (!el) return;
  _holdTimer = setTimeout(() => {
    _scrub = true;
    applyBubble(grid, el);
  }, 130);
}, {passive: true});

grid.addEventListener('touchmove', e => {
  const t = [...e.changedTouches].find(x => x.identifier === _touchId);
  if (!t) return;
  _moved = true;
  if (_scrub) {
    e.preventDefault();
    const el = cellAt(t.clientX, t.clientY);
    if (el) applyBubble(grid, el);
  } else {
    clearTimeout(_holdTimer);
  }
}, {passive: false});

grid.addEventListener('touchend', e => {
  const t = [...e.changedTouches].find(x => x.identifier === _touchId);
  clearTimeout(_holdTimer);
  if (t && _scrub) {
    const el = cellAt(t.clientX, t.clientY);
    clearBubble(grid);
    openPanel(el);
  } else if (t && !_moved) {
    const el = cellAt(t.clientX, t.clientY);
    openPanel(el);
  }
  _scrub = false; _touchId = null;
}, {passive: true});

grid.addEventListener('touchcancel', () => {
  clearTimeout(_holdTimer);
  clearBubble(grid);
  _scrub = false; _touchId = null;
}, {passive: true});

// Mouse (desktop)
let _mdown = false, _mScrub = false;

grid.addEventListener('mousedown', e => {
  _mdown = true; _moved = false;
  const el = cellAt(e.clientX, e.clientY);
  if (!el) return;
  _holdTimer = setTimeout(() => { _mScrub = true; applyBubble(grid, el); }, 130);
});
grid.addEventListener('mousemove', e => {
  if (!_mdown) return;
  _moved = true;
  if (_mScrub) {
    const el = cellAt(e.clientX, e.clientY);
    if (el) applyBubble(grid, el);
  } else {
    clearTimeout(_holdTimer);
  }
});
grid.addEventListener('mouseup', e => {
  clearTimeout(_holdTimer);
  if (_mScrub) {
    clearBubble(grid);
    openPanel(cellAt(e.clientX, e.clientY));
    _mScrub = false;
  } else if (!_moved) {
    openPanel(cellAt(e.clientX, e.clientY));
  }
  _mdown = false;
});
grid.addEventListener('mouseleave', () => {
  clearTimeout(_holdTimer);
  if (_mScrub) { clearBubble(grid); _mScrub = false; }
  _mdown = false;
});

// ── Cell panel ───────────────────────────────────────────
let _panelDate = null;

function openPanel(el) {
  if (!el) return;
  const iso = el.dataset.date;
  if (!iso || iso > TODAY) return;

  // Save & close any existing open panel
  closePanel(true);

  _panelDate = iso;
  const log = S.logs.get(iso);

  $('cp-date').textContent    = fmtShort(iso);
  $('cp-n').textContent       = log ? log.drinks : 0;
  $('cp-note').value          = log ? (log.note || '') : '';

  const panel = $('cell-panel');
  panel.classList.add('is-open');

  // Position relative to .graph-wrap
  const wrap     = panel.parentElement;
  const wrapRect = wrap.getBoundingClientRect();
  const cellRect = el.getBoundingClientRect();
  const pw = 200, ph = panel.offsetHeight || 148;

  let left = cellRect.left - wrapRect.left;
  let top  = cellRect.bottom - wrapRect.top + 6;

  if (cellRect.bottom + ph + 8 > window.innerHeight) {
    top = cellRect.top - wrapRect.top - ph - 6;
  }
  left = Math.min(Math.max(left, 0), wrap.offsetWidth - pw);

  panel.style.left = `${left}px`;
  panel.style.top  = `${top}px`;

  el.classList.add('is-focus');
}

async function closePanel(save = true) {
  const panel = $('cell-panel');
  if (!panel.classList.contains('is-open') || !_panelDate) return;

  if (save) {
    const drinks = parseInt($('cp-n').textContent, 10) || 0;
    const note   = $('cp-note').value.trim();
    await saveDayEntry(_panelDate, drinks, note);
  }

  panel.classList.remove('is-open');
  grid.querySelector('.is-focus')?.classList.remove('is-focus');
  _panelDate = null;
}

async function saveDayEntry(iso, drinks, note) {
  const prev = S.logs.get(iso);
  S.logs.set(iso, {drinks, note});
  patchCell(iso);
  if (iso === TODAY) $('today-n').textContent = drinks;

  try {
    if (drinks === 0 && !note) {
      await api('DELETE', `/api/logs/${iso}`);
      S.logs.delete(iso);
      patchCell(iso);
    } else {
      await api('POST', '/api/logs', {date: iso, drinks, note});
    }
    S.stats = await api('GET', '/api/stats');
    renderStats();
  } catch {
    if (prev) S.logs.set(iso, prev); else S.logs.delete(iso);
    patchCell(iso);
    if (iso === TODAY) renderToday();
  }
}

$('cp-minus').addEventListener('click', () => {
  const n = parseInt($('cp-n').textContent, 10) || 0;
  $('cp-n').textContent = Math.max(0, n - 1);
});
$('cp-plus').addEventListener('click', () => {
  $('cp-n').textContent = (parseInt($('cp-n').textContent, 10) || 0) + 1;
});
$('cp-del').addEventListener('click', async () => {
  if (!_panelDate) return;
  const iso = _panelDate;
  $('cell-panel').classList.remove('is-open');
  grid.querySelector('.is-focus')?.classList.remove('is-focus');
  _panelDate = null;
  S.logs.delete(iso);
  patchCell(iso);
  if (iso === TODAY) renderToday();
  await api('DELETE', `/api/logs/${iso}`).catch(()=>{});
  S.stats = await api('GET', '/api/stats');
  renderStats();
});

// Close panel on outside click
document.addEventListener('click', e => {
  if (!$('cell-panel').classList.contains('is-open')) return;
  if (!$('cell-panel').contains(e.target) && !e.target.closest('.gc')) {
    closePanel(true);
  }
});

// ── Feed ────────────────────────────────────────────────
let _feedOpen = null;

function renderFeed() {
  const container = $('feed');
  container.innerHTML = '';
  const sorted = [...S.logs.entries()].sort((a,b) => b[0].localeCompare(a[0]));
  for (const [iso, log] of sorted) container.appendChild(makeFeedItem(iso, log));
}

function makeFeedItem(iso, log) {
  const lv   = level(log.drinks);
  const item = document.createElement('div');
  item.className   = 'feed-item';
  item.dataset.date = iso;

  item.innerHTML = `
    <div class="feed-row">
      <span class="feed-date">${fmtShort(iso)}</span>
      <span class="feed-preview">${log.note || ''}</span>
      <span class="feed-count" data-level="${lv}">${log.drinks}</span>
    </div>
    <div class="feed-body">
      <div class="stepper">
        <button class="step-btn f-minus">−</button>
        <span class="step-val f-n">${log.drinks}</span>
        <button class="step-btn f-plus">+</button>
      </div>
      <textarea class="f-note" rows="3" placeholder="note…">${log.note || ''}</textarea>
      <button class="feed-del">delete entry</button>
    </div>`;

  item.querySelector('.feed-row').addEventListener('click', () => toggleFeedItem(item, iso));
  item.querySelector('.f-minus').addEventListener('click', e => {
    e.stopPropagation();
    const el = item.querySelector('.f-n');
    el.textContent = Math.max(0, parseInt(el.textContent, 10) - 1);
  });
  item.querySelector('.f-plus').addEventListener('click', e => {
    e.stopPropagation();
    const el = item.querySelector('.f-n');
    el.textContent = parseInt(el.textContent, 10) + 1;
  });
  item.querySelector('.feed-del').addEventListener('click', async e => {
    e.stopPropagation();
    S.logs.delete(iso);
    patchCell(iso);
    if (iso === TODAY) renderToday();
    item.remove();
    if (_feedOpen === item) _feedOpen = null;
    await api('DELETE', `/api/logs/${iso}`).catch(()=>{});
    S.stats = await api('GET', '/api/stats');
    renderStats();
  });

  return item;
}

async function toggleFeedItem(item, iso) {
  const body = item.querySelector('.feed-body');

  if (body.classList.contains('is-open')) {
    await saveFeedItem(item, iso);
    body.classList.remove('is-open');
    _feedOpen = null;
    return;
  }

  if (_feedOpen) {
    const prev = _feedOpen;
    await saveFeedItem(prev, prev.dataset.date);
    prev.querySelector('.feed-body').classList.remove('is-open');
  }

  body.classList.add('is-open');
  _feedOpen = item;
}

async function saveFeedItem(item, iso) {
  const drinks = parseInt(item.querySelector('.f-n').textContent, 10) || 0;
  const note   = item.querySelector('.f-note').value.trim();
  const prev   = S.logs.get(iso);
  if (prev && prev.drinks === drinks && (prev.note||'') === note) return;

  S.logs.set(iso, {drinks, note});
  item.querySelector('.feed-count').textContent      = drinks;
  item.querySelector('.feed-count').dataset.level    = level(drinks);
  item.querySelector('.feed-preview').textContent    = note;
  patchCell(iso);
  if (iso === TODAY) $('today-n').textContent = drinks;

  try {
    if (drinks === 0 && !note) {
      await api('DELETE', `/api/logs/${iso}`);
      S.logs.delete(iso);
      item.remove();
    } else {
      await api('POST', '/api/logs', {date: iso, drinks, note});
    }
    S.stats = await api('GET', '/api/stats');
    renderStats();
  } catch {
    if (prev) S.logs.set(iso, prev); else S.logs.delete(iso);
  }
}

init();
