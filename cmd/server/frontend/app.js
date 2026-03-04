'use strict';

// ===== API =====
const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new APIError(res.status, data.error || 'Request failed');
    return data;
  },
  get:    (path)        => api.request('GET', path),
  post:   (path, body)  => api.request('POST', path, body),
  delete: (path)        => api.request('DELETE', path),
};

class APIError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ===== State =====
const state = {
  user: null,
  logs: [],      // array of {date, drinks, note}
  stats: null,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(), // 0-indexed
  chart: null,
  modalDate: null,
};

// ===== DOM helpers =====
const $ = id => document.getElementById(id);
const show = el => el.removeAttribute('hidden');
const hide = el => el.setAttribute('hidden', '');
const setError = (el, msg) => { el.textContent = msg || ''; };

// ===== Auth =====
async function checkAuth() {
  try {
    const data = await api.get('/api/me');
    state.user = data.username;
    showMainScreen();
  } catch {
    showAuthScreen();
  }
}

function showAuthScreen() {
  hide($('main-screen'));
  show($('auth-screen'));
}

function showMainScreen() {
  hide($('auth-screen'));
  show($('main-screen'));
  $('header-username').textContent = state.user;
  loadData();
}

async function loadData() {
  try {
    const [logs, stats] = await Promise.all([
      api.get('/api/logs'),
      api.get('/api/stats'),
    ]);
    state.logs = logs || [];
    state.stats = stats;
    renderCalendar();
    renderStats();
    renderChart();
  } catch (e) {
    console.error('loadData failed', e);
  }
}

function logsMap() {
  const m = new Map();
  for (const l of state.logs) m.set(l.date, l);
  return m;
}

// ===== Auth forms =====
function initAuthForms() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const target = tab.dataset.tab;
      $('login-panel').hidden   = target !== 'login';
      $('register-panel').hidden = target !== 'register';
    });
  });

  // Login
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    const errEl = $('login-error');
    setError(errEl, '');
    btn.disabled = true;

    try {
      const data = await api.post('/api/login', {
        username: $('login-username').value.trim(),
        password: $('login-password').value,
      });
      state.user = data.username;
      showMainScreen();
    } catch (err) {
      setError(errEl, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Register
  $('register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    const errEl = $('register-error');
    setError(errEl, '');
    btn.disabled = true;

    try {
      await api.post('/api/register', {
        username: $('reg-username').value.trim(),
        password: $('reg-password').value,
      });
      // Auto login
      const data = await api.post('/api/login', {
        username: $('reg-username').value.trim(),
        password: $('reg-password').value,
      });
      state.user = data.username;
      showMainScreen();
    } catch (err) {
      setError(errEl, err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// ===== Logout =====
function initLogout() {
  $('logout-btn').addEventListener('click', async () => {
    try { await api.post('/api/logout'); } catch {}
    state.user = null;
    state.logs = [];
    state.stats = null;
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    showAuthScreen();
  });
}

// ===== Calendar =====
function renderCalendar() {
  const grid = $('calendar-grid');
  // Remove existing day cells (keep 7 header cells)
  const headers = Array.from(grid.querySelectorAll('.day-header'));
  grid.innerHTML = '';
  headers.forEach(h => grid.appendChild(h));

  const year = state.currentYear;
  const month = state.currentMonth;

  const label = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  $('month-label').textContent = label;

  // First day of month (0=Sun..6=Sat), convert to Mon-first (0=Mon..6=Sun)
  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay + 6) % 7; // offset empty slots at start

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = formatDate(today);
  const map = logsMap();

  // Empty slots before first day
  for (let i = 0; i < offset; i++) {
    const el = document.createElement('div');
    el.className = 'day-cell empty-slot';
    el.setAttribute('aria-hidden', 'true');
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const log = map.get(dateStr);
    const isFuture = dateStr > todayStr;
    const isToday = dateStr === todayStr;

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    cell.setAttribute('role', 'gridcell');
    cell.dataset.date = dateStr;

    if (isToday) cell.classList.add('today');

    if (isFuture) {
      cell.classList.add('future');
      cell.setAttribute('aria-disabled', 'true');
    } else {
      cell.setAttribute('tabindex', '0');
    }

    const numEl = document.createElement('span');
    numEl.className = 'day-num';
    numEl.textContent = d;
    cell.appendChild(numEl);

    if (log !== undefined) {
      const drinks = log.drinks;
      cell.classList.add(drinkClass(drinks));

      const drinksEl = document.createElement('span');
      drinksEl.className = 'day-drinks';
      drinksEl.textContent = drinks;
      cell.appendChild(drinksEl);

      const drinkWord = drinks === 1 ? 'drink' : 'drinks';
      cell.setAttribute('aria-label', `${dateStr}: ${drinks} ${drinkWord}${log.note ? ', ' + log.note : ''}`);
    } else if (!isFuture) {
      cell.setAttribute('aria-label', `${dateStr}: not logged. Click to log.`);
    }

    if (!isFuture) {
      cell.addEventListener('click', () => openModal(dateStr));
      cell.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(dateStr);
        }
      });
    }

    grid.appendChild(cell);
  }
}

function drinkClass(n) {
  if (n === 0) return 'sober';
  if (n <= 2)  return 'low';
  if (n <= 4)  return 'mid';
  return 'high';
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== Month navigation =====
function initMonthNav() {
  $('prev-month').addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 0) {
      state.currentMonth = 11;
      state.currentYear--;
    }
    renderCalendar();
  });

  $('next-month').addEventListener('click', () => {
    const now = new Date();
    if (state.currentYear < now.getFullYear() ||
        (state.currentYear === now.getFullYear() && state.currentMonth < now.getMonth())) {
      state.currentMonth++;
      if (state.currentMonth > 11) {
        state.currentMonth = 0;
        state.currentYear++;
      }
      renderCalendar();
    }
  });
}

