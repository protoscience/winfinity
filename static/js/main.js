// ============================================================
// StockView Pro — main.js
// ============================================================

const API = '';
const STORAGE_KEY = 'winfinity_finnhub_key';

// STOCK_GROUPS is now loaded from the DB via /api/lists
// keyed by list id, value = { id, name, symbols[] }
let DB_LISTS = [];   // array from /api/lists

// Build a STOCK_GROUPS-compatible map from DB_LISTS
function buildGroupMap() {
  const map = {};
  DB_LISTS.forEach(l => { map[l.name] = l.symbols; });
  return map;
}

const GH_TOKEN_KEY  = 'winfinity_gh_token';
const GH_REPO_KEY   = 'winfinity_gh_repo';
const GH_BRANCH_KEY = 'winfinity_gh_branch';
const GH_PATH_KEY   = 'winfinity_gh_path';

function getFinnhubKey() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

function apiFetch(url, opts = {}) {
  const key = getFinnhubKey();
  if (key) {
    opts.headers = Object.assign({}, opts.headers || {}, { 'X-Finnhub-Key': key });
  }
  return fetch(url, opts).then(r => r.json());
}

let currentSymbol = 'SPY';
let allStocks = [];
// groupStocks[groupName] = array of stock objects (or null = not yet loaded)
const groupStocks = {};
// which groups are expanded
const groupExpanded = {};
let mainChart = null, rsiChart = null, macdChart = null;
let spyMiniChart = null, vixMiniChart = null;
let candleSeries = null, volumeSeries = null;
let rsiSeries = null, rsiOB = null, rsiOS = null;
let macdLineSeries = null, macdSignalSeries = null, macdHistSeries = null;
let ripsterSeries = {};
let bbSeries = {};
let ripsterCloudCanvas = null;
let predictionSeries = null;
let _lastIndicatorData = null;
let _lastPredictionData = null;

// ============================================================
// Bootstrap
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  loadMarketOverview();
  loadStockList();
  loadSpyChart();
  loadVixChart();
  loadMarketInfluence();
  loadMarketNews();

  // Period buttons
  document.querySelectorAll('.btn-tab[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-tab[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadChartData(currentSymbol);
    });
  });

  // Indicator toggles
  document.getElementById('toggle-prediction').addEventListener('change', () => {
    if (_lastPredictionData) renderPredictionOverlay(_lastPredictionData);
  });
  document.getElementById('toggle-ripster').addEventListener('change', () => {
    if (_lastIndicatorData) renderOverlays(_lastIndicatorData);
  });
  document.getElementById('toggle-bb').addEventListener('change', () => {
    if (_lastIndicatorData) renderOverlays(_lastIndicatorData);
  });

  // SPY/VIX tabs
  document.querySelectorAll('.card-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      document.querySelectorAll('.card-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.card-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(target).classList.add('active');
      setTimeout(() => {
        const spyEl = document.getElementById('spy-mini-chart');
        const vixEl = document.getElementById('vix-mini-chart');
        if (spyMiniChart) spyMiniChart.applyOptions({ width: spyEl.clientWidth });
        if (vixMiniChart) vixMiniChart.applyOptions({ width: vixEl.clientWidth });
      }, 50);
    });
  });

  // Market influence tabs
  document.querySelectorAll('.inf-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.inf-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.inf-panel').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
      btn.classList.add('active');
      const panel = document.getElementById(`${tab}-tab`);
      panel.style.display = 'block';
      panel.classList.add('active');
    });
  });

  // News tabs
  document.querySelectorAll('.news-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      document.querySelectorAll('.news-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.news-panel').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
      btn.classList.add('active');
      const panel = document.getElementById(target);
      panel.style.display = 'grid';
      panel.classList.add('active');
    });
  });

  // Search
  document.getElementById('stock-search').addEventListener('input', e => {
    const q = e.target.value.trim().toUpperCase();
    if (!q) { renderGroupSidebar(); return; }
    renderGroupSidebar(q);       // instant results from loaded stocks
    debouncedSearchFetch(q);     // then fetch from API in case it's not loaded yet
  });

  // Stock detail modal close
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('detail-modal').classList.add('hidden');
  });

  // Settings modal
  const settingsModal = document.getElementById('settings-modal');
  const keyInput = document.getElementById('finnhub-key-input');
  const keyStatus = document.getElementById('key-status');

  document.getElementById('settings-btn').addEventListener('click', () => {
    keyInput.value = getFinnhubKey();
    keyStatus.textContent = getFinnhubKey() ? 'Key loaded from storage.' : 'No key saved yet.';
    settingsModal.classList.remove('hidden');
  });
  document.getElementById('settings-modal-close').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });
  document.getElementById('show-key-toggle').addEventListener('change', e => {
    keyInput.type = e.target.checked ? 'text' : 'password';
  });
  document.getElementById('save-key-btn').addEventListener('click', () => {
    const val = keyInput.value.trim();
    if (val) {
      localStorage.setItem(STORAGE_KEY, val);
      keyStatus.textContent = 'Key saved. Reloading data…';
      keyStatus.style.color = '#26a69a';
      setTimeout(() => {
        settingsModal.classList.add('hidden');
        loadMarketOverview();
        loadStockList();
        loadMarketNews();
        loadMarketInfluence();
        loadChartData(currentSymbol);
      }, 600);
    } else {
      keyStatus.textContent = 'Please enter a valid key.';
      keyStatus.style.color = '#ef5350';
    }
  });
  document.getElementById('clear-key-btn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    keyInput.value = '';
    keyStatus.textContent = 'Key cleared.';
    keyStatus.style.color = '#787b86';
  });

  // Manage Lists modal
  document.getElementById('manage-lists-btn').addEventListener('click', openManageModal);
  document.getElementById('manage-modal-close').addEventListener('click', () =>
    document.getElementById('manage-modal').classList.add('hidden'));
  document.getElementById('manage-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('manage-modal'))
      document.getElementById('manage-modal').classList.add('hidden');
  });

  // Manage modal tabs
  document.querySelectorAll('.manage-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.manage-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.manage-tab-panel').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
      btn.classList.add('active');
      const panel = document.getElementById(btn.dataset.tab);
      panel.style.display = 'block';
      panel.classList.add('active');
      if (btn.dataset.tab === 'github-tab') loadGhSettingsToForm();
    });
  });

  // Auto-refresh
  setInterval(loadMarketOverview, 60000);
  setInterval(refreshOpenGroups, 120000);
  setInterval(() => loadChartData(currentSymbol), 300000);
});

