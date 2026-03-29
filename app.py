import base64
import json
import os
import time
import threading
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from flask import Flask, jsonify, send_from_directory, request as freq
from flask_cors import CORS
from dotenv import load_dotenv

from indicators import get_all_indicators
from predictions import predict_next_4_weeks
from database import (
    init_db, get_all_lists, get_list,
    create_list, rename_list, reorder_lists, delete_list,
    add_stock, remove_stock, export_lists, import_lists,
)

load_dotenv()
init_db()

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

FINNHUB_API_KEY = os.environ.get('FINNHUB_API_KEY', '')
FINNHUB_BASE = 'https://finnhub.io/api/v1'

TOP_20_STOCKS = [
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL',
    'META', 'TSLA', 'BRK-B', 'LLY', 'AVGO',
    'JPM', 'UNH', 'XOM', 'JNJ', 'V',
    'MA', 'PG', 'HD', 'COST', 'ABBV'
]

_cache: dict = {}
_cache_time: dict = {}


def cached(key, fn, ttl=60):
    now = time.time()
    if key in _cache and now - _cache_time.get(key, 0) < ttl:
        return _cache[key]
    val = fn()
    _cache[key] = val
    _cache_time[key] = now
    return val


def get_finnhub_key() -> str:
    """Return Finnhub key: request header takes priority over env var."""
    return freq.headers.get('X-Finnhub-Key', '').strip() or FINNHUB_API_KEY


def finnhub_get(path: str, params: dict = None) -> dict:
    key = get_finnhub_key()
    if not key:
        return {}
    p = params or {}
    p['token'] = key
    try:
        r = requests.get(f'{FINNHUB_BASE}{path}', params=p, timeout=8)
        return r.json() if r.ok else {}
    except Exception:
        return {}


def get_yf_ticker(symbol: str):
    t = yf.Ticker(symbol)
    return t


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/stocks')
def api_stocks():
    """Stocks with price, change, P/E, volume. Accepts ?symbols=A,B,C or defaults to top 20."""
    raw = freq.args.get('symbols', '')
    symbols = [s.strip().upper() for s in raw.split(',') if s.strip()] if raw else TOP_20_STOCKS
    # Safety: cap at 40 symbols per request
    symbols = symbols[:40]
    cache_key = 'stocks_' + '_'.join(symbols)

    def fetch():
        result = []
        # Batch download price history — single request, far less likely to be rate-limited
        try:
            hist_batch = yf.download(
                ' '.join(symbols), period='5d', interval='1d',
                auto_adjust=True, progress=False, threads=True,
            )
        except Exception:
            hist_batch = pd.DataFrame()

        for sym in symbols:
            try:
                # Extract close prices from batch download
                price, prev_close = 0.0, 0.0
                if not hist_batch.empty:
                    try:
                        if len(symbols) == 1:
                            closes = hist_batch['Close'].dropna()
                        else:
                            closes = hist_batch['Close'][sym].dropna()
                        if len(closes) >= 2:
                            price = float(closes.iloc[-1])
                            prev_close = float(closes.iloc[-2])
                        elif len(closes) == 1:
                            price = float(closes.iloc[-1])
                            prev_close = price
                    except Exception:
                        pass

                change = price - prev_close
                change_pct = (change / prev_close * 100) if prev_close else 0

                # Per-ticker info for PE/name/sector (cached separately, non-critical)
                pe = market_cap = volume = None
                sector = 'N/A'
                name = sym
                try:
                    ticker = get_yf_ticker(sym)
                    full_info = ticker.info
                    pe = full_info.get('trailingPE') or full_info.get('forwardPE') or None
                    market_cap = full_info.get('marketCap') or 0
                    volume = full_info.get('volume') or full_info.get('regularMarketVolume') or 0
                    sector = full_info.get('sector', 'N/A')
                    name = full_info.get('shortName') or full_info.get('longName') or sym
                except Exception:
                    pass

                if price > 0:
                    result.append({
                        'symbol': sym,
                        'name': name,
                        'price': round(price, 2),
                        'change': round(change, 2),
                        'change_pct': round(change_pct, 2),
                        'pe': round(pe, 2) if pe else None,
                        'market_cap': market_cap,
                        'volume': volume,
                        'sector': sector,
                    })
                else:
                    result.append({'symbol': sym, 'error': 'no price data'})
            except Exception as e:
                result.append({'symbol': sym, 'error': str(e)})

        return result

    data = cached(cache_key, fetch, ttl=120)
    return jsonify(data)


