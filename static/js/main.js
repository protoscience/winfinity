// ============================================================
// StockView Pro — main.js
// ============================================================

const API = '';
const STORAGE_KEY        = 'winfinity_finnhub_key';
const ALP_KEY_STORAGE    = 'winfinity_alpaca_key';
const ALP_SECRET_STORAGE = 'winfinity_alpaca_secret';
const LLM_PROVIDER_KEY      = 'winfinity_llm_provider';
const LLM_MODEL_KEY         = 'winfinity_llm_model';
const LLM_KEY_STORAGE       = 'winfinity_llm_key';
const LLM_OLLAMA_URL_KEY    = 'winfinity_ollama_url';
const LLM_AUTH_METHOD_KEY   = 'winfinity_llm_auth_method';   // 'apikey' | 'oauth'
const GOOGLE_OAUTH_TOKEN_KEY  = 'winfinity_google_oauth_token';
const GOOGLE_OAUTH_EXPIRES_KEY = 'winfinity_google_oauth_expires';
const GOOGLE_CLIENT_ID_KEY  = 'winfinity_google_client_id';

// API key hints per provider
const LLM_KEY_HINTS = {
  openai:    'API key only (no OAuth) — platform.openai.com · Includes o-series reasoning models',
  anthropic: 'API key only (no OAuth) — console.anthropic.com',
  groq:      'API key only — console.groq.com · Includes DeepSeek-R1 reasoning',
  xai:       'API key only — console.x.ai',
  google:    'API key or Google Account (OAuth) — aistudio.google.com',
};

const LLM_MODELS = {
  openai: [
    // Chat models
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini',
    // Reasoning (o-series)
    'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini',
  ],
  anthropic: [
    'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
  ],
  google: [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-pro-preview', 'gemini-2.5-flash-preview',
    'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    'gemini-1.5-pro', 'gemini-1.5-flash',
  ],
  groq: [
    'llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant',
    'deepseek-r1-distill-llama-70b', 'mixtral-8x7b-32768', 'gemma2-9b-it',
  ],
  xai:    ['grok-3', 'grok-3-mini', 'grok-2-latest'],
  ollama: [
    'llama3.2:latest', 'llama3.3', 'llama3.2', 'llama3.1',
    'mistral', 'mistral-nemo',
    'phi4', 'phi3',
    'gemma3', 'gemma2',
    'deepseek-r1', 'deepseek-r1:7b',
    'qwen2.5', 'qwen2.5-coder',
  ],
};
const LLM_PROVIDER_NAMES = {
  openai: 'OpenAI', anthropic: 'Claude', google: 'Gemini',
  groq: 'Groq', xai: 'Grok', ollama: 'Ollama',
};

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
function getAlpacaKey()    { return localStorage.getItem(ALP_KEY_STORAGE)    || ''; }
function getAlpacaSecret() { return localStorage.getItem(ALP_SECRET_STORAGE) || ''; }
function getLLMProvider()   { return localStorage.getItem(LLM_PROVIDER_KEY)       || ''; }
function getLLMModel()      { return localStorage.getItem(LLM_MODEL_KEY)           || ''; }
function getLLMKey()        { return localStorage.getItem(LLM_KEY_STORAGE)         || ''; }
function getOllamaUrl()     { return localStorage.getItem(LLM_OLLAMA_URL_KEY)      || 'http://localhost:11434'; }
function getLLMAuthMethod() { return localStorage.getItem(LLM_AUTH_METHOD_KEY)     || 'apikey'; }
function getGoogleClientId(){ return localStorage.getItem(GOOGLE_CLIENT_ID_KEY)    || ''; }

function getValidGoogleOAuthToken() {
  const token   = localStorage.getItem(GOOGLE_OAUTH_TOKEN_KEY);
  const expires = parseInt(localStorage.getItem(GOOGLE_OAUTH_EXPIRES_KEY) || '0', 10);
  return (token && Date.now() < expires - 60000) ? token : null;
}

function apiFetch(url, opts = {}) {
  const fhKey   = getFinnhubKey();
  const alpKey  = getAlpacaKey();
  const alpSec  = getAlpacaSecret();
  const llmProv = getLLMProvider();
  const llmMod  = getLLMModel();
  const ollamaU = getOllamaUrl();
  const hdrs    = Object.assign({}, opts.headers || {});

  if (fhKey)   hdrs['X-Finnhub-Key']   = fhKey;
  if (alpKey)  hdrs['X-Alpaca-Key']    = alpKey;
  if (alpSec)  hdrs['X-Alpaca-Secret'] = alpSec;
  if (llmProv) hdrs['X-LLM-Provider']  = llmProv;
  if (llmMod)  hdrs['X-LLM-Model']     = llmMod;
  if (ollamaU) hdrs['X-Ollama-URL']    = ollamaU;

  // Google OAuth token takes precedence over API key for Google provider
  if (llmProv === 'google' && getLLMAuthMethod() === 'oauth') {
    const oauthToken = getValidGoogleOAuthToken();
    if (oauthToken) {
      hdrs['X-LLM-Key']       = oauthToken;
      hdrs['X-LLM-Auth-Type'] = 'oauth';
    }
  } else {
    const llmKey = getLLMKey();
    if (llmKey) hdrs['X-LLM-Key'] = llmKey;
  }

  opts.headers = hdrs;
  return fetch(url, opts).then(r => r.json());
}

// Google OAuth sign-in (called from inline onclick in index.html)
function signInWithGoogle() {
  const clientId = document.getElementById('llm-client-id').value.trim();
  const statusEl = document.getElementById('llm-oauth-status');
  if (!clientId) {
    statusEl.textContent = 'Enter your Google Client ID first.';
    statusEl.style.color = '#ef5350';
    return;
  }
  if (typeof google === 'undefined' || !google.accounts?.oauth2) {
    statusEl.textContent = 'Google Identity Services not loaded yet — try again in a moment.';
    statusEl.style.color = '#ef5350';
    return;
  }
  statusEl.textContent = 'Opening Google sign-in…';
  statusEl.style.color = '#787b86';
  const client = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/generative-language',
    callback: resp => {
      if (resp.error) {
        statusEl.textContent = 'Sign-in failed: ' + resp.error;
        statusEl.style.color = '#ef5350';
        return;
      }
      const expiresAt = Date.now() + (resp.expires_in * 1000);
      localStorage.setItem(GOOGLE_OAUTH_TOKEN_KEY,  resp.access_token);
      localStorage.setItem(GOOGLE_OAUTH_EXPIRES_KEY, String(expiresAt));
      localStorage.setItem(GOOGLE_CLIENT_ID_KEY,    clientId);
      statusEl.textContent = '✓ Signed in — token valid for 1 hour.';
      statusEl.style.color = '#26a69a';
    },
  });
  client.requestAccessToken({ prompt: '' });
}

function switchAuthMethod(method) {
  localStorage.setItem(LLM_AUTH_METHOD_KEY, method);
  document.querySelectorAll('.auth-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.method === method);
  });
  document.getElementById('llm-key-row').style.display   = method === 'apikey' ? '' : 'none';
  document.getElementById('llm-oauth-row').style.display = method === 'oauth'  ? '' : 'none';
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