// ============================================================
// Manage Lists
// ============================================================
let editingListId = null;

async function openManageModal() {
  // Reset to SQLite tab
  document.querySelectorAll('.manage-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.manage-tab-panel').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  document.querySelector('.manage-tab[data-tab="sqlite-tab"]').classList.add('active');
  const sqlitePanel = document.getElementById('sqlite-tab');
  sqlitePanel.style.display = 'block';
  sqlitePanel.classList.add('active');

  document.getElementById('manage-modal').classList.remove('hidden');
  await renderManageLists();
}

async function renderManageLists() {
  const container = document.getElementById('manage-lists-container');
  container.innerHTML = '<div class="group-loading">Loading lists from SQLite…</div>';
  try {
    DB_LISTS = await apiFetch(`${API}/api/lists`);
  } catch(e) {
    container.innerHTML = `<div class="ml-error">Could not load lists: ${e.message}</div>`;
    return;
  }

  // DB info bar
  const pathEl = document.getElementById('sqlite-db-path');
  const countEl = document.getElementById('sqlite-list-count');
  if (pathEl) pathEl.textContent = 'winfinity.db';
  if (countEl) countEl.textContent = `${DB_LISTS.length} lists · ${DB_LISTS.reduce((a,l) => a + l.symbols.length, 0)} stocks`;
  container.innerHTML = DB_LISTS.map(lst => `
    <div class="ml-row" id="ml-row-${lst.id}">
      <div class="ml-row-header">
        <span class="ml-row-name">${escapeHtml(lst.name)}</span>
        <span class="ml-row-count">${lst.symbols.length} stocks</span>
        <div class="ml-row-actions">
          <button class="ml-btn" onclick="editList(${lst.id})" title="Edit stocks">&#9998;</button>
          <button class="ml-btn ml-btn-danger" onclick="deleteList(${lst.id}, '${escapeHtml(lst.name)}')" title="Delete list">&#x2715;</button>
        </div>
      </div>
      <div class="ml-edit-panel hidden" id="ml-edit-${lst.id}">
        <div class="ml-symbols" id="ml-symbols-${lst.id}">
          ${lst.symbols.map(sym => `
            <span class="ml-chip">
              ${escapeHtml(sym)}
              <button onclick="removeStockFromList(${lst.id}, '${sym}')" title="Remove">&times;</button>
            </span>`).join('')}
        </div>
        <div class="ml-add-row">
          <input type="text" id="ml-add-input-${lst.id}" placeholder="Add symbol (e.g. AAPL)" maxlength="10"
            onkeydown="if(event.key==='Enter') addStockToList(${lst.id})" />
          <button class="ml-btn ml-btn-add" onclick="addStockToList(${lst.id})">Add</button>
        </div>
      </div>
    </div>`).join('');
}

function editList(listId) {
  const panel = document.getElementById(`ml-edit-${listId}`);
  if (!panel) return;
  const isOpen = !panel.classList.contains('hidden');
  // Close all other edit panels
  document.querySelectorAll('.ml-edit-panel').forEach(p => p.classList.add('hidden'));
  if (!isOpen) panel.classList.remove('hidden');
}

async function deleteList(listId, name) {
  if (!confirm(`Delete list "${name}"?`)) return;
  await apiFetch(`${API}/api/lists/${listId}`, { method: 'DELETE' });
  delete groupStocks[name];
  delete groupExpanded[name];
  await renderManageLists();
  await reloadSidebar();
}