VALID_PERIODS = {'1mo', '3mo', '6mo', '1y', '2y', '5y'}

@app.route('/api/chart/<symbol>')
def api_chart(symbol: str):
    """OHLCV candlestick data for a symbol."""
    symbol = symbol.upper()
    period = freq.args.get('period', '6mo')
    if period not in VALID_PERIODS:
        period = '6mo'

    def fetch():
        ticker = get_yf_ticker(symbol)
        hist = ticker.history(period=period, interval='1d', auto_adjust=True)
        if hist.empty:
            return []
        candles = []
        for ts, row in hist.iterrows():
            t = int(ts.timestamp())
            candles.append({
                'time': t,
                'open': round(float(row['Open']), 4),
                'high': round(float(row['High']), 4),
                'low': round(float(row['Low']), 4),
                'close': round(float(row['Close']), 4),
                'volume': int(row['Volume']),
            })
        return candles

    data = cached(f'chart_{symbol}_{period}', fetch, ttl=300)
    return jsonify(data)


@app.route('/api/indicators/<symbol>')
def api_indicators(symbol: str):
    """RSI, MACD, Ripster EMA Cloud for a symbol."""
    symbol = symbol.upper()

    def fetch():
        ticker = get_yf_ticker(symbol)
        hist = ticker.history(period='1y', interval='1d', auto_adjust=True)
        if hist.empty:
            return {'error': 'No data'}
        return get_all_indicators(hist)

    data = cached(f'indicators_{symbol}', fetch, ttl=300)
    return jsonify(data)


@app.route('/api/prediction/<symbol>')
def api_prediction(symbol: str):
    """4-week price prediction."""
    symbol = symbol.upper()

    def fetch():
        ticker = get_yf_ticker(symbol)
        hist = ticker.history(period='1y', interval='1d', auto_adjust=True)
        if hist.empty:
            return {'error': 'No data'}
        return predict_next_4_weeks(hist, symbol)

    data = cached(f'prediction_{symbol}', fetch, ttl=3600)
    return jsonify(data)


@app.route('/api/quote/<symbol>')
def api_quote(symbol: str):
    """Real-time quote via Finnhub (fallback: yfinance)."""
    symbol = symbol.upper()

    def fetch():
        # Try Finnhub first
        if get_finnhub_key():
            q = finnhub_get('/quote', {'symbol': symbol})
            if q and q.get('c'):
                return {
                    'symbol': symbol,
                    'price': q.get('c'),
                    'change': q.get('d'),
                    'change_pct': q.get('dp'),
                    'high': q.get('h'),
                    'low': q.get('l'),
                    'open': q.get('o'),
                    'prev_close': q.get('pc'),
                    'timestamp': q.get('t'),
                    'source': 'finnhub',
                }
        # Fallback: yfinance
        ticker = get_yf_ticker(symbol)
        info = ticker.fast_info
        price = float(info.last_price) if hasattr(info, 'last_price') and info.last_price else 0
        prev = float(info.previous_close) if hasattr(info, 'previous_close') and info.previous_close else price
        change = price - prev
        return {
            'symbol': symbol,
            'price': round(price, 2),
            'change': round(change, 2),
            'change_pct': round(change / prev * 100 if prev else 0, 2),
            'source': 'yfinance',
        }

    data = cached(f'quote_{symbol}', fetch, ttl=15)
    return jsonify(data)