// Client-side AI prediction cache (survives browser refresh)
const AI_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
function _aiCacheKey(symbol, provider, model) {
  return `winfinity_ai_${symbol}_${provider}_${model}`;
}
function _getAiCache(symbol, provider, model) {
  try {
    const raw = localStorage.getItem(_aiCacheKey(symbol, provider, model));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > AI_CACHE_TTL) {
      localStorage.removeItem(_aiCacheKey(symbol, provider, model));
      return null;
    }
    return entry.data;
  } catch { return null; }
}
function _setAiCache(symbol, provider, model, data) {
  try {
    localStorage.setItem(_aiCacheKey(symbol, provider, model), JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota exceeded — ignore */ }
}

// ============================================================
// Bootstrap
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  loadMarketOverview();
  loadStockList();
  loadSpyChart('1mo');
  loadVixChart('1mo');
  loadMarketInfluence();

  // SPY/VIX period buttons
  document.querySelectorAll('.sv-period').forEach(btn => {
    btn.addEventListener('click', () => {
      const chart = btn.dataset.chart; // 'spy' or 'vix'
      const period = btn.dataset.period;
      document.querySelectorAll(`.sv-period[data-chart="${chart}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (chart === 'spy') loadSpyChart(period);
      else loadVixChart(period);
    });
  });

  // Period buttons
  document.querySelectorAll('.btn-tab[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-tab[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadChartData(currentSymbol);
    });
  });

  // Extended hours toggle — reload chart when toggled
  document.getElementById('toggle-extended').addEventListener('change', () => {
    loadChartData(currentSymbol);
  });

  // Indicator toggles — re-render all overlays so "busy" mode recalculates
  function _refreshAllOverlays() {
    if (_lastIndicatorData) renderOverlays(_lastIndicatorData);
  }
  document.getElementById('toggle-ripster').addEventListener('change', _refreshAllOverlays);
  document.getElementById('toggle-bb').addEventListener('change', _refreshAllOverlays);

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

  // Clickable topbar indices — load them as main chart
  const _idxClickMap = {
    'idx-spy': 'SPY', 'idx-vix': 'VIX',
    'idx-gspc': 'SPY', 'idx-ixic': 'QQQ', 'idx-dji': 'DIA',
  };
  Object.entries(_idxClickMap).forEach(([elId, sym]) => {
    const el = document.getElementById(elId);
    if (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => loadChartData(sym));
    }
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
  const settingsModal  = document.getElementById('settings-modal');
  const alpKeyInput    = document.getElementById('alpaca-key-input');
  const alpSecretInput = document.getElementById('alpaca-secret-input');
  const fhKeyInput     = document.getElementById('finnhub-key-input');
  const llmProvSel     = document.getElementById('llm-provider-select');
  const llmModelSel    = document.getElementById('llm-model-select');
  const llmKeyInput    = document.getElementById('llm-key-input');
  const llmOllamaInput = document.getElementById('llm-ollama-url');
  const keyStatus      = document.getElementById('key-status');

  function populateLLMModels(provider) {
    const models = LLM_MODELS[provider] || [];
    const saved  = getLLMModel();
    llmModelSel.innerHTML = models.length
      ? models.map(m => `<option value="${m}" ${m === saved ? 'selected' : ''}>${m}</option>`).join('')
      : '<option value="">— select provider first —</option>';

    const isOllama = provider === 'ollama';
    const isGoogle = provider === 'google';
    const method   = getLLMAuthMethod();

    // Auth method tabs — only Google supports OAuth
    document.getElementById('llm-auth-method-row').style.display = isGoogle ? '' : 'none';
    if (!isGoogle) {
      // Reset to API key mode for non-Google providers
      localStorage.setItem(LLM_AUTH_METHOD_KEY, 'apikey');
      document.querySelectorAll('.auth-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.method === 'apikey'));
    }

    // Ollama URL row
    document.getElementById('llm-ollama-row').style.display = isOllama ? '' : 'none';

    // Key row / OAuth row
    if (isOllama) {
      document.getElementById('llm-key-row').style.display   = 'none';
      document.getElementById('llm-oauth-row').style.display = 'none';
    } else if (isGoogle && method === 'oauth') {
      document.getElementById('llm-key-row').style.display   = 'none';
      document.getElementById('llm-oauth-row').style.display = '';
      // Restore saved client ID and token status
      document.getElementById('llm-client-id').value = getGoogleClientId();
      const oauthToken = getValidGoogleOAuthToken();
      const statusEl = document.getElementById('llm-oauth-status');
      statusEl.textContent = oauthToken ? '✓ Token active.' : 'Not signed in.';
      statusEl.style.color = oauthToken ? '#26a69a' : '#787b86';
    } else {
      document.getElementById('llm-key-row').style.display   = provider ? '' : 'none';
      document.getElementById('llm-oauth-row').style.display = 'none';
    }

    // API key hint
    const hintEl = document.getElementById('llm-apikey-hint');
    if (hintEl) hintEl.textContent = LLM_KEY_HINTS[provider] || '';
  }

  llmProvSel.addEventListener('change', () => populateLLMModels(llmProvSel.value));

  document.getElementById('settings-btn').addEventListener('click', () => {
    alpKeyInput.value    = getAlpacaKey();
    alpSecretInput.value = getAlpacaSecret();
    fhKeyInput.value     = getFinnhubKey();
    llmProvSel.value     = getLLMProvider();
    llmKeyInput.value    = getLLMKey();
    llmOllamaInput.value = getOllamaUrl();
    populateLLMModels(llmProvSel.value);
    const hasAlpaca = getAlpacaKey() && getAlpacaSecret();
    const hasLLM    = getLLMProvider();
    keyStatus.textContent = hasLLM ? `LLM: ${LLM_PROVIDER_NAMES[getLLMProvider()] || getLLMProvider()} (${getLLMModel()})` :
                             hasAlpaca ? 'Alpaca keys loaded.' : 'No keys saved yet.';
    settingsModal.classList.remove('hidden');
  });
  document.getElementById('settings-modal-close').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });
  document.getElementById('show-key-toggle').addEventListener('change', e => {
    const t = e.target.checked ? 'text' : 'password';
    alpKeyInput.type = alpSecretInput.type = fhKeyInput.type = llmKeyInput.type = t;
  });
  document.getElementById('save-key-btn').addEventListener('click', () => {
    const alpKey  = alpKeyInput.value.trim();
    const alpSec  = alpSecretInput.value.trim();
    const fhKey   = fhKeyInput.value.trim();
    const llmProv = llmProvSel.value;
    const llmMod  = llmModelSel.value;
    const llmKey  = llmKeyInput.value.trim();
    const ollamaU = llmOllamaInput.value.trim();

    if (alpKey)  localStorage.setItem(ALP_KEY_STORAGE,    alpKey);
    if (alpSec)  localStorage.setItem(ALP_SECRET_STORAGE, alpSec);
    if (fhKey)   localStorage.setItem(STORAGE_KEY,        fhKey);
    if (llmProv) { localStorage.setItem(LLM_PROVIDER_KEY, llmProv); }
    else         { localStorage.removeItem(LLM_PROVIDER_KEY); }
    if (llmMod)  localStorage.setItem(LLM_MODEL_KEY,      llmMod);
    if (llmKey)  localStorage.setItem(LLM_KEY_STORAGE,    llmKey);
    if (ollamaU) localStorage.setItem(LLM_OLLAMA_URL_KEY, ollamaU);

    keyStatus.textContent = 'Saved. Reloading…';
    keyStatus.style.color = '#26a69a';
    setTimeout(() => {
      settingsModal.classList.add('hidden');
      loadMarketOverview();
      loadStockList();
      loadChartData(currentSymbol);
    }, 500);
  });
  document.getElementById('clear-key-btn').addEventListener('click', () => {
    [STORAGE_KEY, ALP_KEY_STORAGE, ALP_SECRET_STORAGE,
     LLM_PROVIDER_KEY, LLM_MODEL_KEY, LLM_KEY_STORAGE, LLM_OLLAMA_URL_KEY,
     LLM_AUTH_METHOD_KEY, GOOGLE_OAUTH_TOKEN_KEY, GOOGLE_OAUTH_EXPIRES_KEY, GOOGLE_CLIENT_ID_KEY,
    ].forEach(k => localStorage.removeItem(k));
    alpKeyInput.value = alpSecretInput.value = fhKeyInput.value = llmKeyInput.value = '';
    llmProvSel.value  = '';
    populateLLMModels('');
    keyStatus.textContent = 'All keys cleared.';
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

  // Options section tabs
  document.querySelectorAll('.options-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.options-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.options-tab-panel').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
      btn.classList.add('active');
      const panel = document.getElementById(btn.dataset.otab);
      panel.style.display = 'block';
      panel.classList.add('active');
    });
  });

  // Mobile sidebar drawer
  const sidebar    = document.getElementById('sidebar');
  const backdrop   = document.getElementById('sidebar-backdrop');
  const menuBtn    = document.getElementById('mobile-menu-btn');
  function openSidebar()  { sidebar.classList.add('mobile-open');    backdrop.classList.add('active'); }
  function closeSidebar() { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('active'); }
  menuBtn.addEventListener('click', () =>
    sidebar.classList.contains('mobile-open') ? closeSidebar() : openSidebar()
  );
  backdrop.addEventListener('click', closeSidebar);
  // Close drawer when a stock is selected on mobile
  document.getElementById('stock-list').addEventListener('click', e => {
    if (e.target.closest('.stock-item') && window.innerWidth <= 640) closeSidebar();
  });

  // Auto-refresh — chart updates every 30s for intraday, 60s otherwise
  setInterval(loadMarketOverview, 30000);
  setInterval(refreshOpenGroups, 60000);
  setInterval(() => {
    const period = getSelectedPeriod();
    const isIntraday = (period === '1d' || period === '1wk');
    loadChartData(currentSymbol);
    // Also refresh header price
    loadMarketOverview();
  }, 30000);
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
  groupStocks[name] = [];   // empty but loaded — won't show "Loading…"
  await renderManageLists();
  reloadSidebar();
}

function clearGroupCache() {
  Object.keys(groupStocks).forEach(k => delete groupStocks[k]);
}

async function reloadSidebar() {
  DB_LISTS = await apiFetch(`${API}/api/lists`);
  // Repopulate the dropdown
  const sel = document.getElementById('list-select');
  if (sel) {
    sel.innerHTML = DB_LISTS.map(l =>
      `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)} (${l.symbols.length})</option>`
    ).join('');
    if (currentList && DB_LISTS.some(l => l.name === currentList)) {
      sel.value = currentList;
    } else {
      currentList = DB_LISTS[0]?.name || '';
      sel.value = currentList;
    }
  }
  if (currentList) await loadGroupStocks(currentList);
  else renderGroupSidebar();
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

  // SPY full chart
  const spyEl = document.getElementById('spy-full-chart');
  if (spyEl) {
    spyMiniChart = LightweightCharts.createChart(spyEl, makeChartOpts(300, spyEl));
  }

  // VIX full chart
  const vixEl = document.getElementById('vix-full-chart');
  if (vixEl) {
    vixMiniChart = LightweightCharts.createChart(vixEl, makeChartOpts(300, vixEl));
  }

  // Resize observer
  const ro = new ResizeObserver(() => {
    mainChart.applyOptions({ width: mainEl.clientWidth, height: mainEl.clientHeight });
    rsiChart.applyOptions({ width: rsiEl.clientWidth,  height: rsiEl.clientHeight  });
    macdChart.applyOptions({ width: macdEl.clientWidth, height: macdEl.clientHeight });
    if (spyEl) spyMiniChart.applyOptions({ width: spyEl.clientWidth, height: spyEl.clientHeight });
    if (vixEl) vixMiniChart.applyOptions({ width: vixEl.clientWidth, height: vixEl.clientHeight });
  });
  [mainEl, rsiEl, macdEl, spyEl, vixEl].filter(Boolean).forEach(el => ro.observe(el));

  // Hover tooltips
  initMainTooltip();
  initRsiTooltip();
  initMacdTooltip();

  loadChartData(currentSymbol);
}

// ============================================================
// Hover Tooltips
// ============================================================
let _candleData = [];   // kept in sync for tooltip lookup
let _rsiData    = [];
let _macdData   = { macd: [], signal: [], histogram: [] };

function positionTooltip(el, chartEl, param) {
  const rect = chartEl.getBoundingClientRect();
  const x = rect.left + (param.point?.x || 0);
  const y = rect.top  + (param.point?.y || 0);
  const tw = el.offsetWidth  || 180;
  const th = el.offsetHeight || 100;
  const margin = 12;
  let left = x + margin;
  let top  = y - th / 2;
  if (left + tw > window.innerWidth  - 8) left = x - tw - margin;
  if (top < 8)                            top  = 8;
  if (top + th > window.innerHeight  - 8) top  = window.innerHeight - th - 8;
  el.style.left = left + 'px';
  el.style.top  = top  + 'px';
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'object' ? Date.UTC(ts.year, ts.month - 1, ts.day) : ts * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initMainTooltip() {
  const tip  = document.getElementById('main-tooltip');
  const cEl  = document.getElementById('main-chart-container');

  mainChart.subscribeCrosshairMove(param => {
    if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
      tip.style.display = 'none'; return;
    }
    // Find candle for this time
    const candle = _candleData.find(d => d.time === param.time);
    if (!candle) { tip.style.display = 'none'; return; }

    const dir    = candle.close >= candle.open ? 'tt-up' : 'tt-down';
    const chg    = candle.close - candle.open;
    const chgPct = (chg / candle.open * 100).toFixed(2);
    const sign   = chg >= 0 ? '+' : '';
    const vol    = candle.volume != null ? (candle.volume >= 1e6 ? (candle.volume / 1e6).toFixed(2) + 'M' : (candle.volume / 1e3).toFixed(0) + 'K') : '—';

    // Ripster EMA values at this time
    let emaRows = '';
    if (_lastIndicatorData?.ripster) {
      const r = _lastIndicatorData.ripster;
      const find = arr => arr?.find(d => d.time === param.time)?.value;
      const e8 = find(r.ema8); const e34 = find(r.ema34); const e200 = find(r.ema200);
      if (e8   != null) emaRows += `<div class="tt-row"><span class="tt-label">EMA 8/9</span><span class="tt-val">${e8.toFixed(2)}</span></div>`;
      if (e34  != null) emaRows += `<div class="tt-row"><span class="tt-label">EMA 34/39</span><span class="tt-val">${e34.toFixed(2)}</span></div>`;
      if (e200 != null) emaRows += `<div class="tt-row"><span class="tt-label">EMA 200</span><span class="tt-val">${e200.toFixed(2)}</span></div>`;
    }

    tip.innerHTML = `
      <div class="tt-date">${fmtDate(param.time)}</div>
      <div class="tt-row"><span class="tt-label">Open</span><span class="tt-val">${candle.open.toFixed(2)}</span></div>
      <div class="tt-row"><span class="tt-label">High</span><span class="tt-val tt-up">${candle.high.toFixed(2)}</span></div>
      <div class="tt-row"><span class="tt-label">Low</span><span class="tt-val tt-down">${candle.low.toFixed(2)}</span></div>
      <div class="tt-row"><span class="tt-label">Close</span><span class="tt-val ${dir}">${candle.close.toFixed(2)}</span></div>
      <div class="tt-row"><span class="tt-label">Change</span><span class="tt-val ${dir}">${sign}${chg.toFixed(2)} (${sign}${chgPct}%)</span></div>
      <div class="tt-row"><span class="tt-label">Volume</span><span class="tt-val">${vol}</span></div>
      ${emaRows}`;
    tip.style.display = 'block';
    positionTooltip(tip, cEl, param);
  });
}

function initRsiTooltip() {
  const tip = document.getElementById('rsi-tooltip');
  const cEl = document.getElementById('rsi-chart-container');

  rsiChart.subscribeCrosshairMove(param => {
    if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
      tip.style.display = 'none'; return;
    }
    const entry = _rsiData.find(d => d.time === param.time);
    if (!entry) { tip.style.display = 'none'; return; }

    const v   = entry.value;
    const cls = v > 70 ? 'tt-down' : v < 30 ? 'tt-up' : '';
    const lbl = v > 70 ? 'Overbought' : v < 30 ? 'Oversold' : 'Neutral';
    tip.innerHTML = `
      <div class="tt-date">${fmtDate(param.time)}</div>
      <div class="tt-row"><span class="tt-label">RSI (14)</span><span class="tt-val ${cls}">${v.toFixed(1)}</span></div>
      <div class="tt-row"><span class="tt-label">Signal</span><span class="tt-val ${cls}">${lbl}</span></div>`;
    tip.style.display = 'block';
    positionTooltip(tip, cEl, param);
  });
}

function initMacdTooltip() {
  const tip = document.getElementById('macd-tooltip');
  const cEl = document.getElementById('macd-chart-container');

  macdChart.subscribeCrosshairMove(param => {
    if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
      tip.style.display = 'none'; return;
    }
    const macdEntry = _macdData.macd.find(d => d.time === param.time);
    const sigEntry  = _macdData.signal.find(d => d.time === param.time);
    const histEntry = _macdData.histogram.find(d => d.time === param.time);
    if (!macdEntry && !sigEntry) { tip.style.display = 'none'; return; }

    const hist = histEntry?.value ?? 0;
    const hCls = hist >= 0 ? 'tt-up' : 'tt-down';
    tip.innerHTML = `
      <div class="tt-date">${fmtDate(param.time)}</div>
      ${macdEntry ? `<div class="tt-row"><span class="tt-label">MACD</span><span class="tt-val" style="color:#2962ff">${macdEntry.value.toFixed(3)}</span></div>` : ''}
      ${sigEntry  ? `<div class="tt-row"><span class="tt-label">Signal</span><span class="tt-val" style="color:#ff6d00">${sigEntry.value.toFixed(3)}</span></div>` : ''}
      ${histEntry ? `<div class="tt-row"><span class="tt-label">Histogram</span><span class="tt-val ${hCls}">${hist.toFixed(3)}</span></div>` : ''}`;
    tip.style.display = 'block';
    positionTooltip(tip, cEl, param);
  });
}

// ============================================================
// Load Chart Data
// ============================================================
function getSelectedPeriod() {
  const active = document.querySelector('.btn-tab[data-period].active');
  return active ? active.dataset.period : '6mo';
}

function isExtendedHours() {
  return document.getElementById('toggle-extended')?.checked || false;
}

async function loadChartData(symbol) {
  currentSymbol = symbol;
  document.getElementById('selected-symbol').textContent = symbol;
  const period   = getSelectedPeriod();
  const extended = isExtendedHours();
  const extParam = extended ? '&extended=1' : '';

  try {
    const [candles, indicators, prediction] = await Promise.all([
      apiFetch(`${API}/api/chart/${symbol}?period=${period}${extParam}`),
      apiFetch(`${API}/api/indicators/${symbol}?period=${period}${extParam}`),
      apiFetch(`${API}/api/prediction/${symbol}`),
    ]);

    renderCandles(candles);
    _lastIndicatorData = indicators;
    renderIndicators(indicators);
    _lastPredictionData = prediction;
    renderPrediction(prediction, symbol);
    loadNewsFeed(symbol);
    loadOptionsChain(symbol);

    // LLM analysis overrides prediction + options strategy when configured
    if (getLLMProvider()) {
      loadLLMAnalysis(symbol);
    } else {
      loadOptionsStrategy(symbol);
    }

    const stock = allStocks.find(s => s.symbol === symbol);
    if (stock) updateChartHeader(stock);
  } catch (err) {
    console.error('loadChartData:', err);
  }
}

function renderCandles(data) {
  if (!Array.isArray(data) || !data.length) return;
  _candleData = data;   // cache for tooltip
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
    _rsiData = data.rsi;   // cache for tooltip
    rsiSeries.setData(data.rsi);
    const t0 = data.rsi[0].time;
    const t1 = data.rsi[data.rsi.length - 1].time;
    rsiOB.setData([{ time: t0, value: 70 }, { time: t1, value: 70 }]);
    rsiOS.setData([{ time: t0, value: 30 }, { time: t1, value: 30 }]);
    rsiChart.timeScale().fitContent();
  }

  if (data.macd) {
    _macdData = { macd: data.macd.macd || [], signal: data.macd.signal || [], histogram: data.macd.histogram || [] };
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

  // When both overlays are active, reduce their visual weight so candles stay prominent
  const busy = showRipster && showBB;

  if (showRipster && data.ripster) {
    const r = data.ripster;
    const w = busy ? 1 : 2;
    // Fast cloud boundary lines
    ripsterSeries.ema8  = addEmaLine(r.ema8,  busy ? 'rgba(0,229,200,0.45)' : '#00e5c8', w);
    ripsterSeries.ema9  = addEmaLine(r.ema9,  busy ? 'rgba(0,229,200,0.45)' : '#00e5c8', w);
    // Slow cloud boundary lines
    ripsterSeries.ema34 = addEmaLine(r.ema34, busy ? 'rgba(77,138,255,0.45)' : '#4d8aff', w);
    ripsterSeries.ema39 = addEmaLine(r.ema39, busy ? 'rgba(77,138,255,0.45)' : '#4d8aff', w);
    // Trend filter EMA 200
    ripsterSeries.ema200 = addEmaLine(r.ema200, busy ? 'rgba(249,168,37,0.5)' : '#f9a825', busy ? 1.5 : 2.5);
    // Signal lines EMA 5 & 13 — always subtle
    ripsterSeries.ema5  = addEmaLine(r.ema5,  'rgba(255,255,255,0.3)', 1);
    ripsterSeries.ema13 = addEmaLine(r.ema13, 'rgba(200,200,200,0.3)', 1);

    // Draw filled cloud bands via canvas overlay
    drawRipsterCloud(r);
  }

  if (showBB && data.bollinger) {
    const bb = data.bollinger;
    const a = busy ? '0.35' : '0.7';
    bbSeries.upper = addEmaLine(bb.upper, `rgba(156,39,176,${a})`, 1);
    bbSeries.mid   = addEmaLine(bb.mid,   `rgba(156,39,176,${busy ? '0.25' : '0.5'})`, 1, LightweightCharts.LineStyle.Dashed);
    bbSeries.lower = addEmaLine(bb.lower, `rgba(156,39,176,${a})`, 1);
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

  // redrawFull (below) is the active redraw function

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
    const showBB = document.getElementById('toggle-bb').checked;
    const busy = showBB;
    // Fast cloud: teal (bullish) / red (bearish)
    const fastA = busy ? 0.15 : 0.38;
    const slowA = busy ? 0.12 : 0.30;
    paintBand(ctx, ripster.ema8,  ripster.ema9,  `rgba(0,229,200,${fastA})`, `rgba(239,83,80,${fastA})`);
    // Slow cloud: blue (bullish) / purple (bearish)
    paintBandSlow(ctx, ripster.ema34, ripster.ema39, `rgba(77,138,255,${slowA})`, `rgba(156,39,176,${slowA})`);
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
// Stock List — dropdown sidebar
// ============================================================
let currentList = '';

async function loadStockList() {
  try {
    DB_LISTS = await apiFetch(`${API}/api/lists`);
  } catch(e) { console.error('loadStockList:', e); return; }

  const sel = document.getElementById('list-select');
  if (sel) {
    sel.innerHTML = DB_LISTS.map(l =>
      `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)} (${l.symbols.length})</option>`
    ).join('');
    sel.onchange = () => {
      currentList = sel.value;
      delete groupStocks[currentList];
      loadGroupStocks(currentList);
    };
    // Restore previously selected list or use first
    const saved = localStorage.getItem('winfinity_current_list');
    if (saved && DB_LISTS.some(l => l.name === saved)) {
      currentList = saved;
      sel.value = saved;
    } else {
      currentList = DB_LISTS[0]?.name || '';
    }
  }

  if (currentList) {
    await loadGroupStocks(currentList);
  } else {
    renderGroupSidebar();
  }
}

async function loadGroupStocks(groupName) {
  const grp = DB_LISTS.find(l => l.name === groupName);
  const symbols = grp ? grp.symbols : buildGroupMap()[groupName];
  localStorage.setItem('winfinity_current_list', groupName);
  if (!symbols || !symbols.length) {
    groupStocks[groupName] = [];
    renderGroupSidebar();
    return;
  }
  document.getElementById('stock-list').innerHTML =
    `<div class="group-loading">Loading ${escapeHtml(groupName)}…</div>`;
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

  const stocks = groupStocks[currentList];
  if (!stocks) {
    listEl.innerHTML = `<div class="group-loading">Loading…</div>`;
    return;
  }
  listEl.innerHTML = stocks.length
    ? stocks.map(s => stockItemHtml(s)).join('')
    : `<div class="group-loading">No stocks in this list.</div>`;
}

async function refreshOpenGroups() {
  if (currentList) {
    delete groupStocks[currentList];
    await loadGroupStocks(currentList);
  }
}

function stockItemHtml(s) {
  const chgCls  = s.change_pct > 0 ? 'positive' : s.change_pct < 0 ? 'negative' : 'neutral';
  const sign    = s.change_pct > 0 ? '+' : '';
  const active  = s.symbol === currentSymbol ? ' active' : '';
  const isBull  = s.change_pct > 0;
  const isNeutral = s.change_pct === 0 || s.change_pct == null;
  const sentimentLabel = isNeutral ? 'NEUTRAL' : isBull ? 'BULLISH' : 'BEARISH';
  const sentimentCls   = isNeutral ? 'si-sent-neut' : isBull ? 'si-sent-bull' : 'si-sent-bear';
  return `
    <div class="stock-item${active}" onclick="selectStock('${s.symbol}')">
      <div class="si-left">
        <span class="si-sym">${s.symbol}</span>
        <span class="si-name">${escapeHtml(s.name || '')}</span>
        <div class="si-meta">
          <span class="si-sent ${sentimentCls}">${sentimentLabel}</span>
          ${s.pe ? `<span class="si-pe">P/E ${s.pe}</span>` : ''}
        </div>
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
// SPY & VIX Full Charts
// ============================================================
async function loadSpyChart(period = '1mo') {
  try {
    const data = await apiFetch(`${API}/api/spy-chart?period=${period}`);
    if (!data.candles || !data.candles.length) return;

    // Recreate chart to clear old series
    const el = document.getElementById('spy-full-chart');
    if (!el) return;
    el.innerHTML = '';
    spyMiniChart = LightweightCharts.createChart(el, makeChartOpts(300, el));

    const cs = spyMiniChart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    cs.setData(data.candles);

    // Volume
    const vol = spyMiniChart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: 'spy_vol',
    });
    spyMiniChart.priceScale('spy_vol').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 }, borderVisible: false,
    });
    vol.setData(data.candles.map(d => ({
      time: d.time, value: d.volume,
      color: d.close >= d.open ? 'rgba(38,166,154,0.25)' : 'rgba(239,83,80,0.25)',
    })));

    // RSI overlay
    if (data.indicators?.rsi?.length) {
      const rsiL = spyMiniChart.addLineSeries({
        color: '#7b61ff', lineWidth: 1, priceLineVisible: false,
        priceScaleId: 'rsi_spy',
      });
      spyMiniChart.priceScale('rsi_spy').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false,
      });
      rsiL.setData(data.indicators.rsi);
    }

    spyMiniChart.timeScale().fitContent();

    // Update live price header
    const last = data.candles[data.candles.length - 1];
    const prev = data.candles.length > 1 ? data.candles[data.candles.length - 2] : last;
    _updateSpyVixHeader('spy', last.close, prev.close);

    // Crosshair tooltip
    spyMiniChart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData?.size) {
        _updateSpyVixHeader('spy', last.close, prev.close);
        return;
      }
      const bar = param.seriesData.get(cs);
      if (bar) _updateSpyVixHeader('spy', bar.close, bar.open);
    });

  } catch (e) { console.error('spy chart:', e); }
}

