# Winfinity

A self-hosted stock market dashboard with TradingView-style charts, technical indicators, 4-week price predictions, and fully manageable stock lists backed by SQLite with optional GitHub sync.

![Winfinity Dashboard](https://raw.githubusercontent.com/protoscience/winfinity/master/static/dashboard-preview.png)

---

## Features

### Charts & Indicators
- **Candlestick charts** with volume bars (powered by [Lightweight Charts](https://tradingview.github.io/lightweight-charts/))
- **Ripster EMA Cloud** — filled cloud bands between EMA 8/9 (fast) and EMA 34/39 (slow), plus EMA 200 trend filter
- **RSI (14)** and **MACD (12,26,9)** sub-panels, synced to main chart
- **Bollinger Bands** (toggleable overlay)
- **4-week price prediction** overlay (ensemble of linear regression, EMA momentum, trend+volatility)
- Period selector: **1M / 3M / 6M / 1Y**

### Market Data
- **Top market indices** in topbar: SPY, VIX, S&P 500, NASDAQ, DOW — auto-refreshed every 60s
- **SPY candlestick** and **VIX area chart** mini panels
- **Sector performance** (XLK, XLV, XLF, XLE … all 11 sectors) with bar charts
- **Macro indicators**: DXY, 10Y Treasury, Gold, Crude Oil, Bitcoin
- **Fear & Greed** proxy gauge (VIX-derived)
- **Market news** and **company-specific news** (Finnhub + Yahoo Finance fallback)
- **P/E ratio** displayed per stock

### Stock Lists
- **7 default groups**: Top 20, Technology, Energy, Financials, Healthcare, Consumer, Industrials
- **Collapsible sidebar** — groups load lazily on expand
- **Full CRUD via browser UI** — create lists, add/remove stocks, delete lists
- **Persisted in SQLite** — survives container restarts via Docker volume
- **GitHub sync** — push/pull your lists as `winfinity-lists.json` to any GitHub repo for version history and cross-machine sharing

### API Keys
- **Finnhub API key** configurable directly in the browser (⚙ settings icon, stored in `localStorage`) — no server restart needed
- Falls back gracefully to Yahoo Finance when no Finnhub key is set

---

## Quick Start

### Docker (recommended)

```bash
git clone git@github.com:protoscience/winfinity.git
cd winfinity
cp .env.example .env
# Optional: add your Finnhub key to .env
docker compose up --build
```

Open **http://localhost** in your browser.

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

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FINNHUB_API_KEY` | *(empty)* | Finnhub API key — can also be set in the browser UI |
| `PORT` | `5000` | Port the Flask server listens on |
| `DB_PATH` | `./data/winfinity.db` | SQLite database path |

### Finnhub API Key

A free Finnhub key unlocks real-time quotes, company news, and market news. Get one at [finnhub.io](https://finnhub.io).

You can set it:
1. **In the browser** — click the ⚙ icon (top-right), paste the key, click Save
2. **Via `.env` file** — `FINNHUB_API_KEY=your_key_here`
3. **Via Docker** — `FINNHUB_API_KEY=your_key docker compose up`

Without a key the app still works fully using Yahoo Finance.

---

## Managing Stock Lists

Click the **✏ pencil icon** next to "Markets" in the sidebar to open the list manager.

| Action | Steps |
|---|---|
| Create a list | Type a name → **+ New List** |
| Add a stock | Click ✏ on a list row → type symbol → **Add** (or press Enter) |
| Remove a stock | Click **×** on a stock chip |
| Delete a list | Click **✕** on the list row header |

### GitHub Sync

Keep your lists version-controlled and synced across machines.

1. Create a GitHub repo (public or private)
2. Generate a [Personal Access Token](https://github.com/settings/tokens) with **`repo`** scope
3. In the list manager → expand **GitHub Sync**
4. Fill in: token, `owner/repo`, branch (`main`), file path (`winfinity-lists.json`)
5. Click **Push to GitHub** — your lists are saved as JSON in the repo
6. On another machine: Pull from GitHub to restore all lists

---

## API Reference

### Market Data

| Endpoint | Description |
|---|---|
| `GET /api/stocks?symbols=AAPL,MSFT` | Price, change %, P/E, volume for given symbols (defaults to Top 20) |
| `GET /api/chart/:symbol?period=6mo` | OHLCV candlestick data (`1mo/3mo/6mo/1y/2y/5y`) |
| `GET /api/indicators/:symbol` | RSI, MACD, Ripster EMAs, Bollinger Bands |
| `GET /api/prediction/:symbol` | 4-week price prediction with weekly targets |
| `GET /api/quote/:symbol` | Real-time quote (Finnhub → yfinance fallback) |
| `GET /api/market-overview` | SPY, VIX, S&P 500, NASDAQ, DOW |
| `GET /api/market-influence` | Sector performance, macro indicators, Fear & Greed |
| `GET /api/news` | Market news |
| `GET /api/company-news/:symbol` | Company-specific news |

### List Management

| Endpoint | Method | Description |
|---|---|---|
| `/api/lists` | GET | All lists with symbols |
| `/api/lists` | POST `{"name":"..."}` | Create a list |
| `/api/lists/:id` | PUT `{"name":"..."}` | Rename a list |
| `/api/lists/:id` | DELETE | Delete a list |
| `/api/lists/:id/stocks` | POST `{"symbol":"..."}` | Add stock to list |
| `/api/lists/:id/stocks/:symbol` | DELETE | Remove stock from list |

### GitHub Sync

| Endpoint | Method | Headers | Description |
|---|---|---|---|
| `/api/github/push` | POST | `X-Github-Token`, `X-Github-Repo`, `X-Github-Branch`, `X-Github-Path` | Push lists to GitHub |
| `/api/github/pull` | POST | same | Pull lists from GitHub and replace local DB |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, Flask, Gunicorn |
| Data | yfinance, Finnhub REST API |
| Indicators | NumPy, pandas, scikit-learn |
| Frontend | Vanilla JS, Lightweight Charts v4 |
| Database | SQLite (WAL mode) |
| Container | Docker, Docker Compose |

---

## Project Structure

```
winfinity/
├── app.py            # Flask routes and API logic
├── database.py       # SQLite CRUD for stock lists
├── indicators.py     # RSI, MACD, Ripster EMA, Bollinger Bands
├── predictions.py    # 4-week ensemble price prediction
├── requirements.txt  # Python dependencies
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
