// ============================================================
// StockView Pro — main.js
// ============================================================

const API = '';
let currentSymbol = 'SPY';
let allStocks = [];
let mainChart = null, rsiChart = null, macdChart = null;
let spyMiniChart = null, vixMiniChart = null;
let candleSeries = null, volumeSeries = null;
let rsiSeries = null, rsiOB = null, rsiOS = null;
let macdLineSeries = null, macdSignalSeries = null, macdHistSeries = null;
let ripsterSeries = {};
let bbSeries = {};
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
    renderStockList(q ? allStocks.filter(s => s.symbol.includes(q) || (s.name || '').toUpperCase().includes(q)) : allStocks);
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('detail-modal').classList.add('hidden');
  });

  // Auto-refresh
  setInterval(loadMarketOverview, 60000);
  setInterval(loadStockList, 120000);
  setInterval(() => loadChartData(currentSymbol), 300000);
});

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
async function loadChartData(symbol) {
  currentSymbol = symbol;
  document.getElementById('selected-symbol').textContent = symbol;

  try {
    const [candles, indicators, prediction] = await Promise.all([
      fetch(`${API}/api/chart/${symbol}`).then(r => r.json()),
      fetch(`${API}/api/indicators/${symbol}`).then(r => r.json()),
      fetch(`${API}/api/prediction/${symbol}`).then(r => r.json()),
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

  const showRipster = document.getElementById('toggle-ripster').checked;
  const showBB = document.getElementById('toggle-bb').checked;

  if (showRipster && data.ripster) {
    const r = data.ripster;
    // Fast cloud (EMA 8 & 9) — tight, high alpha
    ripsterSeries.ema8 = addEmaLine(r.ema8, 'rgba(38,166,154,0.9)', 1);
    ripsterSeries.ema9 = addEmaLine(r.ema9, 'rgba(38,166,154,0.9)', 1);
    // Slow cloud (EMA 34 & 39) — trend momentum
    ripsterSeries.ema34 = addEmaLine(r.ema34, 'rgba(41,98,255,0.8)', 1.5);
    ripsterSeries.ema39 = addEmaLine(r.ema39, 'rgba(100,140,255,0.8)', 1.5);
    // Trend filter EMA 200
    ripsterSeries.ema200 = addEmaLine(r.ema200, 'rgba(249,168,37,0.9)', 2);
    // Signal lines EMA 5 & 13
    ripsterSeries.ema5 = addEmaLine(r.ema5, 'rgba(255,255,255,0.35)', 1);
    ripsterSeries.ema13 = addEmaLine(r.ema13, 'rgba(200,200,200,0.35)', 1);
  }

  if (showBB && data.bollinger) {
    const bb = data.bollinger;
    bbSeries.upper = addEmaLine(bb.upper, 'rgba(156,39,176,0.7)', 1);
    bbSeries.mid = addEmaLine(bb.mid, 'rgba(156,39,176,0.5)', 1, LightweightCharts.LineStyle.Dashed);
    bbSeries.lower = addEmaLine(bb.lower, 'rgba(156,39,176,0.7)', 1);
  }
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
    const data = await fetch(`${API}/api/market-overview`).then(r => r.json());
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
// Stock List
// ============================================================
async function loadStockList() {
  const listEl = document.getElementById('stock-list');
  if (!allStocks.length) listEl.innerHTML = '<div style="padding:12px;color:#787b86;font-size:12px">Loading…</div>';
  try {
    const data = await fetch(`${API}/api/stocks`).then(r => r.json());
    allStocks = data.filter(d => !d.error);
    renderStockList(allStocks);
  } catch (e) { console.error('stock list:', e); }
}

function renderStockList(stocks) {
  const listEl = document.getElementById('stock-list');
  if (!stocks || !stocks.length) { listEl.innerHTML = '<div style="padding:12px;color:#787b86">No stocks</div>'; return; }
  listEl.innerHTML = stocks.map(s => {
    const chgCls = s.change_pct > 0 ? 'positive' : s.change_pct < 0 ? 'negative' : 'neutral';
    const sign = s.change_pct > 0 ? '+' : '';
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
  }).join('');
}

function selectStock(symbol) {
  document.querySelectorAll('.stock-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[onclick="selectStock('${symbol}')"]`);
  if (el) el.classList.add('active');
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
    const data = await fetch(`${API}/api/spy-chart`).then(r => r.json());
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
    const data = await fetch(`${API}/api/vix-chart`).then(r => r.json());
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
    const data = await fetch(`${API}/api/market-influence`).then(r => r.json());

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
    const news = await fetch(`${API}/api/news`).then(r => r.json());
    document.getElementById('market-news').innerHTML = renderNewsCards(news);
  } catch (e) { console.error('news:', e); }
}

async function loadCompanyNews(symbol) {
  try {
    const news = await fetch(`${API}/api/company-news/${symbol}`).then(r => r.json());
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