async function loadVixChart(period = '1mo') {
  try {
    const data = await apiFetch(`${API}/api/vix-chart?period=${period}`);
    if (!data.series || !data.series.length) return;

    // Recreate chart to clear old series
    const el = document.getElementById('vix-full-chart');
    if (!el) return;
    el.innerHTML = '';
    vixMiniChart = LightweightCharts.createChart(el, makeChartOpts(300, el));

    const areaSer = vixMiniChart.addAreaSeries({
      lineColor: '#ff6d00',
      topColor: 'rgba(255,109,0,0.3)',
      bottomColor: 'rgba(255,109,0,0.0)',
      lineWidth: 2,
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

    // Update live price header
    const last = data.series[data.series.length - 1];
    const prev = data.series.length > 1 ? data.series[data.series.length - 2] : last;
    _updateSpyVixHeader('vix', last.value, prev.value);

    // Crosshair tooltip
    vixMiniChart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData?.size) {
        _updateSpyVixHeader('vix', last.value, prev.value);
        return;
      }
      const pt = param.seriesData.get(areaSer);
      if (pt) _updateSpyVixHeader('vix', pt.value, last.value);
    });

  } catch (e) { console.error('vix chart:', e); }
}

function _updateSpyVixHeader(which, price, ref) {
  const priceEl  = document.getElementById(`${which}-live-price`);
  const changeEl = document.getElementById(`${which}-live-change`);
  if (!priceEl) return;
  priceEl.textContent = `$${Number(price).toFixed(2)}`;
  const chg = price - ref;
  const pct = ref ? ((chg / ref) * 100) : 0;
  const sign = chg >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${chg.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
  changeEl.style.color = chg >= 0 ? '#26a69a' : '#ef5350';
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
  renderPredictionPanel(data, el);
}

function renderPredictionOverlay(data) {
  if (predictionSeries) {
    try { mainChart.removeSeries(predictionSeries); } catch(e) {}
    predictionSeries = null;
  }
  const show = document.getElementById('toggle-prediction').checked;
  if (show && data.prediction_series && data.prediction_series.length) {
    const showRipster = document.getElementById('toggle-ripster').checked;
    const showBB = document.getElementById('toggle-bb').checked;
    const busy = [showRipster, showBB].filter(Boolean).length >= 1;
    predictionSeries = mainChart.addLineSeries({
      color: busy ? 'rgba(255,235,59,0.8)' : 'rgba(249,168,37,0.9)',
      lineWidth: busy ? 2 : 2,
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
async function loadNewsFeed(symbol) {
  const companyEl = document.getElementById('news-company-body');
  const sectorEl  = document.getElementById('news-sector-body');
  const globalEl  = document.getElementById('news-global-body');
  const labelEl   = document.getElementById('news-symbol-label');
  const sectorNameEl = document.getElementById('news-sector-name');

  companyEl.innerHTML = '<div class="news-placeholder">Loading…</div>';
  sectorEl.innerHTML  = '<div class="news-placeholder">Loading…</div>';
  globalEl.innerHTML  = '<div class="news-placeholder">Loading…</div>';
  labelEl.textContent = symbol;

  try {
    const data = await apiFetch(`${API}/api/news-feed/${symbol}`);

    if (data.sector_name && data.sector_name !== 'N/A') {
      sectorNameEl.textContent = `— ${data.sector_name}${data.sector_etf ? ' (' + data.sector_etf + ')' : ''}`;
    } else {
      sectorNameEl.textContent = '';
    }

    companyEl.innerHTML = renderNewsCards(data.company);
    sectorEl.innerHTML  = renderNewsCards(data.sector);
    globalEl.innerHTML  = renderNewsCards(data.global);
  } catch (e) {
    const err = '<div class="news-placeholder" style="color:#ef5350">Failed to load</div>';
    companyEl.innerHTML = sectorEl.innerHTML = globalEl.innerHTML = err;
  }
}

function renderNewsCards(news) {
  if (!Array.isArray(news) || !news.length) {
    return '<div class="news-placeholder">No news available</div>';
  }
  return news.map(n => {
    const url  = n.url || '#';
    const time = n.datetime ? new Date(n.datetime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    let sentBadge = '';
    if (n.sentiment === 'positive') {
      sentBadge = '<span class="news-sent news-sent-pos">&#9650; Positive</span>';
    } else if (n.sentiment === 'negative') {
      sentBadge = '<span class="news-sent news-sent-neg">&#9660; Negative</span>';
    } else if (n.sentiment === 'neutral') {
      sentBadge = '<span class="news-sent news-sent-neu">&#8212; Neutral</span>';
    }
    return `
      <a class="news-card" href="${url}" target="_blank" rel="noopener noreferrer">
        <div class="news-card-top">
          <span class="news-source">${escapeHtml(n.source || 'News')}</span>
          ${sentBadge}
          ${time ? `<span class="news-time">${time}</span>` : ''}
        </div>
        <div class="news-headline">${escapeHtml(n.headline || '')}</div>
        ${n.summary ? `<div class="news-summary">${escapeHtml(n.summary)}</div>` : ''}
      </a>`;
  }).join('');
}

// ============================================================
// Options Strategy
// ============================================================
async function loadOptionsStrategy(symbol) {
  const content = document.getElementById('options-content');
  const badge = document.getElementById('options-direction-badge');
  content.innerHTML = '<div class="options-loading">Analyzing options strategies…</div>';
  badge.innerHTML = '';
  try {
    const data = await apiFetch(`${API}/api/options-strategy/${symbol}`);
    renderOptionsStrategy(data);
  } catch (e) {
    content.innerHTML = '<div class="options-error">Failed to load options strategy</div>';
  }
}

function renderOptionsStrategy(data) {
  const content = document.getElementById('options-content');
  const badge = document.getElementById('options-direction-badge');

  if (!data || data.error) {
    content.innerHTML = `<div class="options-error">${escapeHtml(data?.error || 'No data')}</div>`;
    return;
  }

  const { direction, confidence, iv_regime, hv20, vol_signal, catalyst_flags, signals, strategies, symbol, generated_at, disclaimer } = data;

  // Direction badge
  const dirClass = direction === 'BULLISH' ? 'dir-bull' : direction === 'BEARISH' ? 'dir-bear' : 'dir-neut';
  badge.innerHTML = `<span class="dir-badge ${dirClass}">${direction}</span>
    <span class="iv-badge">IV: ${iv_regime}</span>
    <span class="conf-badge">Confidence: ${confidence}</span>`;

  // Signal scorecard
  const signalRows = (signals || []).map(s => {
    const cls = s.signal === 'BULLISH' ? 'sig-bull' : s.signal === 'BEARISH' ? 'sig-bear' : 'sig-neut';
    return `<div class="sig-row">
      <span class="sig-source">${escapeHtml(s.source)}</span>
      <span class="sig-badge ${cls}">${s.signal}</span>
      <span class="sig-detail">${escapeHtml(s.detail || '')}</span>
    </div>`;
  }).join('');

  // Strategy cards
  const stratCards = (strategies || []).map((s, i) => {
    const riskCls = s.risk_level === 'Low' ? 'risk-low' : s.risk_level === 'Medium' ? 'risk-med' : 'risk-high';
    const legs = (s.legs || []).map(l => {
      // legs are plain strings e.g. "BUY  Apr 25  $180 Call"
      const legStr = typeof l === 'string' ? l : JSON.stringify(l);
      const isBuy = legStr.trimStart().toUpperCase().startsWith('BUY');
      return `<div class="leg-row">
        <span class="leg-action ${isBuy ? 'leg-buy' : 'leg-sell'}">${isBuy ? 'BUY' : 'SELL'}</span>
        <span class="leg-desc">${escapeHtml(legStr.replace(/^(BUY|SELL)\s+/i, '').trim())}</span>
      </div>`;
    }).join('');

    return `<div class="strategy-card">
      <div class="strat-header">
        <span class="strat-rank">#${i + 1}</span>
        <span class="strat-name">${escapeHtml(s.name)}</span>
        <span class="strat-type">${escapeHtml(s.type)}</span>
        <span class="risk-badge ${riskCls}">${s.risk_level} Risk</span>
      </div>
      <div class="strat-legs">${legs}</div>
      <div class="strat-details">
        <div class="strat-rr">
          <span>Max Risk: <strong>${s.max_risk}</strong></span>
          <span>Max Reward: <strong>${s.max_reward}</strong></span>
          <span>Ideal move: <strong>${escapeHtml(s.ideal_move || '')}</strong></span>
        </div>
        <div class="strat-why">${escapeHtml(s.why || '')}</div>
        ${s.greek_note ? `<div class="strat-greek">${escapeHtml(s.greek_note)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // Catalyst flags
  let catalystHtml = '';
  const flags = Array.isArray(catalyst_flags) ? catalyst_flags : [];
  if (flags.length) {
    catalystHtml = `<div class="catalyst-flags">
      ${flags.map(f => `<span class="cat-flag">${escapeHtml(String(f).toUpperCase())}</span>`).join('')}
    </div>`;
  }

  content.innerHTML = `
    <div class="options-meta">
      <span>HV20: <strong>${hv20 != null ? hv20.toFixed(1) + '%' : '—'}</strong></span>
      <span>Volume signal: <strong>${escapeHtml(vol_signal || '—')}</strong></span>
      ${generated_at ? `<span class="options-timestamp">as of ${escapeHtml(generated_at)}</span>` : ''}
    </div>
    ${catalystHtml}
    <div class="signals-section">
      <div class="section-label">Signal Scorecard</div>
      <div class="signals-grid">${signalRows}</div>
    </div>
    <div class="strategies-section">
      <div class="section-label">Ranked Strategies</div>
      ${stratCards}
    </div>
    <div class="options-disclaimer">${escapeHtml(disclaimer || '')}</div>
  `;
}

// ============================================================
// AI Analysis
// ============================================================
async function loadLLMAnalysis(symbol, forceRefresh = false) {
  const provider = getLLMProvider();
  if (!provider) return;

  if (provider === 'ollama') {
    return loadOllamaAnalysis(symbol, forceRefresh);
  }

  const model   = getLLMModel() || '';
  const predEl  = document.getElementById('prediction-content');
  const optsEl  = document.getElementById('options-content');
  const badge   = document.getElementById('options-direction-badge');
  const pname   = LLM_PROVIDER_NAMES[provider] || provider;

  // Check client-side cache first (unless forced refresh)
  if (!forceRefresh) {
    const cached = _getAiCache(symbol, provider, model);
    if (cached) {
      renderLLMPrediction(cached);
      renderLLMOptionsStrategy(cached);
      return;
    }
  }

  predEl.innerHTML = `<div class="prediction-loading llm-loading">&#129302; ${pname} AI is analysing…</div>`;
  optsEl.innerHTML = `<div class="options-loading">&#129302; ${pname} AI is generating strategy…</div>`;
  if (badge) badge.innerHTML = '';

  const url = `${API}/api/llm-analysis/${symbol}${forceRefresh ? '?refresh=1' : ''}`;
  try {
    const data = await apiFetch(url);
    if (data.error) throw new Error(data.error);
    _setAiCache(symbol, provider, model, data);
    renderLLMPrediction(data);
    renderLLMOptionsStrategy(data);
  } catch (e) {
    predEl.innerHTML = `<div class="prediction-loading" style="color:#ef5350">AI analysis failed: ${escapeHtml(e.message)}</div>`;
    // Fall back to statistical options strategy
    loadOptionsStrategy(symbol);
  }
}

async function loadOllamaAnalysis(symbol, forceRefresh = false) {
  const model     = getLLMModel() || 'llama3.3';
  const ollamaUrl = getOllamaUrl().replace(/\/$/, '');
  const predEl    = document.getElementById('prediction-content');
  const optsEl    = document.getElementById('options-content');
  const badge     = document.getElementById('options-direction-badge');

  // Check client-side cache first
  if (!forceRefresh) {
    const cached = _getAiCache(symbol, 'ollama', model);
    if (cached) {
      renderLLMPrediction(cached);
      renderLLMOptionsStrategy(cached);
      return;
    }
  }

  predEl.innerHTML = `<div class="prediction-loading llm-loading">&#129302; Ollama (${escapeHtml(model)}) is analysing…</div>`;
  optsEl.innerHTML = `<div class="options-loading">&#129302; Ollama is generating strategy…</div>`;
  if (badge) badge.innerHTML = '';

  try {
    // Step 1: fetch prepared prompts from the server
    const ctx = await apiFetch(`${API}/api/ai-context/${symbol}`);
    if (ctx.error) throw new Error(ctx.error);

    // Step 2: call Ollama directly from the browser
    // Use AbortController for a 120s timeout
    const abortCtrl = new AbortController();
    const abortTimer = setTimeout(() => abortCtrl.abort(), 120000);

    let ollamaResp;
    try {
      ollamaResp = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: ctx.system_prompt },
            { role: 'user',   content: ctx.user_prompt   },
          ],
          format: 'json',
          stream: false,
        }),
      });
    } catch (fetchErr) {
      clearTimeout(abortTimer);
      const isAbort = fetchErr.name === 'AbortError';
      const errMsg  = fetchErr.message || String(fetchErr);
      console.error('[Ollama] fetch error:', fetchErr);
      let hint;
      if (isAbort) {
        hint = `Request timed out after 120s. Model may be too large or Ollama is busy.`;
      } else {
        hint = `Cannot reach Ollama at <code>${escapeHtml(ollamaUrl)}</code>.<br>` +
               `Error: <code>${escapeHtml(errMsg)}</code><br><br>` +
               `Make sure to restart Ollama with CORS enabled:<br>` +
               `<code>pkill -f ollama && OLLAMA_ORIGINS="*" ollama serve</code>`;
      }
      predEl.innerHTML = `<div class="prediction-loading" style="color:#ef5350;line-height:1.8">
        &#9888; ${hint}</div>`;
      loadOptionsStrategy(symbol);
      return;
    }
    clearTimeout(abortTimer);

    if (!ollamaResp.ok) {
      throw new Error(`Ollama returned HTTP ${ollamaResp.status}`);
    }

    const ollamaJson = await ollamaResp.json();
    const rawText    = ollamaJson?.message?.content || '';
    if (!rawText) throw new Error('Ollama returned an empty response');

    // Step 3: parse the JSON from the raw text (mirrors server _parse_ai_result)
    let result = _parseAiJsonText(rawText);
    if (!result) throw new Error('Could not parse Ollama JSON response');

    result.symbol        = symbol;
    result.llm_provider  = 'ollama';
    result.llm_model     = model;
    result.current_price = ctx.current_price;

    // Build prediction_series for chart overlay
    result.prediction_series = (result.weekly_targets || []).flatMap(wt => {
      try {
        const ts = Math.floor(new Date(wt.date).getTime() / 1000);
        return [{ time: ts, value: parseFloat(wt.price) }];
      } catch { return []; }
    });

    _setAiCache(symbol, 'ollama', model, result);
    renderLLMPrediction(result);
    renderLLMOptionsStrategy(result);
  } catch (e) {
    predEl.innerHTML = `<div class="prediction-loading" style="color:#ef5350">AI analysis failed: ${escapeHtml(e.message)}</div>`;
    loadOptionsStrategy(symbol);
  }
}

/** Strip markdown fences and extract the first JSON object from raw LLM text. */
function _parseAiJsonText(raw) {
  let text = raw.trim();
  // Strip ```json ... ``` or ``` ... ```
  text = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(text);
  } catch (_) {
    // Try to find first {...} block
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

function renderLLMPrediction(data) {
  const el = document.getElementById('prediction-content');
  if (!el || !data) return;

  const signal  = data.signal || 'NEUTRAL';
  const sigCls  = signal === 'BULLISH' ? 'signal-BULLISH' : signal === 'BEARISH' ? 'signal-BEARISH' : 'signal-NEUTRAL';
  const conf    = data.confidence ?? '—';
  const pname   = LLM_PROVIDER_NAMES[data.llm_provider] || data.llm_provider || '';
  const model   = data.llm_model || '';

  const weeks = (data.weekly_targets || []).map(w => {
    const cls  = w.change_pct >= 0 ? 'positive' : 'negative';
    const sign = w.change_pct >= 0 ? '+' : '';
    return `<div class="pred-week">
      <div class="pw-label">Week ${w.week}</div>
      <div class="pw-price ${cls}">$${fmtPrice(w.price)}</div>
      <div class="pw-chg ${cls}">${sign}${Number(w.change_pct).toFixed(2)}%</div>
      <div style="font-size:9px;color:#4a4e5a">${w.date}</div>
    </div>`;
  }).join('');

  const months = (data.monthly_targets || []).map(m => {
    const cls  = m.change_pct >= 0 ? 'positive' : 'negative';
    const sign = m.change_pct >= 0 ? '+' : '';
    return `<div class="pred-week pred-month">
      <div class="pw-label">Month ${m.month}</div>
      <div class="pw-price ${cls}">$${fmtPrice(m.price)}</div>
      <div class="pw-chg ${cls}">${sign}${Number(m.change_pct).toFixed(2)}%</div>
      <div style="font-size:9px;color:#4a4e5a">${m.date}</div>
    </div>`;
  }).join('');

  const risks = (data.key_risks || []).map(r => `<span class="llm-tag llm-risk">${escapeHtml(r)}</span>`).join('');
  const cats  = (data.catalysts || []).map(c => `<span class="llm-tag llm-cat">${escapeHtml(c)}</span>`).join('');

  const tailwinds = (data.sector_tailwinds || []).map(t => `<span class="llm-tag llm-cat">${escapeHtml(t)}</span>`).join('');
  const headwinds = (data.sector_headwinds || []).map(h => `<span class="llm-tag llm-risk">${escapeHtml(h)}</span>`).join('');

  const influences = (data.external_influences || []).map(inf => {
    const sentCls = inf.sentiment === 'positive' ? 'inf-pos' : inf.sentiment === 'negative' ? 'inf-neg' : 'inf-neu';
    const icon    = inf.sentiment === 'positive' ? '▲' : inf.sentiment === 'negative' ? '▼' : '●';
    return `<div class="inf-row">
      <span class="inf-icon ${sentCls}">${icon}</span>
      <span class="inf-factor">${escapeHtml(inf.factor || '')}</span>
      <span class="inf-detail">${escapeHtml(inf.detail || '')}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="llm-badge-row">
      <span class="llm-badge">&#129302; ${escapeHtml(pname)} &middot; ${escapeHtml(model)}</span>
      <button class="llm-refresh-btn" onclick="loadLLMAnalysis('${escapeHtml(data.symbol)}', true)" title="Refresh AI analysis">&#8635;</button>
    </div>
    <div class="pred-header">
      <span class="pred-signal ${sigCls}">${signal}</span>
      <span class="pred-current">Confidence: <strong>${conf}%</strong></span>
      <span class="pred-current">Now: <strong>$${fmtPrice(data.current_price)}</strong></span>
    </div>
    <div class="pred-section-label">4-Week Outlook</div>
    <div class="pred-targets">${weeks}</div>
    ${months ? `<div class="pred-section-label" style="margin-top:10px">6-Month Outlook</div>
    <div class="pred-targets pred-targets-6m">${months}</div>` : ''}
    <div class="pred-range">
      <span class="range-label">Target range:</span>
      <span class="bull-val">&#9650; $${fmtPrice(data.bull_target)}</span>
      <span style="color:#4a4e5a">—</span>
      <span class="bear-val">&#9660; $${fmtPrice(data.bear_target)}</span>
    </div>
    ${data.reasoning        ? `<div class="llm-reasoning">${escapeHtml(data.reasoning)}</div>` : ''}
    ${data.geopolitical_impact ? `<div class="llm-reasoning llm-geo"><strong>&#127758; Geopolitical:</strong> ${escapeHtml(data.geopolitical_impact)}</div>` : ''}
    ${data.ai_tech_impact   ? `<div class="llm-reasoning llm-ai"><strong>&#129302; AI/Tech:</strong> ${escapeHtml(data.ai_tech_impact)}</div>` : ''}
    ${data.macro_impact     ? `<div class="llm-reasoning llm-macro"><strong>&#128200; Macro:</strong> ${escapeHtml(data.macro_impact)}</div>` : ''}
    ${influences ? `<div class="inf-block"><div class="inf-title">External Influences</div>${influences}</div>` : ''}
    ${tailwinds ? `<div class="llm-tags-row"><span class="llm-tags-label">&#9650; Tailwinds:</span>${tailwinds}</div>` : ''}
    ${headwinds ? `<div class="llm-tags-row"><span class="llm-tags-label">&#9660; Headwinds:</span>${headwinds}</div>` : ''}
    ${risks     ? `<div class="llm-tags-row"><span class="llm-tags-label">Risks:</span>${risks}</div>` : ''}
    ${cats      ? `<div class="llm-tags-row"><span class="llm-tags-label">Catalysts:</span>${cats}</div>` : ''}
  `;

  _lastPredictionData = data;
}

function renderLLMOptionsStrategy(data) {
  const content = document.getElementById('options-content');
  const badge   = document.getElementById('options-direction-badge');
  if (!content || !data) return;

  const signal  = data.signal || 'NEUTRAL';
  const dirCls  = signal === 'BULLISH' ? 'dir-bull' : signal === 'BEARISH' ? 'dir-bear' : 'dir-neut';
  const pname   = LLM_PROVIDER_NAMES[data.llm_provider] || data.llm_provider || '';
  const model   = data.llm_model || '';

  if (badge) {
    badge.innerHTML = `<span class="dir-badge ${dirCls}">${signal}</span>
      <span class="conf-badge">Confidence: ${data.confidence ?? '—'}%</span>`;
  }

  // Support both old single strategy and new array format
  const strategies = data.options_strategies || (data.options_strategy ? [data.options_strategy] : []);

  function strategyCard(strat) {
    const riskCls = strat.risk_level === 'Low' ? 'risk-low' : strat.risk_level === 'High' ? 'risk-high' : 'risk-med';
    const legs = (strat.legs || []).map(l => {
      const isBuy = String(l).trimStart().toUpperCase().startsWith('BUY');
      return `<div class="leg-row">
        <span class="leg-action ${isBuy ? 'leg-buy' : 'leg-sell'}">${isBuy ? 'BUY' : 'SELL'}</span>
        <span class="leg-desc">${escapeHtml(String(l).replace(/^(BUY|SELL)\s+/i, '').trim())}</span>
      </div>`;
    }).join('');
    const rankLabel = strat.rank ? `<span class="strat-rank">#${strat.rank}</span>` : '';
    return `
      <div class="strategy-card">
        <div class="strat-header">
          ${rankLabel}
          <span class="strat-name">${escapeHtml(strat.name || 'N/A')}</span>
          <span class="risk-badge ${riskCls}">${escapeHtml(strat.risk_level || 'Medium')} Risk</span>
        </div>
        <div class="strat-legs">${legs}</div>
        <div class="strat-details">
          <div class="strat-rr">
            <span>Max Gain: <strong>${escapeHtml(strat.max_gain || '—')}</strong></span>
            <span>Max Loss: <strong>${escapeHtml(strat.max_loss || '—')}</strong></span>
          </div>
          <div class="strat-why">${escapeHtml(strat.rationale || '')}</div>
        </div>
      </div>`;
  }

  content.innerHTML = `
    <div class="llm-badge-row">
      <span class="llm-badge">&#129302; ${escapeHtml(pname)} &middot; ${escapeHtml(model)}</span>
    </div>
    ${strategies.map(strategyCard).join('')}
    ${data.gex_analysis ? `<div class="llm-gex-note"><strong>GEX:</strong> ${escapeHtml(data.gex_analysis)}</div>` : ''}
  `;
}

// ============================================================
// Options Chain: GEX Walls + Call/Put Volume
// ============================================================
let _chainSymbol = '';
let _availableExpiries = [];

async function loadOptionsChain(symbol, expiry = '') {
  _chainSymbol = symbol;
  const loading = '<div class="options-loading">Loading…</div>';
  document.getElementById('gex-content').innerHTML = loading;
  document.getElementById('cpvol-content').innerHTML = loading;
  document.getElementById('gex-meta-bar').innerHTML = '';
  document.getElementById('cpvol-meta-bar').innerHTML = '';
  try {
    const url = `${API}/api/options-chain/${symbol}` + (expiry ? `?expiry=${encodeURIComponent(expiry)}` : '');
    const data = await apiFetch(url);
    // Populate expiry dropdowns on first load or symbol change
    if (data.available_expiries && data.available_expiries.length) {
      _availableExpiries = data.available_expiries;
      populateExpiryDropdown('gex-expiry-select',   data.available_expiries, data.expiry);
      populateExpiryDropdown('cpvol-expiry-select', data.available_expiries, data.expiry);
    }
    renderGexChart(data);
    renderCpVolChart(data);
  } catch (e) {
    const err = '<div class="options-error">Failed to load options chain</div>';
    document.getElementById('gex-content').innerHTML = err;
    document.getElementById('cpvol-content').innerHTML = err;
  }
}

function populateExpiryDropdown(selectId, expiries, selected) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = expiries.map(e =>
    `<option value="${e}" ${e === selected ? 'selected' : ''}>${e}</option>`
  ).join('');
}

function onGexExpiryChange() {
  const expiry = document.getElementById('gex-expiry-select').value;
  // Sync the other dropdown
  const other = document.getElementById('cpvol-expiry-select');
  if (other) other.value = expiry;
  if (_chainSymbol) loadOptionsChain(_chainSymbol, expiry);
}

function onCpvolExpiryChange() {
  const expiry = document.getElementById('cpvol-expiry-select').value;
  const other = document.getElementById('gex-expiry-select');
  if (other) other.value = expiry;
  if (_chainSymbol) loadOptionsChain(_chainSymbol, expiry);
}

// ── Horizontal bar chart (unusualwhales style) ──────────────────────────────
// series = [{ label, values, color, color2? }]  (color2 = second series, offset below)
// strikes run top (high) to bottom (low) on Y-axis
// bars extend left (negative) or right (positive) from center zero line
function renderHBarChart(container, strikes, series, lastPrice, xLabel) {
  if (!strikes || !strikes.length) {
    container.innerHTML = '<div class="options-error">No data</div>';
    return;
  }

  // Sort strikes descending (highest at top, like the screenshot)
  const order = strikes.map((_, i) => i).sort((a, b) => strikes[b] - strikes[a]);
  const sortedStrikes = order.map(i => strikes[i]);
  const sortedSeries  = series.map(s => ({ ...s, values: order.map(i => s.values[i]) }));

  const ROW_H   = 20;
  const N       = sortedStrikes.length;
  const pad     = { top: 36, right: 20, bottom: 36, left: 62 };
  const W       = Math.max(container.clientWidth || 700, 400);
  const H       = pad.top + N * ROW_H + pad.bottom;
  const innerW  = W - pad.left - pad.right;
  const innerH  = N * ROW_H;

  // Max absolute value across all series
  const allVals = sortedSeries.flatMap(s => s.values.map(v => Math.abs(v)));
  const maxVal  = Math.max(...allVals, 1);
  const centerX = pad.left + innerW / 2;
  const scale   = (innerW / 2) / maxVal;

  const fmtX = v => {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v.toFixed(0);
  };

  let svg = '';

  // Background row bands
  sortedStrikes.forEach((_, i) => {
    const y = pad.top + i * ROW_H;
    if (i % 2 === 0) svg += `<rect x="${pad.left}" y="${y}" width="${innerW}" height="${ROW_H}" fill="rgba(255,255,255,0.02)" />`;
  });

  // Grid lines (x-axis)
  const xTicks = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  xTicks.forEach(t => {
    const x = centerX + t * (innerW / 2);
    svg += `<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + innerH}" stroke="#2a2e39" stroke-width="${t === 0 ? 1.5 : 0.5}" />`;
    if (t !== 0) {
      const v = t * maxVal;
      svg += `<text x="${x}" y="${pad.top + innerH + 14}" text-anchor="middle" fill="#4a4e5a" font-size="9">${fmtX(v)}</text>`;
    }
  });

  // Spot price horizontal line
  if (lastPrice) {
    const spotIdx = sortedStrikes.reduce((best, s, i) =>
      Math.abs(s - lastPrice) < Math.abs(sortedStrikes[best] - lastPrice) ? i : best, 0);
    const spotY = pad.top + spotIdx * ROW_H + ROW_H / 2;
    svg += `<line x1="${pad.left}" y1="${spotY}" x2="${pad.left + innerW}" y2="${spotY}" stroke="#26c6da" stroke-width="1.5" stroke-dasharray="4,3" />`;
    svg += `<text x="${pad.left + 4}" y="${spotY - 4}" fill="#26c6da" font-size="9" font-weight="bold">Spot ${lastPrice}</text>`;
  }

  // Bars (two series stacked by row offset)
  const barH     = Math.max(4, ROW_H / (sortedSeries.length + 1));
  sortedStrikes.forEach((strike, i) => {
    const rowY = pad.top + i * ROW_H;
    sortedSeries.forEach((s, si) => {
      const val    = s.values[i] || 0;
      const barLen = Math.abs(val) * scale;
      const bx     = val >= 0 ? centerX : centerX - barLen;
      const by     = rowY + (ROW_H - barH * sortedSeries.length) / 2 + si * barH;
      const color  = val >= 0 ? s.colorPos : (s.colorNeg || s.colorPos);
      svg += `<rect x="${bx}" y="${by}" width="${barLen}" height="${barH - 1}" fill="${color}" opacity="0.88" rx="1" />`;
    });
    // Strike label
    svg += `<text x="${pad.left - 5}" y="${rowY + ROW_H / 2 + 4}" text-anchor="end" fill="#787b86" font-size="10">${strike}</text>`;
  });

  // Center zero line (on top)
  svg += `<line x1="${centerX}" y1="${pad.top}" x2="${centerX}" y2="${pad.top + innerH}" stroke="#555" stroke-width="1" />`;

  // Legend
  let lx = pad.left;
  sortedSeries.forEach(s => {
    svg += `<circle cx="${lx + 5}" cy="${pad.top - 16}" r="5" fill="${s.colorPos}" />`;
    svg += `<text x="${lx + 14}" y="${pad.top - 12}" fill="#a0a3ab" font-size="10">${escapeHtml(s.label)}</text>`;
    lx += s.label.length * 6 + 26;
  });

  // X-axis label
  if (xLabel) {
    svg += `<text x="${centerX}" y="${H - 2}" text-anchor="middle" fill="#4a4e5a" font-size="10">${escapeHtml(xLabel)}</text>`;
  }

  // Y-axis label
  svg += `<text x="${pad.left - 38}" y="${pad.top + innerH / 2}" text-anchor="middle" fill="#4a4e5a" font-size="10" transform="rotate(-90,${pad.left - 38},${pad.top + innerH / 2})">Strike</text>`;

  container.innerHTML = `<svg width="${W}" height="${H}" style="max-width:100%;overflow:visible">${svg}</svg>`;
}

function renderGexChart(data) {
  const metaEl = document.getElementById('gex-meta-bar');
  const el     = document.getElementById('gex-content');
  const discEl = document.getElementById('gex-disclaimer');

  if (!data || data.error) {
    el.innerHTML = `<div class="options-error">${escapeHtml(data?.error || 'No data')}</div>`;
    return;
  }

  const { strikes, gex, gex_vol, last_price, expiry } = data;
  metaEl.innerHTML = `<div class="chain-meta">Gamma Exposure &nbsp;|&nbsp; Expiry: <strong>${escapeHtml(expiry)}</strong> &nbsp;|&nbsp; Spot: <strong>$${last_price}</strong></div>`;

  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'chain-chart-wrap hbar-wrap';
  el.appendChild(wrap);

  renderHBarChart(wrap, strikes, [
    { label: '1% Change in Price by Open Interest', values: gex,     colorPos: '#9c27b0', colorNeg: '#9c27b0' },
    { label: '1% Change in Price by Volume',        values: gex_vol || gex, colorPos: '#f9a825', colorNeg: '#f9a825' },
  ], last_price, 'Gamma Exposure ($ / 1% Move)');

  discEl.style.display = 'block';
  discEl.textContent = '+GEX: dealers long gamma — dampens price moves. −GEX: dealers short gamma — amplifies moves. Approximated from IV via yfinance.';
}

function renderCpVolChart(data) {
  const metaEl = document.getElementById('cpvol-meta-bar');
  const el     = document.getElementById('cpvol-content');

  if (!data || data.error) {
    el.innerHTML = `<div class="options-error">${escapeHtml(data?.error || 'No data')}</div>`;
    return;
  }

  const { strikes, call_volume, put_volume, call_oi, put_oi, last_price, expiry } = data;
  const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n);
  const totalCV = call_volume.reduce((a, b) => a + b, 0);
  const totalPV = put_volume.reduce((a, b) => a + b, 0);
  const pcr     = totalCV > 0 ? (totalPV / totalCV).toFixed(2) : '—';
  const totalCO = call_oi.reduce((a, b) => a + b, 0);
  const totalPO = put_oi.reduce((a, b) => a + b, 0);

  metaEl.innerHTML = `<div class="chain-meta">
    Call/Put Volume &nbsp;|&nbsp; Expiry: <strong>${escapeHtml(expiry)}</strong> &nbsp;|&nbsp; Spot: <strong>$${last_price}</strong>
    <span class="chain-stat">Call Vol: <strong>${fmtK(totalCV)}</strong></span>
    <span class="chain-stat">Put Vol: <strong>${fmtK(totalPV)}</strong></span>
    <span class="chain-stat pcr-badge">P/C: <strong>${pcr}</strong></span>
    <span class="chain-stat">Call OI: <strong>${fmtK(totalCO)}</strong></span>
    <span class="chain-stat">Put OI: <strong>${fmtK(totalPO)}</strong></span>
  </div>`;

  el.innerHTML = '';

  // Volume chart
  const volWrap = document.createElement('div');
  volWrap.className = 'chain-chart-wrap hbar-wrap';
  el.appendChild(volWrap);
  renderHBarChart(volWrap, strikes, [
    { label: 'Call Volume', values: call_volume, colorPos: '#26a69a', colorNeg: '#26a69a' },
    { label: 'Put Volume',  values: put_volume,  colorPos: '#ef5350', colorNeg: '#ef5350' },
  ], last_price, 'Volume');

  // OI chart
  const oiLabel = document.createElement('div');
  oiLabel.className = 'chain-block-title';
  oiLabel.style.marginTop = '20px';
  oiLabel.textContent = 'Open Interest by Strike';
  el.appendChild(oiLabel);

  const oiWrap = document.createElement('div');
  oiWrap.className = 'chain-chart-wrap hbar-wrap';
  el.appendChild(oiWrap);
  renderHBarChart(oiWrap, strikes, [
    { label: 'Call OI', values: call_oi, colorPos: '#26a69a', colorNeg: '#26a69a' },
    { label: 'Put OI',  values: put_oi,  colorPos: '#ef5350', colorNeg: '#ef5350' },
  ], last_price, 'Open Interest');
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