async function addStockToList(listId) {
  const input = document.getElementById(`ml-add-input-${listId}`);
  const symbol = (input.value || '').trim().toUpperCase();
  if (!symbol) return;
  input.value = '';
  await apiFetch(`${API}/api/lists/${listId}/stocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  });
  await renderManageLists();
  document.getElementById(`ml-edit-${listId}`)?.classList.remove('hidden');
  clearGroupCache();
  reloadSidebar();
}

async function removeStockFromList(listId, symbol) {
  await apiFetch(`${API}/api/lists/${listId}/stocks/${symbol}`, { method: 'DELETE' });
  await renderManageLists();
  document.getElementById(`ml-edit-${listId}`)?.classList.remove('hidden');
  clearGroupCache();
  reloadSidebar();
}

async function createNewList() {
  const input = document.getElementById('ml-new-list-input');
  const name = (input.value || '').trim();
  if (!name) return;
  input.value = '';
  await apiFetch(`${API}/api/lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  // Auto-expand the new list in the sidebar
  groupExpanded[name] = true;
  groupStocks[name] = [];   // empty but loaded — won't show "Loading…"
  await renderManageLists();
  reloadSidebar();
}

function clearGroupCache() {
  Object.keys(groupStocks).forEach(k => delete groupStocks[k]);
}

async function reloadSidebar() {
  DB_LISTS = await apiFetch(`${API}/api/lists`);
  renderGroupSidebar();
  for (const [name, expanded] of Object.entries(groupExpanded)) {
    if (expanded) await loadGroupStocks(name);
  }
}

// ============================================================
// GitHub Sync
// ============================================================
function getGhSettings() {
  return {
    token:  localStorage.getItem(GH_TOKEN_KEY)  || '',
    repo:   localStorage.getItem(GH_REPO_KEY)   || '',
    branch: localStorage.getItem(GH_BRANCH_KEY) || 'main',
    path:   localStorage.getItem(GH_PATH_KEY)   || 'winfinity-lists.json',
  };
}

function saveGhSettings() {
  localStorage.setItem(GH_TOKEN_KEY,  document.getElementById('gh-token').value.trim());
  localStorage.setItem(GH_REPO_KEY,   document.getElementById('gh-repo').value.trim());
  localStorage.setItem(GH_BRANCH_KEY, document.getElementById('gh-branch').value.trim() || 'main');
  localStorage.setItem(GH_PATH_KEY,   document.getElementById('gh-path').value.trim() || 'winfinity-lists.json');
}

function loadGhSettingsToForm() {
  const s = getGhSettings();
  document.getElementById('gh-token').value  = s.token;
  document.getElementById('gh-repo').value   = s.repo;
  document.getElementById('gh-branch').value = s.branch;
  document.getElementById('gh-path').value   = s.path;
}

async function githubPush() {
  saveGhSettings();
  const s = getGhSettings();
  const statusEl = document.getElementById('gh-status');
  statusEl.textContent = 'Pushing…';
  statusEl.style.color = '#787b86';
  try {
    const res = await apiFetch(`${API}/api/github/push`, {
      method: 'POST',
      headers: {
        'X-Github-Token':  s.token,
        'X-Github-Repo':   s.repo,
        'X-Github-Branch': s.branch,
        'X-Github-Path':   s.path,
      },
    });
    if (res.ok) {
      statusEl.textContent = 'Pushed successfully.';
      statusEl.style.color = '#26a69a';
    } else {
      statusEl.textContent = `Error: ${res.error}`;
      statusEl.style.color = '#ef5350';
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.style.color = '#ef5350';
  }
}

async function githubPull() {
  saveGhSettings();
  const s = getGhSettings();
  const statusEl = document.getElementById('gh-status');
  statusEl.textContent = 'Pulling…';
  statusEl.style.color = '#787b86';
  try {
    const res = await apiFetch(`${API}/api/github/pull`, {
      method: 'POST',
      headers: {
        'X-Github-Token':  s.token,
        'X-Github-Repo':   s.repo,
        'X-Github-Branch': s.branch,
        'X-Github-Path':   s.path,
      },
    });
    if (res.ok) {
      statusEl.textContent = `Pulled ${res.lists?.length || 0} lists.`;
      statusEl.style.color = '#26a69a';
      clearGroupCache();
      Object.keys(groupExpanded).forEach(k => delete groupExpanded[k]);
      await reloadSidebar();
      await renderManageLists();
    } else {
      statusEl.textContent = `Error: ${res.error}`;
      statusEl.style.color = '#ef5350';
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.style.color = '#ef5350';
  }
}

// ============================================================
// Chart Init
// ============================================================
function makeChartOpts(height, el) {
  return {
    layout: { background: { color: '#131722' }, textColor: '#787b86' },
    grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
    width: el.clientWidth,
    height,
    handleScroll: true,
    handleScale: true,
  };
}

function initCharts() {
  const mainEl = document.getElementById('main-chart-container');
  mainChart = LightweightCharts.createChart(mainEl, makeChartOpts(380, mainEl));

  candleSeries = mainChart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });

  volumeSeries = mainChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.85, bottom: 0 },
  });
  mainChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, borderVisible: false });

  // RSI
  const rsiEl = document.getElementById('rsi-chart-container');
  rsiChart = LightweightCharts.createChart(rsiEl, makeChartOpts(100, rsiEl));
  rsiSeries = rsiChart.addLineSeries({ color: '#7b61ff', lineWidth: 1.5, priceLineVisible: false });
  rsiOB = rsiChart.addLineSeries({ color: 'rgba(239,83,80,0.6)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
  rsiOS = rsiChart.addLineSeries({ color: 'rgba(38,166,154,0.6)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });

  // MACD
  const macdEl = document.getElementById('macd-chart-container');
  macdChart = LightweightCharts.createChart(macdEl, makeChartOpts(100, macdEl));
  macdLineSeries = macdChart.addLineSeries({ color: '#2962ff', lineWidth: 1.5, priceLineVisible: false });
  macdSignalSeries = macdChart.addLineSeries({ color: '#ff6d00', lineWidth: 1.5, priceLineVisible: false });
  macdHistSeries = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });

  // Sync timescales
  [mainChart, rsiChart, macdChart].forEach(src => {
    src.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!range) return;
      [mainChart, rsiChart, macdChart].filter(c => c !== src)
        .forEach(c => c.timeScale().setVisibleLogicalRange(range));
    });
  });

  // SPY mini
  const spyEl = document.getElementById('spy-mini-chart');
  spyMiniChart = LightweightCharts.createChart(spyEl, makeChartOpts(180, spyEl));

  // VIX mini
  const vixEl = document.getElementById('vix-mini-chart');
  vixMiniChart = LightweightCharts.createChart(vixEl, makeChartOpts(180, vixEl));

  // Resize observer
  const ro = new ResizeObserver(() => {
    mainChart.applyOptions({ width: mainEl.clientWidth });
    rsiChart.applyOptions({ width: rsiEl.clientWidth });
    macdChart.applyOptions({ width: macdEl.clientWidth });
  });
  [mainEl, rsiEl, macdEl].forEach(el => ro.observe(el));

  loadChartData(currentSymbol);
}

