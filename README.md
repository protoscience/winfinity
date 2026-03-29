# Winfinity

A self-hosted stock market dashboard with TradingView-style charts, technical indicators, AI-powered predictions, options strategies, and fully manageable stock lists backed by SQLite with optional GitHub sync.

---

## Features

### Charts & Indicators
- **Candlestick charts** with volume bars (powered by [Lightweight Charts](https://tradingview.github.io/lightweight-charts/))
- **Ripster EMA Cloud** — filled cloud bands between EMA 8/9 (fast) and EMA 34/39 (slow), plus EMA 200 trend filter
- **RSI (14)** and **MACD (12,26,9)** sub-panels, synced to main chart
- **Bollinger Bands** (toggleable overlay)
- **4-week price prediction** overlay (AI or statistical ensemble)
- Period selector: **1M / 3M / 6M / 1Y**

### AI Analysis (LLM-Powered)
When configured, AI replaces statistical models for predictions and options strategies. The AI synthesises **all** of the following:

| Data Source | What it provides |
|---|---|
| **Company fundamentals** | Market cap, P/E, EPS, revenue growth, next earnings date |
| **Technical indicators** | RSI, MACD, moving averages, volume analysis |
| **Company & sector news** | 30-day headlines with sentiment from Alpaca + Finnhub |
| **Global macro & geopolitical news** | Wars, sanctions, trade tensions, Fed policy, FX, commodities |
| **M&A / deal activity** | Merger and acquisition headlines |
| **Broad market context** | SPY-correlated market-wide news |
| **Options flow** | Put/call ratios, max pain, GEX walls |

**AI output includes:**
- **4-week price targets** with weekly breakdown and chart overlay
- **Bull/bear target range** with confidence score
- **Geopolitical impact** — how conflicts affect the stock
- **AI/tech disruption impact** — tailwinds or headwinds from AI adoption
- **Macro impact** — Fed, FX, commodities, tariffs
- **Sector tailwinds & headwinds**
- **External influences** — each factor rated positive / negative / neutral
- **3 ranked options strategies** (primary, conservative, aggressive) with legs, max gain/loss, risk level
- **GEX analysis** — support/resistance from gamma exposure
- **Key risks and catalysts**

#### Supported AI Providers

| Provider | Auth | Models |
|---|---|---|
| **Google Gemini** | API Key or OAuth | gemini-3.1-flash-lite-preview, gemini-2.5-pro/flash, gemini-2.0-flash, 1.5-pro/flash |
| **OpenAI** | API Key | gpt-4.1, gpt-4.1-mini/nano, gpt-4o, gpt-4o-mini, o4-mini, o3, o3-mini, o1, o1-mini |
| **Anthropic** | API Key | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5, claude-3.5-sonnet/haiku |
| **Groq** | API Key | llama-3.3-70b, llama-3.1-70b/8b, deepseek-r1-distill-70b, mixtral-8x7b, gemma2-9b |
| **xAI** | API Key | grok-3, grok-3-mini, grok-2-latest |
| **Ollama (local)** | None | llama3.2, llama3.3, mistral, phi4, gemma3, deepseek-r1, qwen2.5 + any installed model |

All API keys are stored **only in your browser's localStorage** — never sent to or stored on the server.

#### Ollama (Local LLM) Setup

Ollama runs on your local machine, not the server. The browser calls Ollama directly:

```bash
# Start Ollama with CORS enabled (required for browser access)
OLLAMA_ORIGINS="*" ollama serve
```

If your app is served from a remote server (not localhost), Chrome's Private Network Access policy may block browser → local Ollama requests. Two options:

1. **SSH tunnel** (recommended):
   ```bash
   ssh -L 8447:localhost:8447 user@your-server
   # Then open http://localhost:8447
   ```

2. **Local CORS proxy** (included):
   ```bash
   python3 ollama_proxy.py --port 11435
   # Set Ollama URL in settings to http://YOUR_MAC_IP:11435
   ```

### Market Data
- **Three-tier data hierarchy**: Alpaca (fastest, real-time) → Finnhub (fundamentals) → yfinance (fallback)
- **Top market indices** in topbar: SPY, VIX, S&P 500, NASDAQ, DOW — auto-refreshed every 60s
- **SPY candlestick** and **VIX area chart** mini panels
- **Sector performance** (XLK, XLV, XLF, XLE … all 11 sectors) with bar charts
- **Macro indicators**: DXY, 10Y Treasury, Gold, Crude Oil, Bitcoin
- **Fear & Greed** proxy gauge (VIX-derived)
- **Market news** and **company-specific news** with sentiment badges
- **P/E ratio** displayed per stock

### Options Chain
- **GEX (Gamma Exposure)** chart with support/resistance walls
- **Call/Put volume** comparison chart
- **Expiry date selector** with multiple expirations
- Real options data from Alpaca or Yahoo Finance

### Stock Lists
- **7 default groups**: Top 20, Technology, Energy, Financials, Healthcare, Consumer, Industrials
- **Dropdown selector** — choose a list from the dropdown, stocks load instantly
- **Search any ticker** — filters loaded stocks, then fetches unknown symbols live
- **Full CRUD via browser UI** — create lists, add/remove stocks, delete lists
- **Persisted in SQLite** — survives container restarts via Docker volume
- **GitHub sync** — push/pull lists as JSON to any GitHub repo

### API Keys
All keys configurable in the browser via ⚙ settings — no server restart needed:
- **Alpaca** — real-time prices, charts, options, news
- **Finnhub** — company fundamentals & news (optional)
- **AI provider** — select provider, model, and enter API key

---

## Quick Start

### Docker (recommended)

```bash
git clone git@github.com:protoscience/winfinity.git
cd winfinity
cp .env.example .env
# Optional: add Alpaca / Finnhub keys to .env
docker build -t winfinity .
docker run -d --name winfinity -p 8447:5000 \
  -v winfinity_data:/app/data \
  -e FINNHUB_API_KEY=your_key \
  -e ALPACA_API_KEY=your_key \
  -e ALPACA_API_SECRET=your_secret \
  winfinity
```

Open **http://localhost:8447** in your browser.

### Local (Python)

```bash
git clone git@github.com:protoscience/winfinity.git
cd winfinity
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Open **http://localhost:5000**.

---

## Redeploy after updates

```bash
git pull origin master
docker rm -f winfinity
docker build -t winfinity .
docker run -d --name winfinity -p 8447:5000 \
  -v winfinity_data:/app/data \
  winfinity
```

The `winfinity_data` volume (SQLite DB) is preserved — your custom lists are never lost on redeploy.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FINNHUB_API_KEY` | *(empty)* | Finnhub API key — can also be set in browser |
| `ALPACA_API_KEY` | *(empty)* | Alpaca API key — can also be set in browser |
| `ALPACA_API_SECRET` | *(empty)* | Alpaca API secret — can also be set in browser |
| `PORT` | `5000` | Port the Flask/Gunicorn server listens on |
| `DB_PATH` | `./data/winfinity.db` | SQLite database path |

### Setting Up AI Analysis

1. Click ⚙ **Settings** in the top-right
2. Scroll to **AI Analysis** section
3. Select a **Provider** (e.g. Google Gemini, OpenAI, Anthropic)
4. Select a **Model**
5. Enter your **API key** (get one from the provider's console)
6. Click **Save**
7. Select any stock — predictions and options strategies will now use AI

For **Google Gemini with OAuth**: select the OAuth tab, enter your Google Cloud Client ID, and click "Sign in with Google". Requires the `generative-language` scope.

---

## Managing Stock Lists

Click the **✏ pencil icon** next to "Markets" in the sidebar to open the list manager.

### SQLite Tab
| Action | Steps |
|---|---|
| Create a list | Type a name → **+ New List** |
| Add a stock | Click ✏ on a list row → type symbol → **Add** (or Enter) |
| Remove a stock | Click **×** on a stock chip |
| Delete a list | Click **✕** on the list row header |

### GitHub Sync Tab
1. Create a GitHub repo (public or private)
2. Generate a [Personal Access Token](https://github.com/settings/tokens) with **`repo`** scope
3. Fill in: token, `owner/repo`, branch, file path
4. **Push / Pull** to sync lists across machines

---

## API Reference

### Market Data

| Endpoint | Description |
|---|---|
| `GET /api/stocks?symbols=AAPL,MSFT` | Price, change %, P/E, volume |
| `GET /api/chart/:symbol?period=6mo` | OHLCV candlestick data |
| `GET /api/indicators/:symbol` | RSI, MACD, Ripster EMAs, Bollinger Bands |
| `GET /api/prediction/:symbol` | Statistical 4-week price prediction |
| `GET /api/quote/:symbol` | Real-time quote (Alpaca → Finnhub → yfinance) |
| `GET /api/market-overview` | SPY, VIX, S&P 500, NASDAQ, DOW |
| `GET /api/market-influence` | Sectors, macro indicators, Fear & Greed |
| `GET /api/news` | Market news |
| `GET /api/company-news/:symbol` | Company-specific news with sentiment |
| `GET /api/options-chain/:symbol` | Options chain with GEX, call/put volume |

### AI Analysis

| Endpoint | Description |
|---|---|
| `GET /api/llm/providers` | Available AI providers and models |
| `GET /api/llm-analysis/:symbol` | Server-side AI analysis (cloud providers) |
| `GET /api/ai-context/:symbol` | Prepared prompts for client-side AI (Ollama) |

AI endpoints use request headers: `X-LLM-Provider`, `X-LLM-Model`, `X-LLM-Key`, `X-LLM-Auth-Type`.

### List Management

| Endpoint | Method | Description |
|---|---|---|
| `/api/lists` | GET | All lists with symbols |
| `/api/lists` | POST | Create a list |
| `/api/lists/:id` | PUT | Rename a list |
| `/api/lists/:id` | DELETE | Delete a list |
| `/api/lists/:id/stocks` | POST | Add stock to list |
| `/api/lists/:id/stocks/:symbol` | DELETE | Remove stock |
| `/api/lists/reorder` | POST | Reorder lists |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, Flask, Gunicorn |
| Data | Alpaca Markets API, Finnhub, yfinance |
| AI | OpenAI, Anthropic, Google Gemini, Groq, xAI, Ollama |
| Indicators | NumPy, pandas, scikit-learn |
| Frontend | Vanilla JS, Lightweight Charts v4 |
| Database | SQLite (WAL mode) |
| Container | Docker |

---

## Project Structure

```
winfinity/
├── app.py              # Flask routes and API logic
├── alpaca.py           # Alpaca Markets API client
├── llm.py              # LLM provider helpers (OpenAI, Anthropic, Google, Groq, xAI, Ollama)
├── database.py         # SQLite CRUD for stock lists
├── indicators.py       # RSI, MACD, Ripster EMA, Bollinger Bands
├── options.py          # Options strategy engine
├── predictions.py      # Statistical 4-week price prediction
├── ollama_proxy.py     # Local CORS proxy for Ollama (run on your machine)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── static/
    ├── index.html
    ├── css/style.css
    └── js/main.js
```

---

## License

MIT
