# Winfinity

A self-hosted stock market dashboard with TradingView-style charts, technical indicators, 4-week price predictions, and fully manageable stock lists backed by SQLite with optional GitHub sync.

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
- **Search any ticker** — instantly filters loaded stocks, then fetches unknown symbols live from the market
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
docker-compose up --build -d
```

Open **http://localhost:8447** in your browser.

> **Note:** Port 8447 is the default. Change the `ports` value in `docker-compose.yml` if needed.

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
docker-compose down
docker-compose up --build -d
```

The `winfinity_data` volume (SQLite DB) is preserved — your custom lists are never lost on redeploy.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FINNHUB_API_KEY` | *(empty)* | Finnhub API key — can also be set in the browser UI |
| `PORT` | `5000` | Port the Flask/Gunicorn server listens on inside the container |
| `DB_PATH` | `./data/winfinity.db` | SQLite database path |

### Finnhub API Key

A free Finnhub key unlocks real-time quotes, company news, and market news. Get one at [finnhub.io](https://finnhub.io).

You can set it three ways:
1. **In the browser** — click the ⚙ icon (top-right), paste the key, click Save
2. **Via `.env` file** — `FINNHUB_API_KEY=your_key_here`
3. **Via Docker** — `FINNHUB_API_KEY=your_key docker-compose up -d`

Without a key the app works fully using Yahoo Finance.

---

## Managing Stock Lists

Click the **✏ pencil icon** next to "Markets" in the sidebar to open the list manager. It has two tabs:

### SQLite Tab
Shows DB info (filename, list count, total stocks) and full list management:

| Action | Steps |
|---|---|
| Create a list | Type a name → **+ New List** |
| Add a stock | Click ✏ on a list row → type symbol → **Add** (or Enter) |
| Remove a stock | Click **×** on a stock chip |
| Delete a list | Click **✕** on the list row header |

New lists appear immediately in the sidebar and auto-expand.

### GitHub Sync Tab
Keep your lists version-controlled and synced across machines.

1. Create a GitHub repo (public or private)
2. Generate a [Personal Access Token](https://github.com/settings/tokens) with **`repo`** scope
3. Fill in: token, `owner/repo`, branch (`main`), file path (`winfinity-lists.json`)
4. **Push to GitHub** — lists saved as JSON in your repo
5. On another machine: **Pull from GitHub** to restore all lists into SQLite

---

## API Reference

### Market Data

| Endpoint | Description |
|---|---|
| `GET /api/stocks?symbols=AAPL,MSFT` | Price, change %, P/E, volume (defaults to Top 20) |
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
| `/api/lists/reorder` | POST `{"order":[1,2,3]}` | Reorder lists |

### GitHub Sync

| Endpoint | Method | Required Headers |
|---|---|---|
| `/api/github/push` | POST | `X-Github-Token`, `X-Github-Repo`, `X-Github-Branch`, `X-Github-Path` |
| `/api/github/pull` | POST | same |

---

## Troubleshooting

### Lists not loading / blank sidebar
Yahoo Finance rate-limits server IPs (HTTP 429). The app uses batched `yf.download()` calls to minimise requests. If you still see empty lists:
- Wait 30–60 seconds and refresh — Yahoo lifts rate limits quickly
- Add a Finnhub API key (⚙ settings) for real-time quote fallback
- Check container logs: `docker logs winfinity`

### Port already in use
Edit `docker-compose.yml` and change the host port:
```yaml
ports:
  - "YOUR_PORT:5000"
```
Then `docker-compose down && docker-compose up -d`.

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