// ============================================================
// Load Chart Data
// ============================================================
function getSelectedPeriod() {
  const active = document.querySelector('.btn-tab[data-period].active');
  return active ? active.dataset.period : '6mo';
}

async function loadChartData(symbol) {
  currentSymbol = symbol;
  document.getElementById('selected-symbol').textContent = symbol;
  const period = getSelectedPeriod();

  try {
    const [candles, indicators, prediction] = await Promise.all([
      apiFetch(`${API}/api/chart/${symbol}?period=${period}`),
      apiFetch(`${API}/api/indicators/${symbol}`),
      apiFetch(`${API}/api/prediction/${symbol}`),
    ]);

    renderCandles(candles);
    _lastIndicatorData = indicators;
    renderIndicators(indicators);
    _lastPredictionData = prediction;
    renderPrediction(prediction, symbol);
    loadCompanyNews(symbol);

    const stock = allStocks.find(s => s.symbol === symbol);
    if (stock) updateChartHeader(stock);
  } catch (err) {
    console.error('loadChartData:', err);
  }
}

function renderCandles(data) {
  if (!Array.isArray(data) || !data.length) return;
  candleSeries.setData(data.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));
  volumeSeries.setData(data.map(d => ({
    time: d.time, value: d.volume,
    color: d.close >= d.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
  })));
  mainChart.timeScale().fitContent();
}

function renderIndicators(data) {
  if (!data || data.error) return;

  if (data.rsi && data.rsi.length) {
    rsiSeries.setData(data.rsi);
    const t0 = data.rsi[0].time;
    const t1 = data.rsi[data.rsi.length - 1].time;
    rsiOB.setData([{ time: t0, value: 70 }, { time: t1, value: 70 }]);
    rsiOS.setData([{ time: t0, value: 30 }, { time: t1, value: 30 }]);
    rsiChart.timeScale().fitContent();
  }

  if (data.macd) {
    if (data.macd.macd) macdLineSeries.setData(data.macd.macd);
    if (data.macd.signal) macdSignalSeries.setData(data.macd.signal);
    if (data.macd.histogram) {
      macdHistSeries.setData(data.macd.histogram.map(d => ({
        ...d, color: d.value >= 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)',
      })));
    }
    macdChart.timeScale().fitContent();
  }

  renderOverlays(data);
}

function renderOverlays(data) {
  // Clear existing overlays
  Object.values(ripsterSeries).forEach(s => { try { mainChart.removeSeries(s); } catch(e) {} });
  ripsterSeries = {};
  Object.values(bbSeries).forEach(s => { try { mainChart.removeSeries(s); } catch(e) {} });
  bbSeries = {};
  removeRipsterCanvas();

  const showRipster = document.getElementById('toggle-ripster').checked;
  const showBB = document.getElementById('toggle-bb').checked;

  if (showRipster && data.ripster) {
    const r = data.ripster;
    // Fast cloud lines (EMA 8 & 9)
    ripsterSeries.ema8  = addEmaLine(r.ema8,  'rgba(38,166,154,0.9)', 1);
    ripsterSeries.ema9  = addEmaLine(r.ema9,  'rgba(38,166,154,0.9)', 1);
    // Slow cloud lines (EMA 34 & 39)
    ripsterSeries.ema34 = addEmaLine(r.ema34, 'rgba(41,98,255,0.8)', 1.5);
    ripsterSeries.ema39 = addEmaLine(r.ema39, 'rgba(100,140,255,0.8)', 1.5);
    // Trend filter EMA 200
    ripsterSeries.ema200 = addEmaLine(r.ema200, 'rgba(249,168,37,0.9)', 2);
    // Signal lines EMA 5 & 13
    ripsterSeries.ema5  = addEmaLine(r.ema5,  'rgba(255,255,255,0.35)', 1);
    ripsterSeries.ema13 = addEmaLine(r.ema13, 'rgba(200,200,200,0.35)', 1);

    // Draw filled cloud bands via canvas overlay
    drawRipsterCloud(r);
  }

  if (showBB && data.bollinger) {
    const bb = data.bollinger;
    bbSeries.upper = addEmaLine(bb.upper, 'rgba(156,39,176,0.7)', 1);
    bbSeries.mid   = addEmaLine(bb.mid,   'rgba(156,39,176,0.5)', 1, LightweightCharts.LineStyle.Dashed);
    bbSeries.lower = addEmaLine(bb.lower, 'rgba(156,39,176,0.7)', 1);
  }
}