@app.route('/api/market-overview')
def api_market_overview():
    """SPY and VIX overview."""
    def fetch():
        result = {}
        for sym in ['SPY', '^VIX', '^GSPC', '^IXIC', '^DJI']:
            try:
                ticker = get_yf_ticker(sym)
                hist = ticker.history(period='2d', interval='1d', auto_adjust=True)
                if len(hist) >= 2:
                    price = float(hist['Close'].iloc[-1])
                    prev = float(hist['Close'].iloc[-2])
                    change = price - prev
                    result[sym] = {
                        'price': round(price, 2),
                        'change': round(change, 2),
                        'change_pct': round(change / prev * 100, 2),
                    }
            except Exception:
                pass
        return result

    data = cached('market_overview', fetch, ttl=60)
    return jsonify(data)


@app.route('/api/spy-chart')
def api_spy_chart():
    """SPY chart with indicators for the overview panel."""
    def fetch():
        ticker = get_yf_ticker('SPY')
        hist = ticker.history(period='6mo', interval='1d', auto_adjust=True)
        if hist.empty:
            return {}
        candles = []
        for ts, row in hist.iterrows():
            candles.append({
                'time': int(ts.timestamp()),
                'open': round(float(row['Open']), 2),
                'high': round(float(row['High']), 2),
                'low': round(float(row['Low']), 2),
                'close': round(float(row['Close']), 2),
                'volume': int(row['Volume']),
            })
        indicators = get_all_indicators(hist)
        return {'candles': candles, 'indicators': indicators}

    data = cached('spy_chart', fetch, ttl=300)
    return jsonify(data)


@app.route('/api/vix-chart')
def api_vix_chart():
    """VIX chart."""
    def fetch():
        ticker = get_yf_ticker('^VIX')
        hist = ticker.history(period='6mo', interval='1d', auto_adjust=True)
        if hist.empty:
            return {}
        series = []
        for ts, row in hist.iterrows():
            series.append({
                'time': int(ts.timestamp()),
                'value': round(float(row['Close']), 2),
            })
        indicators = get_all_indicators(hist)
        return {'series': series, 'indicators': indicators}

    data = cached('vix_chart', fetch, ttl=300)
    return jsonify(data)


@app.route('/api/news')
def api_news():
    """Market catalysts – top market news from Finnhub + Yahoo Finance."""
    def fetch():
        articles = []

        # Finnhub market news
        if get_finnhub_key():
            news = finnhub_get('/news', {'category': 'general'})
            if isinstance(news, list):
                for item in news[:15]:
                    articles.append({
                        'headline': item.get('headline', ''),
                        'summary': item.get('summary', ''),
                        'url': item.get('url', ''),
                        'source': item.get('source', 'Finnhub'),
                        'datetime': item.get('datetime', 0),
                        'category': item.get('category', 'general'),
                        'image': item.get('image', ''),
                    })

        # Supplementary: yfinance news for SPY
        if len(articles) < 10:
            try:
                spy = yf.Ticker('SPY')
                yf_news = spy.news or []
                for item in yf_news[:10]:
                    content = item.get('content', {})
                    articles.append({
                        'headline': content.get('title', item.get('title', '')),
                        'summary': content.get('summary', ''),
                        'url': content.get('canonicalUrl', {}).get('url', ''),
                        'source': content.get('provider', {}).get('displayName', 'Yahoo Finance'),
                        'datetime': int(datetime.fromisoformat(
                            content.get('pubDate', datetime.now().isoformat()).replace('Z', '+00:00')
                        ).timestamp()) if content.get('pubDate') else 0,
                        'category': 'market',
                        'image': '',
                    })
            except Exception:
                pass

        articles.sort(key=lambda x: x.get('datetime', 0), reverse=True)
        return articles[:20]

    data = cached('news', fetch, ttl=300)
    return jsonify(data)


@app.route('/api/company-news/<symbol>')
def api_company_news(symbol: str):
    """Company-specific news for a symbol."""
    symbol = symbol.upper()

    def fetch():
        articles = []
        if get_finnhub_key():
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            news = finnhub_get('/company-news', {
                'symbol': symbol, 'from': from_date, 'to': to_date
            })
            if isinstance(news, list):
                for item in news[:10]:
                    articles.append({
                        'headline': item.get('headline', ''),
                        'summary': item.get('summary', ''),
                        'url': item.get('url', ''),
                        'source': item.get('source', ''),
                        'datetime': item.get('datetime', 0),
                        'image': item.get('image', ''),
                    })
        # Fallback: yfinance
        if not articles:
            try:
                t = yf.Ticker(symbol)
                for item in (t.news or [])[:8]:
                    content = item.get('content', {})
                    articles.append({
                        'headline': content.get('title', ''),
                        'summary': content.get('summary', ''),
                        'url': content.get('canonicalUrl', {}).get('url', ''),
                        'source': content.get('provider', {}).get('displayName', 'Yahoo Finance'),
                        'datetime': 0,
                        'image': '',
                    })
            except Exception:
                pass
        return articles

    data = cached(f'cnews_{symbol}', fetch, ttl=600)
    return jsonify(data)