// ===== Stats =====
function renderStats() {
  const s = state.stats;
  if (!s) return;

  $('stat-week').textContent  = s.total_this_week;
  $('stat-month').textContent = s.total_this_month;
  $('stat-all').textContent   = s.total_all_time;

  $('stat-streak').textContent = s.current_streak + (s.current_streak === 1 ? ' day' : ' days');
  if (s.longest_streak > 0) {
    $('stat-streak-sub').textContent = `best: ${s.longest_streak}d`;
  }

  $('stat-avg').textContent   = s.avg_drinking_days || '—';
  $('stat-sober').textContent = s.pct_sober_days + '%';
}

// ===== Chart =====
function renderChart() {
  const s = state.stats;
  if (!s || !s.weekly_totals) return;

  const labels = s.weekly_totals.map(w => {
    const d = new Date(w.week_start + 'T00:00:00');
    return d.toLocaleString('default', { month: 'short', day: 'numeric' });
  });
  const data = s.weekly_totals.map(w => w.total);

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = data;
    state.chart.update();
    return;
  }

  const ctx = $('trend-chart').getContext('2d');
  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Drinks',
        data,
        backgroundColor: '#6c63ff88',
        borderColor: '#6c63ff',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => 'Week of ' + items[0].label,
            label: item => item.raw + ' drinks',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#888899', font: { size: 10 } },
          grid: { color: '#2e2e3e' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#888899', stepSize: 1 },
          grid: { color: '#2e2e3e' },
        },
      },
    },
  });
}

// ===== Modal =====
function openModal(dateStr) {
  state.modalDate = dateStr;
  $('modal-date').textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const log = logsMap().get(dateStr);
  $('drinks-input').value = log ? log.drinks : 0;
  $('note-input').value = log ? log.note || '' : '';
  setError($('log-error'), '');

  const deleteBtn = $('modal-delete');
  if (log) {
    show(deleteBtn);
  } else {
    hide(deleteBtn);
  }

  show($('log-modal'));
  $('drinks-input').focus();
}

function closeModal() {
  hide($('log-modal'));
  state.modalDate = null;
}

function initModal() {
  $('modal-cancel').addEventListener('click', closeModal);

  $('log-modal').addEventListener('click', e => {
    if (e.target === $('log-modal')) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('log-modal').hidden) closeModal();
  });

  // Stepper
  $('drinks-dec').addEventListener('click', () => {
    const v = parseInt($('drinks-input').value, 10) || 0;
    $('drinks-input').value = Math.max(0, v - 1);
  });
  $('drinks-inc').addEventListener('click', () => {
    const v = parseInt($('drinks-input').value, 10) || 0;
    $('drinks-input').value = Math.min(100, v + 1);
  });

  // Save — debounced to prevent double submit
  let saving = false;
  $('log-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (saving) return;
    saving = true;

    const drinks = parseInt($('drinks-input').value, 10);
    if (isNaN(drinks) || drinks < 0 || drinks > 100) {
      setError($('log-error'), 'Drinks must be 0–100');
      saving = false;
      return;
    }

    try {
      await api.post('/api/logs', {
        date: state.modalDate,
        drinks,
        note: $('note-input').value.trim(),
      });
      closeModal();
      await loadData();
    } catch (err) {
      setError($('log-error'), err.message);
    } finally {
      saving = false;
    }
  });

  // Delete entry
  $('modal-delete').addEventListener('click', async () => {
    if (!confirm('Delete this entry?')) return;
    try {
      await api.delete(`/api/logs/${state.modalDate}`);
      closeModal();
      await loadData();
    } catch (err) {
      setError($('log-error'), err.message);
    }
  });
}

// ===== Delete account =====
function initDeleteAccount() {
  $('delete-account-btn').addEventListener('click', async () => {
    if (!confirm('Permanently delete your account and all logs? This cannot be undone.')) return;
    try {
      await api.delete('/api/account');
      state.user = null;
      state.logs = [];
      state.stats = null;
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      showAuthScreen();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// ===== Init =====
function init() {
  initAuthForms();
  initLogout();
  initMonthNav();
  initModal();
  initDeleteAccount();
  checkAuth();
}

document.addEventListener('DOMContentLoaded', init);