// ============================================================
// Ripster EMA Cloud — canvas fill between EMA pairs
// ============================================================
function removeRipsterCanvas() {
  if (ripsterCloudCanvas) {
    ripsterCloudCanvas.remove();
    ripsterCloudCanvas = null;
  }
}

function drawRipsterCloud(ripster) {
  const container = document.getElementById('main-chart-container');
  removeRipsterCanvas();

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1';
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
  container.style.position = 'relative';
  container.appendChild(canvas);
  ripsterCloudCanvas = canvas;

  function redraw() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fast cloud: EMA8 vs EMA9 (teal when 8>9, red when 9>8)
    paintBand(ctx, ripster.ema8, ripster.ema9,
      'rgba(38,166,154,0.18)', 'rgba(239,83,80,0.18)');

    // Slow cloud: EMA34 vs EMA39 (blue when 34>39, purple when 39>34)
    paintBand(ctx, ripster.ema34, ripster.ema39,
      'rgba(41,98,255,0.15)', 'rgba(156,39,176,0.15)');
  }

  function paintBand(ctx, upper, lower, colorAbove, colorBelow) {
    // Build a merged time map
    const mapA = new Map(upper.map(d => [d.time, d.value]));
    const mapB = new Map(lower.map(d => [d.time, d.value]));
    const times = [...new Set([...mapA.keys(), ...mapB.keys()])].sort((a, b) => a - b);

    // Convert each time → x pixel; each price → y pixel using chart coordinate system
    const pts = [];
    for (const t of times) {
      const va = mapA.get(t);
      const vb = mapB.get(t);
      if (va == null || vb == null) continue;
      try {
        const x  = mainChart.timeScale().timeToCoordinate(t);
        const ya = ripsterSeries.ema8  ? ripsterSeries.ema8.priceToCoordinate(va)  : null;
        const yb = ripsterSeries.ema9  ? ripsterSeries.ema9.priceToCoordinate(vb)  : null;
        if (x == null || ya == null || yb == null) continue;
        pts.push({ x, ya, yb });
      } catch (e) { /* skip */ }
    }
    if (pts.length < 2) return;

    // Walk through points, splitting into segments where upper/lower swap
    let i = 0;
    while (i < pts.length - 1) {
      const seg = [];
      const isAbove = pts[i].ya <= pts[i].yb; // ya above yb in screen coords (y flipped)
      seg.push(pts[i]);
      let j = i + 1;
      while (j < pts.length) {
        seg.push(pts[j]);
        const nowAbove = pts[j].ya <= pts[j].yb;
        if (nowAbove !== isAbove) break;
        j++;
      }
      if (seg.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].ya);
        for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k].x, seg[k].ya);
        for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].yb);
        ctx.closePath();
        ctx.fillStyle = isAbove ? colorAbove : colorBelow;
        ctx.fill();
      }
      i = j;
    }
  }

  // Use ema8/ema9 series coordinates for fast cloud, ema34/ema39 for slow
  function paintBandSlow(ctx, upper, lower, colorAbove, colorBelow) {
    const mapA = new Map(upper.map(d => [d.time, d.value]));
    const mapB = new Map(lower.map(d => [d.time, d.value]));
    const times = [...new Set([...mapA.keys(), ...mapB.keys()])].sort((a, b) => a - b);
    const pts = [];
    for (const t of times) {
      const va = mapA.get(t);
      const vb = mapB.get(t);
      if (va == null || vb == null) continue;
      try {
        const x  = mainChart.timeScale().timeToCoordinate(t);
        const ya = ripsterSeries.ema34 ? ripsterSeries.ema34.priceToCoordinate(va) : null;
        const yb = ripsterSeries.ema39 ? ripsterSeries.ema39.priceToCoordinate(vb) : null;
        if (x == null || ya == null || yb == null) continue;
        pts.push({ x, ya, yb });
      } catch (e) { /* skip */ }
    }
    if (pts.length < 2) return;
    let i = 0;
    while (i < pts.length - 1) {
      const seg = [];
      const isAbove = pts[i].ya <= pts[i].yb;
      seg.push(pts[i]);
      let j = i + 1;
      while (j < pts.length) {
        seg.push(pts[j]);
        if ((pts[j].ya <= pts[j].yb) !== isAbove) break;
        j++;
      }
      if (seg.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].ya);
        for (let k = 1; k < seg.length; k++) ctx.lineTo(seg[k].x, seg[k].ya);
        for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].yb);
        ctx.closePath();
        ctx.fillStyle = isAbove ? colorAbove : colorBelow;
        ctx.fill();
      }
      i = j;
    }
  }

  // Override redraw to use correct series for each band
  function redrawFull() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintBand(ctx, ripster.ema8,  ripster.ema9,  'rgba(38,166,154,0.18)', 'rgba(239,83,80,0.18)');
    paintBandSlow(ctx, ripster.ema34, ripster.ema39, 'rgba(41,98,255,0.15)', 'rgba(156,39,176,0.15)');
  }

  // Redraw on any chart interaction
  mainChart.timeScale().subscribeVisibleTimeRangeChange(redrawFull);
  mainChart.subscribeCrosshairMove(redrawFull);

  // Resize canvas when container resizes
  const ro = new ResizeObserver(() => {
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
    redrawFull();
  });
  ro.observe(container);

  // Initial draw (after a tick so series coords are ready)
  setTimeout(redrawFull, 50);
}