@app.route('/api/market-influence')
def api_market_influence():
    """Real-time market influences: sector performance, fear/greed proxy, macro."""
    def fetch():
        sector_etfs = {
            'Technology': 'XLK',
            'Healthcare': 'XLV',
            'Financials': 'XLF',
            'Energy': 'XLE',
            'Consumer Disc.': 'XLY',
            'Industrials': 'XLI',
            'Materials': 'XLB',
            'Utilities': 'XLU',
            'Real Estate': 'XLRE',
            'Comm. Services': 'XLC',
            'Consumer Staples': 'XLP',
        }
        macro_symbols = {
            'DXY (USD)': 'DX-Y.NYB',
            '10Y Treasury': '^TNX',
            'Gold': 'GC=F',
            'Crude Oil': 'CL=F',
            'Bitcoin': 'BTC-USD',
        }

        sectors = []
        for name, sym in sector_etfs.items():
            try:
                t = yf.Ticker(sym)
                h = t.history(period='2d', interval='1d', auto_adjust=True)
                if len(h) >= 2:
                    p = float(h['Close'].iloc[-1])
                    prev = float(h['Close'].iloc[-2])
                    chg = (p - prev) / prev * 100
                    sectors.append({'name': name, 'symbol': sym, 'change_pct': round(chg, 2)})
            except Exception:
                pass

        macro = []
        for name, sym in macro_symbols.items():
            try:
                t = yf.Ticker(sym)
                h = t.history(period='2d', interval='1d', auto_adjust=True)
                if len(h) >= 2:
                    p = float(h['Close'].iloc[-1])
                    prev = float(h['Close'].iloc[-2])
                    chg = (p - prev) / prev * 100
                    macro.append({'name': name, 'symbol': sym, 'price': round(p, 2), 'change_pct': round(chg, 2)})
            except Exception:
                pass

        # Fear & Greed proxy: VIX level
        vix_val = None
        try:
            vix = yf.Ticker('^VIX')
            vh = vix.history(period='1d', interval='1d', auto_adjust=True)
            if not vh.empty:
                vix_val = round(float(vh['Close'].iloc[-1]), 2)
        except Exception:
            pass

        fg_score = None
        fg_label = None
        if vix_val:
            # Invert VIX to Fear/Greed 0-100
            fg_score = max(0, min(100, int(100 - (vix_val - 10) * 2.5)))
            if fg_score >= 75:
                fg_label = 'Extreme Greed'
            elif fg_score >= 55:
                fg_label = 'Greed'
            elif fg_score >= 45:
                fg_label = 'Neutral'
            elif fg_score >= 25:
                fg_label = 'Fear'
            else:
                fg_label = 'Extreme Fear'

        return {
            'sectors': sorted(sectors, key=lambda x: x['change_pct'], reverse=True),
            'macro': macro,
            'fear_greed': {'score': fg_score, 'label': fg_label, 'vix': vix_val},
        }

    data = cached('market_influence', fetch, ttl=120)
    return jsonify(data)


# ---------------------------------------------------------------------------
# List management endpoints
# ---------------------------------------------------------------------------

@app.route('/api/lists', methods=['GET'])
def api_get_lists():
    return jsonify(get_all_lists())