function addEmaLine(data, color, width, lineStyle) {
  const opts = { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  if (lineStyle !== undefined) opts.lineStyle = lineStyle;
  const s = mainChart.addLineSeries(opts);
  if (data && data.length) s.setData(data);
  return s;
}

// ============================================================
// Market Overview
// ============================================================
async function loadMarketOverview() {
  try {
    const data = await apiFetch(`${API}/api/market-overview`);
    const idMap = { 'SPY': 'idx-spy', '^VIX': 'idx-vix', '^GSPC': 'idx-gspc', '^IXIC': 'idx-ixic', '^DJI': 'idx-dji' };
    const labels = { 'SPY': 'SPY', '^VIX': 'VIX', '^GSPC': 'S&P500', '^IXIC': 'NDX', '^DJI': 'DOW' };
    for (const [sym, elId] of Object.entries(idMap)) {
      const el = document.getElementById(elId);
      const d = data[sym];
      if (!el || !d) continue;
      const sign = d.change_pct >= 0 ? '+' : '';
      const cls = d.change_pct >= 0 ? 'positive' : 'negative';
      el.innerHTML = `<span style="color:#787b86">${labels[sym]}</span> <strong>${fmtPrice(d.price)}</strong> <span class="${cls}">${sign}${d.change_pct.toFixed(2)}%</span>`;
    }
    document.getElementById('last-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) { console.error('market overview:', e); }
}

// ============================================================
// Stock List — grouped sidebar
// ============================================================
async function loadStockList() {
  try {
    DB_LISTS = await apiFetch(`${API}/api/lists`);
  } catch(e) { console.error('loadStockList:', e); return; }

  const firstGroup = DB_LISTS[0]?.name;
  if (firstGroup && !(firstGroup in groupExpanded)) {
    groupExpanded[firstGroup] = true;
  }
  renderGroupSidebar();
  for (const [name, expanded] of Object.entries(groupExpanded)) {
    if (expanded && !groupStocks[name]) {
      await loadGroupStocks(name);
    }
  }
}

async function loadGroupStocks(groupName) {
  const grp = DB_LISTS.find(l => l.name === groupName);
  const symbols = grp ? grp.symbols : buildGroupMap()[groupName];
  // Empty list: mark as loaded with empty array so it stops showing "Loading…"
  if (!symbols || !symbols.length) {
    groupStocks[groupName] = [];
    renderGroupSidebar();
    return;
  }
  try {
    const data = await apiFetch(`${API}/api/stocks?symbols=${symbols.join(',')}`);
    groupStocks[groupName] = data.filter(d => !d.error);
    const map = new Map(allStocks.map(s => [s.symbol, s]));
    groupStocks[groupName].forEach(s => map.set(s.symbol, s));
    allStocks = [...map.values()];
    renderGroupSidebar();
  } catch (e) { console.error('loadGroupStocks:', e); }
}

let _searchDebounceTimer = null;
function debouncedSearchFetch(q) {
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(async () => {
    // Only fetch if query looks like a ticker (1-6 uppercase letters/numbers)
    if (!/^[A-Z0-9.\-^]{1,10}$/.test(q)) return;
    // Skip if already loaded
    if (allStocks.some(s => s.symbol === q)) return;
    try {
      const data = await apiFetch(`${API}/api/stocks?symbols=${encodeURIComponent(q)}`);
      const valid = data.filter(d => !d.error && d.price > 0);
      if (!valid.length) return;
      // Merge into allStocks
      const map = new Map(allStocks.map(s => [s.symbol, s]));
      valid.forEach(s => map.set(s.symbol, s));
      allStocks = [...map.values()];
      // Re-render only if still searching same query
      const current = document.getElementById('stock-search').value.trim().toUpperCase();
      if (current === q) renderGroupSidebar(q);
    } catch(e) { /* silent */ }
  }, 400);
}

function renderGroupSidebar(searchQuery) {
  const listEl = document.getElementById('stock-list');

  if (searchQuery) {
    const q = searchQuery.toUpperCase();
    const hits = allStocks.filter(s => s.symbol.includes(q) || (s.name || '').toUpperCase().includes(q));
    listEl.innerHTML = hits.length
      ? hits.map(s => stockItemHtml(s)).join('')
      : `<div class="search-empty">
           <div>No results for <strong>${escapeHtml(q)}</strong></div>
           <div style="font-size:10px;margin-top:4px;color:#4a4e5a">Fetching from market…</div>
         </div>`;
    return;
  }

  listEl.innerHTML = DB_LISTS.map(lst => {
    const groupName = lst.name;
    const expanded  = !!groupExpanded[groupName];
    const stocks    = groupStocks[groupName];
    const arrow     = expanded ? '&#9660;' : '&#9654;';
    const loading   = expanded && !stocks ? '<div class="group-loading">Loading…</div>' : '';
    const rows      = expanded && stocks ? stocks.map(s => stockItemHtml(s)).join('') : '';
    return `
      <div class="group-header" onclick="toggleGroup('${escapeHtml(groupName)}')">
        <span class="group-arrow">${arrow}</span>
        <span class="group-name">${escapeHtml(groupName)}</span>
        <span class="group-count">${lst.symbols.length}</span>
      </div>
      <div class="group-body${expanded ? '' : ' collapsed'}">${loading}${rows}</div>`;
  }).join('');
}

function toggleGroup(groupName) {
  groupExpanded[groupName] = !groupExpanded[groupName];
  renderGroupSidebar();
  if (groupExpanded[groupName] && !groupStocks[groupName]) {
    loadGroupStocks(groupName);
  }
}

async function refreshOpenGroups() {
  for (const [name, expanded] of Object.entries(groupExpanded)) {
    if (expanded) {
      delete groupStocks[name]; // clear cache to force re-fetch
      await loadGroupStocks(name);
    }
  }
}

function stockItemHtml(s) {
  const chgCls = s.change_pct > 0 ? 'positive' : s.change_pct < 0 ? 'negative' : 'neutral';
  const sign   = s.change_pct > 0 ? '+' : '';
  const active = s.symbol === currentSymbol ? ' active' : '';
  return `
    <div class="stock-item${active}" onclick="selectStock('${s.symbol}')">
      <div class="si-left">
        <span class="si-sym">${s.symbol}</span>
        <span class="si-name">${escapeHtml(s.name || '')}</span>
        ${s.pe ? `<span class="si-pe">P/E ${s.pe}</span>` : ''}
      </div>
      <div class="si-right">
        <span class="si-price ${chgCls}">$${fmtPrice(s.price)}</span>
        <span class="si-chg ${chgCls}">${sign}${s.change_pct.toFixed(2)}%</span>
      </div>
    </div>`;
}

function selectStock(symbol) {
  currentSymbol = symbol;
  // Re-render sidebar so the active state updates in-place
  const searchVal = document.getElementById('stock-search').value.trim();
  if (searchVal) {
    renderGroupSidebar(searchVal.toUpperCase());
  } else {
    renderGroupSidebar();
  }
  loadChartData(symbol);
}

function updateChartHeader(stock) {
  document.getElementById('selected-name').textContent = stock.name || '';
  const priceEl = document.getElementById('selected-price');
  const chgEl = document.getElementById('selected-change');
  priceEl.textContent = `$${fmtPrice(stock.price)}`;
  priceEl.className = `price-badge ${stock.change_pct >= 0 ? 'positive' : 'negative'}`;
  const sign = stock.change_pct >= 0 ? '+' : '';
  chgEl.textContent = `${sign}${stock.change_pct.toFixed(2)}%`;
  chgEl.className = `change-badge ${stock.change_pct >= 0 ? 'pos' : 'neg'}`;
}

// ============================================================
// SPY & VIX Mini Charts
// ============================================================
async function loadSpyChart() {
  try {
    const data = await apiFetch(`${API}/api/spy-chart`);
    if (!data.candles || !data.candles.length) return;

    const cs = spyMiniChart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    cs.setData(data.candles);

    if (data.indicators && data.indicators.rsi && data.indicators.rsi.length) {
      const rsiL = spyMiniChart.addLineSeries({
        color: '#7b61ff', lineWidth: 1, priceLineVisible: false,
        priceScaleId: 'rsi_spy',
      });
      spyMiniChart.priceScale('rsi_spy').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false });
      rsiL.setData(data.indicators.rsi);
    }

    spyMiniChart.timeScale().fitContent();
  } catch (e) { console.error('spy chart:', e); }
}

async function loadVixChart() {
  try {
    const data = await apiFetch(`${API}/api/vix-chart`);
    if (!data.series || !data.series.length) return;

    const areaSer = vixMiniChart.addAreaSeries({
      lineColor: '#ff6d00',
      topColor: 'rgba(255,109,0,0.3)',
      bottomColor: 'rgba(255,109,0,0.0)',
      lineWidth: 2,
      priceLineVisible: false,
    });
    areaSer.setData(data.series);

    // VIX 20 fear line
    const refLine = vixMiniChart.addLineSeries({
      color: 'rgba(239,83,80,0.7)', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    });
    refLine.setData([
      { time: data.series[0].time, value: 20 },
      { time: data.series[data.series.length - 1].time, value: 20 },
    ]);

    vixMiniChart.timeScale().fitContent();
  } catch (e) { console.error('vix chart:', e); }
}

// ============================================================
// Prediction Panel
// ============================================================
function renderPrediction(data, symbol) {
  const el = document.getElementById('prediction-content');
  if (!data || data.error) {
    el.innerHTML = '<div class="prediction-loading">No prediction data</div>';
    return;
  }
  renderPredictionOverlay(data);
  renderPredictionPanel(data, el);
}

function renderPredictionOverlay(data) {
  if (predictionSeries) {
    try { mainChart.removeSeries(predictionSeries); } catch(e) {}
    predictionSeries = null;
  }
  const show = document.getElementById('toggle-prediction').checked;
  if (show && data.prediction_series && data.prediction_series.length) {
    predictionSeries = mainChart.addLineSeries({
      color: 'rgba(249,168,37,0.9)',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false,
    });
    predictionSeries.setData(data.prediction_series);
  }
}

function renderPredictionPanel(data, el) {
  const weeks = (data.weekly_targets || []).map(w => {
    const cls = w.change_pct >= 0 ? 'positive' : 'negative';
    const sign = w.change_pct >= 0 ? '+' : '';
    return `
      <div class="pred-week">
        <div class="pw-label">Week ${w.week}</div>
        <div class="pw-price ${cls}">$${fmtPrice(w.price)}</div>
        <div class="pw-chg ${cls}">${sign}${w.change_pct}%</div>
        <div style="font-size:9px;color:#4a4e5a">${w.date}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="pred-header">
      <span class="pred-signal signal-${data.signal}">${data.signal}</span>
      <span class="pred-current">Now: <strong>$${fmtPrice(data.current_price)}</strong></span>
      <span class="pred-current">4W: <strong class="${data.change_4w_pct >= 0 ? 'positive' : 'negative'}">${data.change_4w_pct >= 0 ? '+' : ''}${data.change_4w_pct}%</strong></span>
    </div>
    <div class="pred-targets">${weeks}</div>
    <div class="pred-range">
      <span class="range-label">Target range:</span>
      <span class="bull-val">&#9650; $${fmtPrice(data.bull_target)}</span>
      <span style="color:#4a4e5a">—</span>
      <span class="bear-val">&#9660; $${fmtPrice(data.bear_target)}</span>
    </div>`;
}

// ============================================================
// Market Influence
// ============================================================
async function loadMarketInfluence() {
  try {
    const data = await apiFetch(`${API}/api/market-influence`);

    // Sectors
    const sectorsEl = document.getElementById('sectors-tab');
    if (data.sectors && data.sectors.length) {
      const maxAbs = Math.max(...data.sectors.map(s => Math.abs(s.change_pct)), 0.01);
      sectorsEl.innerHTML = data.sectors.map(s => {
        const cls = s.change_pct >= 0 ? 'positive' : 'negative';
        const fill = s.change_pct >= 0 ? '#26a69a' : '#ef5350';
        const w = Math.round(Math.abs(s.change_pct) / maxAbs * 100);
        const sign = s.change_pct >= 0 ? '+' : '';
        return `
          <div class="sector-bar">
            <span class="sector-name">${s.name}</span>
            <div class="sector-bar-track"><div class="sector-bar-fill" style="width:${w}%;background:${fill}"></div></div>
            <span class="sector-val ${cls}">${sign}${s.change_pct.toFixed(2)}%</span>
          </div>`;
      }).join('');
    }

    // Macro
    const macroEl = document.getElementById('macro-tab');
    if (data.macro && data.macro.length) {
      macroEl.innerHTML = data.macro.map(m => {
        const cls = m.change_pct >= 0 ? 'positive' : 'negative';
        const sign = m.change_pct >= 0 ? '+' : '';
        return `
          <div class="macro-row">
            <span class="macro-name">${m.name}</span>
            <span class="macro-price">${fmtPrice(m.price)}</span>
            <span class="macro-chg ${cls}">${sign}${m.change_pct.toFixed(2)}%</span>
          </div>`;
      }).join('');
    }

    // Fear & Greed
    const fgEl = document.getElementById('fear-tab');
    const fg = data.fear_greed;
    if (fg && fg.score !== null) {
      const scoreColor = fg.score >= 75 ? '#26a69a' : fg.score >= 55 ? '#66bb6a' : fg.score >= 45 ? '#f9a825' : fg.score >= 25 ? '#ff6d00' : '#ef5350';
      fgEl.innerHTML = `
        <div class="fg-gauge">
          <div class="fg-bar" style="margin:0 8px">
            <div class="fg-needle" style="left:${fg.score}%"></div>
          </div>
          <div class="fg-score-big" style="color:${scoreColor}">${fg.score}</div>
          <div class="fg-label-big" style="color:${scoreColor}">${fg.label}</div>
          <div class="fg-vix">VIX: ${fg.vix}</div>
        </div>`;
    }
  } catch (e) { console.error('market influence:', e); }
}

// ============================================================
// News
// ============================================================
async function loadMarketNews() {
  try {
    const news = await apiFetch(`${API}/api/news`);
    document.getElementById('market-news').innerHTML = renderNewsCards(news);
  } catch (e) { console.error('news:', e); }
}

async function loadCompanyNews(symbol) {
  try {
    const news = await apiFetch(`${API}/api/company-news/${symbol}`);
    document.getElementById('stock-news').innerHTML = renderNewsCards(news);
  } catch (e) { console.error('company news:', e); }
}

function renderNewsCards(news) {
  if (!Array.isArray(news) || !news.length) return '<div style="color:#787b86;font-size:12px;padding:8px">No news available</div>';
  return news.map(n => {
    const url = n.url || '#';
    const time = n.datetime ? new Date(n.datetime * 1000).toLocaleDateString() : '';
    return `
      <a class="news-card" href="${url}" target="_blank" rel="noopener noreferrer">
        <div class="news-source">${escapeHtml(n.source || 'News')}</div>
        <div class="news-headline">${escapeHtml(n.headline || '')}</div>
        ${n.summary ? `<div class="news-summary">${escapeHtml(n.summary)}</div>` : ''}
        ${time ? `<div class="news-time">${time}</div>` : ''}
      </a>`;
  }).join('');
}

// ============================================================
// Helpers
// ============================================================
function fmtPrice(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(2);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