@app.route('/api/lists', methods=['POST'])
def api_create_list():
    body = freq.get_json(silent=True) or {}
    name = (body.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    try:
        lst = create_list(name)
        return jsonify(lst), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/lists/<int:list_id>', methods=['PUT'])
def api_rename_list(list_id: int):
    body = freq.get_json(silent=True) or {}
    name = (body.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name required'}), 400
    lst = rename_list(list_id, name)
    return (jsonify(lst), 200) if lst else (jsonify({'error': 'not found'}), 404)


@app.route('/api/lists/reorder', methods=['POST'])
def api_reorder_lists():
    body = freq.get_json(silent=True) or {}
    order = body.get('order', [])
    if not isinstance(order, list):
        return jsonify({'error': 'order must be array of ids'}), 400
    return jsonify(reorder_lists(order))


@app.route('/api/lists/<int:list_id>', methods=['DELETE'])
def api_delete_list(list_id: int):
    if delete_list(list_id):
        return jsonify({'ok': True})
    return jsonify({'error': 'not found'}), 404


@app.route('/api/lists/<int:list_id>/stocks', methods=['POST'])
def api_add_stock(list_id: int):
    body = freq.get_json(silent=True) or {}
    symbol = (body.get('symbol') or '').strip().upper()
    if not symbol:
        return jsonify({'error': 'symbol required'}), 400
    lst = add_stock(list_id, symbol)
    return (jsonify(lst), 200) if lst else (jsonify({'error': 'list not found'}), 404)


@app.route('/api/lists/<int:list_id>/stocks/<symbol>', methods=['DELETE'])
def api_remove_stock(list_id: int, symbol: str):
    lst = remove_stock(list_id, symbol.upper())
    return (jsonify(lst), 200) if lst else (jsonify({'error': 'not found'}), 404)


# ---------------------------------------------------------------------------
# GitHub sync endpoints
# ---------------------------------------------------------------------------

def _gh_headers(token: str) -> dict:
    return {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
    }


@app.route('/api/github/push', methods=['POST'])
def api_github_push():
    token = freq.headers.get('X-Github-Token', '').strip()
    repo  = freq.headers.get('X-Github-Repo', '').strip()
    branch = freq.headers.get('X-Github-Branch', 'main').strip()
    path  = freq.headers.get('X-Github-Path', 'winfinity-lists.json').strip()

    if not token or not repo:
        return jsonify({'error': 'X-Github-Token and X-Github-Repo headers required'}), 400

    content = json.dumps(export_lists(), indent=2)
    content_b64 = base64.b64encode(content.encode()).decode()

    url = f'https://api.github.com/repos/{repo}/contents/{path}'
    headers = _gh_headers(token)

    # Get existing SHA (needed for update)
    r = requests.get(url, headers=headers, params={'ref': branch}, timeout=10)
    sha = r.json().get('sha') if r.ok else None

    payload = {
        'message': f'Update Winfinity stock lists ({datetime.now().strftime("%Y-%m-%d %H:%M")})',
        'content': content_b64,
        'branch': branch,
    }
    if sha:
        payload['sha'] = sha

    r = requests.put(url, headers=headers, json=payload, timeout=10)
    if r.ok:
        return jsonify({'ok': True, 'url': r.json().get('content', {}).get('html_url', '')})
    return jsonify({'error': r.json().get('message', 'GitHub error')}), r.status_code


@app.route('/api/github/pull', methods=['POST'])
def api_github_pull():
    token  = freq.headers.get('X-Github-Token', '').strip()
    repo   = freq.headers.get('X-Github-Repo', '').strip()
    branch = freq.headers.get('X-Github-Branch', 'main').strip()
    path   = freq.headers.get('X-Github-Path', 'winfinity-lists.json').strip()

    if not token or not repo:
        return jsonify({'error': 'X-Github-Token and X-Github-Repo headers required'}), 400

    url = f'https://api.github.com/repos/{repo}/contents/{path}'
    r = requests.get(url, headers=_gh_headers(token), params={'ref': branch}, timeout=10)
    if not r.ok:
        return jsonify({'error': r.json().get('message', 'GitHub error')}), r.status_code

    try:
        content = base64.b64decode(r.json()['content']).decode()
        data = json.loads(content)
        lists = import_lists(data)
        return jsonify({'ok': True, 'lists': lists})
    except Exception as e:
        return jsonify({'error': f'Parse error: {e}'}), 400


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
