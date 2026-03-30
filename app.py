import base64
import json
import os
import time
import threading
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from flask import Flask, jsonify, send_from_directory, request as freq
from flask_cors import CORS
from dotenv import load_dotenv

import re as _re
import alpaca as alp
import llm as llm_mod
from indicators import get_all_indicators
from predictions import predict_next_4_weeks
from options import build_options_report
from database import (
    init_db, get_all_lists, get_list,
    create_list, rename_list, reorder_lists, delete_list,
    add_stock, remove_stock, export_lists, import_lists,
)

load_dotenv()
init_db()

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

FINNHUB_API_KEY   = os.environ.get('FINNHUB_API_KEY', '')
FINNHUB_BASE      = 'https://finnhub.io/api/v1'
ALPACA_API_KEY    = os.environ.get('ALPACA_API_KEY', '')
ALPACA_API_SECRET = os.environ.get('ALPACA_API_SECRET', '')

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


def get_alpaca_creds() -> tuple:
    """Return (key, secret) — request header > env var."""
    key    = freq.headers.get('X-Alpaca-Key', '').strip()    or ALPACA_API_KEY
    secret = freq.headers.get('X-Alpaca-Secret', '').strip() or ALPACA_API_SECRET
    return key, secret


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
        alp_key, alp_secret = get_alpaca_creds()

        # ── 1. Batch prices: Alpaca snapshots (fast) → yfinance fallback ──
        price_map: dict = {}
        if alp_key and alp_secret:
            price_map = alp.get_snapshots(alp_key, alp_secret, symbols)

        # yfinance fallback for any missing symbols
        missing = [s for s in symbols if s not in price_map]
        if missing:
            try:
                hist_batch = yf.download(
                    ' '.join(missing), period='5d', interval='1d',
                    auto_adjust=True, progress=False, threads=True,
                )
                for sym in missing:
                    try:
                        if len(missing) == 1:
                            closes = hist_batch['Close'].dropna()
                        else:
                            closes = hist_batch['Close'][sym].dropna()
                        if len(closes) >= 2:
                            p = float(closes.iloc[-1])
                            pc = float(closes.iloc[-2])
                        elif len(closes) == 1:
                            p = float(closes.iloc[0])
                            pc = p
                        else:
                            continue
                        price_map[sym] = {
                            'price': round(p, 2),
                            'prev_close': round(pc, 2),
                            'change': round(p - pc, 2),
                            'change_pct': round((p - pc) / pc * 100 if pc else 0, 2),
                            'volume': 0,
                            'source': 'yfinance',
                        }
                    except Exception:
                        pass
            except Exception:
                pass

        result = []
        for sym in symbols:
            try:
                snap = price_map.get(sym, {})
                price      = snap.get('price', 0)
                change     = snap.get('change', 0)
                change_pct = snap.get('change_pct', 0)
                volume     = snap.get('volume', 0)

                # Per-ticker fundamentals from yfinance (PE/name/sector — not in Alpaca)
                pe = market_cap = None
                sector = 'N/A'
                name = sym
                try:
                    ticker = get_yf_ticker(sym)
                    full_info = ticker.info
                    pe = full_info.get('trailingPE') or full_info.get('forwardPE') or None
                    market_cap = full_info.get('marketCap') or 0
                    if not volume:
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


VALID_PERIODS = {'1d', '1wk', '1mo', '3mo', '6mo', '1y', '2y', '5y'}


def _hist_to_candles(hist) -> list[dict]:
    """Convert a pandas DataFrame (yfinance history) to candle dicts."""
    if hist is None or hist.empty:
        return []
    candles = []
    for ts, row in hist.iterrows():
        candles.append({
            'time': int(ts.timestamp()),
            'open': round(float(row['Open']), 4),
            'high': round(float(row['High']), 4),
            'low': round(float(row['Low']), 4),
            'close': round(float(row['Close']), 4),
            'volume': int(row['Volume']),
        })
    return candles


def _fetch_alpaca_intraday(key, secret, symbol, days, timeframe, extended=False):
    """Fetch intraday bars from Alpaca for 1d/1wk periods."""
    start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%dT00:00:00Z')
    feed = 'sip' if extended else 'iex'
    raw = requests.get(
        f'{alp.ALPACA_DATA_URL}/v2/stocks/{symbol}/bars',
        headers=alp._headers(key, secret),
        params={'timeframe': timeframe, 'start': start, 'limit': 10000,
                'adjustment': 'all', 'feed': feed},
        timeout=10,
    )
    if not raw.ok:
        return []
    data = raw.json()
    bars_list = data.get('bars', [])
    bars = []
    for b in bars_list:
        try:
            t = int(datetime.fromisoformat(b['t'].replace('Z', '+00:00')).timestamp())
            bars.append({
                'time': t,
                'open': round(float(b['o']), 4),
                'high': round(float(b['h']), 4),
                'low': round(float(b['l']), 4),
                'close': round(float(b['c']), 4),
                'volume': int(b['v']),
            })
        except Exception:
            pass
    # Handle pagination
    while data.get('next_page_token'):
        raw = requests.get(
            f'{alp.ALPACA_DATA_URL}/v2/stocks/{symbol}/bars',
            headers=alp._headers(key, secret),
            params={'timeframe': timeframe, 'start': start, 'limit': 10000,
                    'adjustment': 'all', 'feed': feed,
                    'page_token': data['next_page_token']},
            timeout=10,
        )
        if not raw.ok:
            break
        data = raw.json()
        for b in data.get('bars', []):
            try:
                t = int(datetime.fromisoformat(b['t'].replace('Z', '+00:00')).timestamp())
                bars.append({
                    'time': t,
                    'open': round(float(b['o']), 4),
                    'high': round(float(b['h']), 4),
                    'low': round(float(b['l']), 4),
                    'close': round(float(b['c']), 4),
                    'volume': int(b['v']),
                })
            except Exception:
                pass
    return sorted(bars, key=lambda x: x['time'])


@app.route('/api/chart/<symbol>')
def api_chart(symbol: str):
    """OHLCV candlestick data for a symbol."""
    symbol   = symbol.upper()
    period   = freq.args.get('period', '6mo')
    extended = freq.args.get('extended', '') == '1'
    if period not in VALID_PERIODS:
        period = '6mo'

    # Intraday periods use shorter intervals and cache TTL
    _INTRADAY_PERIODS = {
        '1d':  {'days': 1,  'alpaca_tf': '1Min',  'yf_interval': '1m',  'yf_period': '1d'},
        '1wk': {'days': 7,  'alpaca_tf': '15Min', 'yf_interval': '15m', 'yf_period': '5d'},
    }
    is_intraday = period in _INTRADAY_PERIODS

    def fetch():
        alp_key, alp_secret = get_alpaca_creds()

        if is_intraday:
            cfg = _INTRADAY_PERIODS[period]
            # Alpaca intraday bars
            if alp_key and alp_secret:
                bars = _fetch_alpaca_intraday(alp_key, alp_secret, symbol,
                                              cfg['days'], cfg['alpaca_tf'],
                                              extended)
                if bars:
                    return bars
            # yfinance intraday fallback
            ticker = get_yf_ticker(symbol)
            hist = ticker.history(period=cfg['yf_period'],
                                  interval=cfg['yf_interval'],
                                  auto_adjust=True, prepost=extended)
            return _hist_to_candles(hist)

        # Extended hours: use intraday bars from Alpaca (SIP feed)
        if extended and alp_key and alp_secret:
            bars = alp.get_bars_extended(alp_key, alp_secret, symbol, period)
            if bars:
                return bars

        # Regular hours: try Alpaca daily bars first (faster)
        if alp_key and alp_secret:
            bars = alp.get_bars(alp_key, alp_secret, symbol, period)
            if bars:
                return bars

        # Fallback: yfinance
        ticker = get_yf_ticker(symbol)
        if extended:
            yf_interval = '30m' if period == '1mo' else '1h'
            yf_period   = period if period in ('1mo', '3mo') else '3mo'
            hist = ticker.history(period=yf_period, interval=yf_interval,
                                  auto_adjust=True, prepost=True)
        else:
            hist = ticker.history(period=period, interval='1d', auto_adjust=True)
        return _hist_to_candles(hist)

    cache_ttl = 30 if is_intraday else 300  # 30s cache for intraday, 5min for daily
    cache_key = f'chart_{symbol}_{period}{"_ext" if extended else ""}'
    data = cached(cache_key, fetch, ttl=cache_ttl)
    return jsonify(data)


@app.route('/api/indicators/<symbol>')
def api_indicators(symbol: str):
    """RSI, MACD, Ripster EMA Cloud for a symbol."""
    symbol   = symbol.upper()
    period   = freq.args.get('period', '6mo')
    extended = freq.args.get('extended', '') == '1'
    if period not in VALID_PERIODS:
        period = '6mo'

    _INTRADAY_CFG = {
        '1d':  {'days': 1,  'alpaca_tf': '1Min',  'yf_interval': '1m',  'yf_period': '1d'},
        '1wk': {'days': 7,  'alpaca_tf': '15Min', 'yf_interval': '15m', 'yf_period': '5d'},
    }
    is_intraday = period in _INTRADAY_CFG

    def fetch():
        import pandas as pd
        alp_key, alp_secret = get_alpaca_creds()
        hist = None

        if is_intraday:
            cfg = _INTRADAY_CFG[period]
            # Alpaca intraday bars
            if alp_key and alp_secret:
                bars = _fetch_alpaca_intraday(alp_key, alp_secret, symbol,
                                              cfg['days'], cfg['alpaca_tf'],
                                              extended)
                if bars:
                    df = pd.DataFrame(bars)
                    df['time'] = pd.to_datetime(df['time'], unit='s', utc=True)
                    df = df.set_index('time')
                    df.columns = [c.capitalize() for c in df.columns]
                    hist = df
            # yfinance intraday fallback
            if hist is None or hist.empty:
                ticker = get_yf_ticker(symbol)
                hist = ticker.history(period=cfg['yf_period'],
                                      interval=cfg['yf_interval'],
                                      auto_adjust=True, prepost=extended)
        else:
            # Daily bars — use longer history for better indicator warmup
            lookback = '1y' if period in ('1mo', '3mo', '6mo', '1y') else period
            if alp_key and alp_secret:
                hist = alp.get_bars_df(alp_key, alp_secret, symbol, lookback)
            if hist is None or hist.empty:
                ticker = get_yf_ticker(symbol)
                hist = ticker.history(period=lookback, interval='1d', auto_adjust=True)

        if hist is None or hist.empty:
            return {'error': 'No data'}
        return get_all_indicators(hist)

    cache_ttl = 30 if is_intraday else 300
    data = cached(f'indicators_{symbol}_{period}{"_ext" if extended else ""}', fetch, ttl=cache_ttl)
    return jsonify(data)


@app.route('/api/prediction/<symbol>')
def api_prediction(symbol: str):
    """4-week price prediction."""
    symbol = symbol.upper()

    def fetch():
        alp_key, alp_secret = get_alpaca_creds()
        hist = None
        if alp_key and alp_secret:
            hist = alp.get_bars_df(alp_key, alp_secret, symbol, '1y')
        if hist is None or hist.empty:
            ticker = get_yf_ticker(symbol)
            hist = ticker.history(period='1y', interval='1d', auto_adjust=True)
        if hist is None or hist.empty:
            return {'error': 'No data'}
        return predict_next_4_weeks(hist, symbol)

    data = cached(f'prediction_{symbol}', fetch, ttl=3600)
    return jsonify(data)


@app.route('/api/quote/<symbol>')
def api_quote(symbol: str):
    """Real-time quote — Alpaca → Finnhub → yfinance."""
    symbol = symbol.upper()

    def fetch():
        # 1. Alpaca snapshot (fastest, real-time)
        alp_key, alp_secret = get_alpaca_creds()
        if alp_key and alp_secret:
            snaps = alp.get_snapshots(alp_key, alp_secret, [symbol])
            snap = snaps.get(symbol)
            if snap and snap.get('price'):
                return {
                    'symbol':     symbol,
                    'price':      snap['price'],
                    'change':     snap['change'],
                    'change_pct': snap['change_pct'],
                    'prev_close': snap['prev_close'],
                    'volume':     snap['volume'],
                    'source':     'alpaca',
                }
        # 2. Finnhub
        if get_finnhub_key():
            q = finnhub_get('/quote', {'symbol': symbol})
            if q and q.get('c'):
                return {
                    'symbol':     symbol,
                    'price':      q.get('c'),
                    'change':     q.get('d'),
                    'change_pct': q.get('dp'),
                    'high':       q.get('h'),
                    'low':        q.get('l'),
                    'open':       q.get('o'),
                    'prev_close': q.get('pc'),
                    'timestamp':  q.get('t'),
                    'source':     'finnhub',
                }
        # 3. yfinance fallback
        ticker = get_yf_ticker(symbol)
        info = ticker.fast_info
        price = float(info.last_price) if hasattr(info, 'last_price') and info.last_price else 0
        prev = float(info.previous_close) if hasattr(info, 'previous_close') and info.previous_close else price
        change = price - prev
        return {
            'symbol':     symbol,
            'price':      round(price, 2),
            'change':     round(change, 2),
            'change_pct': round(change / prev * 100 if prev else 0, 2),
            'source':     'yfinance',
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
    period = freq.args.get('period', '6mo')
    if period not in ('1mo', '3mo', '6mo', '1y'):
        period = '6mo'

    def fetch():
        ticker = get_yf_ticker('SPY')
        hist = ticker.history(period=period, interval='1d', auto_adjust=True)
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

    data = cached(f'spy_chart_{period}', fetch, ttl=300)
    return jsonify(data)


@app.route('/api/vix-chart')
def api_vix_chart():
    """VIX chart."""
    period = freq.args.get('period', '6mo')
    if period not in ('1mo', '3mo', '6mo', '1y'):
        period = '6mo'

    def fetch():
        ticker = get_yf_ticker('^VIX')
        hist = ticker.history(period=period, interval='1d', auto_adjust=True)
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

    data = cached(f'vix_chart_{period}', fetch, ttl=300)
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


SECTOR_ETF_MAP = {
    'Technology': 'XLK', 'Information Technology': 'XLK',
    'Healthcare': 'XLV', 'Health Care': 'XLV',
    'Financials': 'XLF', 'Financial Services': 'XLF',
    'Energy': 'XLE',
    'Consumer Cyclical': 'XLY', 'Consumer Discretionary': 'XLY',
    'Consumer Defensive': 'XLP', 'Consumer Staples': 'XLP',
    'Industrials': 'XLI',
    'Basic Materials': 'XLB', 'Materials': 'XLB',
    'Utilities': 'XLU',
    'Real Estate': 'XLRE',
    'Communication Services': 'XLC', 'Comm. Services': 'XLC',
}


def _fetch_news_for(sym: str, limit: int = 8,
                    alp_key: str = '', alp_secret: str = '') -> list:
    """Fetch news: Alpaca (has sentiment) → Finnhub → yfinance."""
    # 1. Alpaca news (preferred — includes sentiment scores)
    if alp_key and alp_secret:
        articles = alp.get_news(alp_key, alp_secret, [sym], limit=limit)
        if articles:
            return articles

    # 2. Finnhub
    articles = []
    if get_finnhub_key():
        to_date   = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        raw = finnhub_get('/company-news', {'symbol': sym, 'from': from_date, 'to': to_date})
        if isinstance(raw, list):
            for item in raw[:limit]:
                articles.append({
                    'headline':  item.get('headline', ''),
                    'summary':   item.get('summary', ''),
                    'url':       item.get('url', ''),
                    'source':    item.get('source', ''),
                    'datetime':  item.get('datetime', 0),
                    'sentiment': None,
                })
    if articles:
        return [a for a in articles if a.get('headline')]

    # 3. yfinance fallback
    try:
        t = yf.Ticker(sym)
        for item in (t.news or [])[:limit]:
            content = item.get('content', {})
            articles.append({
                'headline':  content.get('title', ''),
                'summary':   content.get('summary', ''),
                'url':       content.get('canonicalUrl', {}).get('url', ''),
                'source':    content.get('provider', {}).get('displayName', 'Yahoo Finance'),
                'datetime':  0,
                'sentiment': None,
            })
    except Exception:
        pass
    return [a for a in articles if a.get('headline')]


@app.route('/api/news-feed/<symbol>')
def api_news_feed(symbol: str):
    """Unified 3-tier news feed: company → sector → global."""
    symbol = symbol.upper()

    def fetch():
        alp_key, alp_secret = get_alpaca_creds()

        # ── 1. Company news ───────────────────────────────────────────────
        company = _fetch_news_for(symbol, limit=8, alp_key=alp_key, alp_secret=alp_secret)

        # ── 2. Sector news ────────────────────────────────────────────────
        sector_name = 'N/A'
        sector_etf  = None
        try:
            info = yf.Ticker(symbol).info
            sector_name = info.get('sector', 'N/A')
            sector_etf  = SECTOR_ETF_MAP.get(sector_name)
        except Exception:
            pass

        sector = []
        if sector_etf:
            sector = _fetch_news_for(sector_etf, limit=6, alp_key=alp_key, alp_secret=alp_secret)

        # ── 3. Global / market news ────────────────────────────────────────
        global_news = []
        # Alpaca general market news (no symbol filter = market-wide)
        if alp_key and alp_secret:
            global_news = alp.get_news(alp_key, alp_secret, symbols=None, limit=10)

        if not global_news and get_finnhub_key():
            raw = finnhub_get('/news', {'category': 'general'})
            if isinstance(raw, list):
                for item in raw[:10]:
                    global_news.append({
                        'headline':  item.get('headline', ''),
                        'summary':   item.get('summary', ''),
                        'url':       item.get('url', ''),
                        'source':    item.get('source', 'Finnhub'),
                        'datetime':  item.get('datetime', 0),
                        'sentiment': None,
                    })
        if not global_news:
            try:
                spy = yf.Ticker('SPY')
                for item in (spy.news or [])[:8]:
                    content = item.get('content', {})
                    global_news.append({
                        'headline':  content.get('title', ''),
                        'summary':   content.get('summary', ''),
                        'url':       content.get('canonicalUrl', {}).get('url', ''),
                        'source':    content.get('provider', {}).get('displayName', 'Yahoo Finance'),
                        'datetime':  0,
                        'sentiment': None,
                    })
            except Exception:
                pass
        global_news = [a for a in global_news if a.get('headline')]

        return {
            'symbol':      symbol,
            'sector_name': sector_name,
            'sector_etf':  sector_etf,
            'company':     company,
            'sector':      sector,
            'global':      global_news,
        }

    data = cached(f'newsfeed_{symbol}', fetch, ttl=600)
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


@app.route('/api/options-strategy/<symbol>')
def api_options_strategy(symbol: str):
    """Options strategy report: signal scores + ranked strategies for next 4 weeks."""
    symbol = symbol.upper()

    def fetch():
        alp_key, alp_secret = get_alpaca_creds()
        hist = None
        if alp_key and alp_secret:
            hist = alp.get_bars_df(alp_key, alp_secret, symbol, '1y')
        if hist is None or hist.empty:
            ticker = get_yf_ticker(symbol)
            hist = ticker.history(period='1y', interval='1d', auto_adjust=True)
        if hist is None or hist.empty:
            return {'error': 'No price data'}

        last_price = float(hist['Close'].iloc[-1])

        indicators = get_all_indicators(hist)
        prediction = predict_next_4_weeks(hist, symbol)

        # Gather news: Alpaca (with sentiment) → Finnhub → yfinance
        news = []
        if alp_key and alp_secret:
            raw_news = alp.get_news(alp_key, alp_secret, [symbol], limit=15)
            if raw_news:
                news = [{'headline': n.get('headline', ''), 'summary': n.get('summary', '')}
                        for n in raw_news]
        if not news and get_finnhub_key():
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            raw = finnhub_get('/company-news', {
                'symbol': symbol, 'from': from_date, 'to': to_date
            })
            if isinstance(raw, list):
                news = [{'headline': n.get('headline', ''), 'summary': n.get('summary', '')}
                        for n in raw[:15]]
        if not news:
            try:
                for item in (ticker.news or [])[:10]:
                    content = item.get('content', {})
                    news.append({
                        'headline': content.get('title', ''),
                        'summary': content.get('summary', ''),
                    })
            except Exception:
                pass

        return build_options_report(hist, indicators, prediction, news, symbol, last_price)

    data = cached(f'options_{symbol}', fetch, ttl=1800)
    return jsonify(data)


@app.route('/api/options-chain/<symbol>')
def api_options_chain(symbol: str):
    """Options chain data: call/put volume + OI by strike, plus GEX approximation."""
    symbol = symbol.upper()
    requested_expiry = freq.args.get('expiry', '').strip()

    def fetch(expiry_key):
        # Try Alpaca options chain first (has real greeks)
        alp_key, alp_secret = get_alpaca_creds()
        if alp_key and alp_secret:
            chain = alp.get_options_chain(alp_key, alp_secret, symbol, expiry_key)
            if chain and chain.get('strikes'):
                return chain

        # Fallback: yfinance
        ticker = get_yf_ticker(symbol)
        exps = ticker.options
        if not exps:
            return {'error': 'No options data available'}

        # Keep expiries within next ~6 months
        cutoff = (datetime.now() + timedelta(days=185)).strftime('%Y-%m-%d')
        available = [e for e in exps if e <= cutoff] or list(exps[:12])

        # Pick requested expiry or nearest to 28 days
        if expiry_key and expiry_key in exps:
            nearest = expiry_key
        else:
            target = datetime.now() + timedelta(days=28)
            nearest = min(available, key=lambda e: abs(
                (datetime.strptime(e, '%Y-%m-%d') - target).days
            ))

        try:
            chain = ticker.option_chain(nearest)
        except Exception as e:
            return {'error': f'Options chain unavailable: {e}'}

        try:
            fast = ticker.fast_info
            last_price = float(fast.last_price) if hasattr(fast, 'last_price') and fast.last_price else 0
        except Exception:
            last_price = 0

        calls = chain.calls[['strike', 'volume', 'openInterest', 'impliedVolatility']].copy()
        puts  = chain.puts[['strike', 'volume', 'openInterest', 'impliedVolatility']].copy()
        calls = calls.rename(columns={
            'volume': 'call_vol', 'openInterest': 'call_oi', 'impliedVolatility': 'call_iv'
        })
        puts = puts.rename(columns={
            'volume': 'put_vol', 'openInterest': 'put_oi', 'impliedVolatility': 'put_iv'
        })

        merged = pd.merge(calls, puts, on='strike', how='outer').fillna(0).sort_values('strike')

        # Filter to within ±25% of current price
        if last_price > 0:
            merged = merged[
                (merged['strike'] >= last_price * 0.75) &
                (merged['strike'] <= last_price * 1.25)
            ]

        # Approximate GEX: gamma × OI × price × 100
        # Gamma approximation for near-ATM options using simplified BS d1 approach
        T = max((datetime.strptime(nearest, '%Y-%m-%d') - datetime.now()).days, 1) / 365.0
        r = 0.05  # risk-free rate proxy
        S = last_price if last_price > 0 else 1

        def approx_gamma(strike, iv):
            if iv <= 0 or S <= 0:
                return 0
            try:
                from math import log, sqrt, exp, pi
                d1 = (log(S / strike) + (r + 0.5 * iv**2) * T) / (iv * sqrt(T))
                # Standard normal PDF
                phi = exp(-0.5 * d1**2) / sqrt(2 * pi)
                return phi / (S * iv * sqrt(T))
            except Exception:
                return 0

        gex_oi_list  = []
        gex_vol_list = []
        for _, row in merged.iterrows():
            g_call = approx_gamma(row['strike'], float(row['call_iv']))
            g_put  = approx_gamma(row['strike'], float(row['put_iv']))
            gex_oi  = (float(row['call_oi'])  * g_call - float(row['put_oi'])  * g_put) * S * 100
            gex_vol = (float(row['call_vol']) * g_call - float(row['put_vol']) * g_put) * S * 100
            gex_oi_list.append(round(gex_oi, 0))
            gex_vol_list.append(round(gex_vol, 0))

        return {
            'symbol':             symbol,
            'expiry':             nearest,
            'available_expiries': available,
            'last_price':         round(last_price, 2),
            'strikes':            merged['strike'].tolist(),
            'call_volume':        merged['call_vol'].astype(int).tolist(),
            'put_volume':         merged['put_vol'].astype(int).tolist(),
            'call_oi':            merged['call_oi'].astype(int).tolist(),
            'put_oi':             merged['put_oi'].astype(int).tolist(),
            'gex':                gex_oi_list,
            'gex_vol':            gex_vol_list,
        }

    cache_key = f'optchain_{symbol}_{requested_expiry or "default"}'
    data = cached(cache_key, lambda: fetch(requested_expiry), ttl=1800)
    return jsonify(data)


# ---------------------------------------------------------------------------
# LLM Analysis
# ---------------------------------------------------------------------------

@app.route('/api/llm/providers')
def api_llm_providers():
    return jsonify(llm_mod.PROVIDERS)


def _build_ai_context(symbol: str, alp_key: str, alp_secret: str) -> dict | None:
    """Gather market data and build prompts for AI analysis. Returns None if no price data."""
    hist = None
    if alp_key and alp_secret:
        hist = alp.get_bars_df(alp_key, alp_secret, symbol, '1y')
    if hist is None or hist.empty:
        try:
            hist = get_yf_ticker(symbol).history(period='1y', interval='1d', auto_adjust=True)
        except Exception:
            pass
    if hist is None or hist.empty:
        return None

    last_price = float(hist['Close'].iloc[-1])
    close_20d  = [round(float(v), 2) for v in hist['Close'].tail(20).values]
    high_52    = round(float(hist['High'].max()), 2)
    low_52     = round(float(hist['Low'].min()), 2)
    avg_vol_20 = int(hist['Volume'].tail(20).mean())
    last_vol   = int(hist['Volume'].iloc[-1])

    indicators = get_all_indicators(hist)
    rsi_series = indicators.get('rsi', [])
    last_rsi   = float(rsi_series[-1]['value']) if rsi_series else None
    macd_hist  = indicators.get('macd', {}).get('histogram', [])
    last_macd  = float(macd_hist[-1]['value']) if macd_hist else 0.0

    opts_lines = []
    try:
        opts_data = None
        if alp_key and alp_secret:
            opts_data = alp.get_options_chain(alp_key, alp_secret, symbol)
        if not opts_data:
            ticker = get_yf_ticker(symbol)
            exps = ticker.options
            if exps:
                target  = datetime.now() + timedelta(days=28)
                nearest = min(list(exps[:12]),
                              key=lambda e: abs((datetime.strptime(e, '%Y-%m-%d') - target).days))
                chain = ticker.option_chain(nearest)
                calls = chain.calls[['strike', 'volume', 'openInterest']].fillna(0)
                puts  = chain.puts[['strike', 'volume', 'openInterest']].fillna(0)
                opts_data = {
                    'expiry': nearest,
                    'strikes':     calls['strike'].tolist(),
                    'call_volume': calls['volume'].astype(int).tolist(),
                    'put_volume':  puts['volume'].astype(int).tolist(),
                    'call_oi':     calls['openInterest'].astype(int).tolist(),
                    'put_oi':      puts['openInterest'].astype(int).tolist(),
                    'gex': [],
                }
        if opts_data and opts_data.get('strikes'):
            coi  = sum(opts_data.get('call_oi', []))
            poi  = sum(opts_data.get('put_oi', []))
            cvol = sum(opts_data.get('call_volume', []))
            pvol = sum(opts_data.get('put_volume', []))
            strikes  = opts_data['strikes']
            pain     = [(opts_data.get('call_oi', [])[i] if i < len(opts_data.get('call_oi', [])) else 0) +
                        (opts_data.get('put_oi',  [])[i] if i < len(opts_data.get('put_oi',  [])) else 0)
                        for i in range(len(strikes))]
            max_pain = strikes[pain.index(max(pain))] if pain else 'N/A'
            gex_vals = opts_data.get('gex', [])
            top_gex_str = 'N/A'
            if gex_vals and strikes:
                top3 = sorted(zip(strikes, gex_vals), key=lambda x: abs(x[1]), reverse=True)[:3]
                top_gex_str = ', '.join(f'${s}' for s, _ in top3)
            opts_lines = [
                f'Expiry: {opts_data.get("expiry","N/A")}',
                f'Put/Call OI ratio: {round(poi/coi,2) if coi else 0} | Volume ratio: {round(pvol/cvol,2) if cvol else 0}',
                f'Max pain: ${max_pain}',
                f'Top GEX walls: {top_gex_str}',
            ]
    except Exception:
        pass

    # --- Historical volatility for realistic price bounds ---
    daily_returns = hist['Close'].pct_change().dropna()
    hist_vol_annual = float(daily_returns.std() * np.sqrt(252))  # annualised
    hist_vol_4w     = float(daily_returns.std() * np.sqrt(20))   # 4-week
    avg_daily_return = float(daily_returns.mean())
    # 1-sigma expected range over 4 weeks
    expected_4w_low  = round(last_price * (1 - hist_vol_4w), 2)
    expected_4w_high = round(last_price * (1 + hist_vol_4w), 2)
    # 1-sigma range over 6 months
    hist_vol_6m = float(daily_returns.std() * np.sqrt(126))
    expected_6m_low  = round(last_price * (1 - hist_vol_6m), 2)
    expected_6m_high = round(last_price * (1 + hist_vol_6m), 2)

    # Performance metrics
    pct_1m  = round(float((hist['Close'].iloc[-1] / hist['Close'].iloc[-21] - 1) * 100), 2) if len(hist) > 21 else 0
    pct_3m  = round(float((hist['Close'].iloc[-1] / hist['Close'].iloc[-63] - 1) * 100), 2) if len(hist) > 63 else 0
    pct_6m  = round(float((hist['Close'].iloc[-1] / hist['Close'].iloc[-126] - 1) * 100), 2) if len(hist) > 126 else 0
    pct_1y  = round(float((hist['Close'].iloc[-1] / hist['Close'].iloc[0] - 1) * 100), 2) if len(hist) > 1 else 0

    company_name = symbol
    sector = industry = 'Unknown'
    pe_ratio = forward_pe = peg = market_cap = eps = revenue_growth = 'N/A'
    profit_margin = operating_margin = debt_equity = free_cash_flow = 'N/A'
    book_value = price_to_book = dividend_yield = beta = next_earnings = 'N/A'
    analyst_target = analyst_rec = 'N/A'
    try:
        info = get_yf_ticker(symbol).info
        company_name   = info.get('shortName', symbol)
        sector         = info.get('sector', 'Unknown')
        industry       = info.get('industry', 'Unknown')
        pe_ratio       = round(info.get('trailingPE', 0), 1) or 'N/A'
        fwd_pe_raw     = info.get('forwardPE', None)
        forward_pe     = round(fwd_pe_raw, 1) if fwd_pe_raw else 'N/A'
        peg_raw        = info.get('pegRatio', None)
        peg            = round(peg_raw, 2) if peg_raw else 'N/A'
        market_cap_raw = info.get('marketCap', 0)
        market_cap     = (f'${market_cap_raw/1e9:.1f}B' if market_cap_raw >= 1e9
                          else f'${market_cap_raw/1e6:.0f}M' if market_cap_raw else 'N/A')
        eps            = info.get('trailingEps', 'N/A')
        rev_g          = info.get('revenueGrowth', None)
        revenue_growth = f'{rev_g*100:.1f}%' if rev_g is not None else 'N/A'
        pm             = info.get('profitMargins', None)
        profit_margin  = f'{pm*100:.1f}%' if pm is not None else 'N/A'
        om             = info.get('operatingMargins', None)
        operating_margin = f'{om*100:.1f}%' if om is not None else 'N/A'
        de             = info.get('debtToEquity', None)
        debt_equity    = round(de / 100, 2) if de is not None else 'N/A'
        fcf            = info.get('freeCashflow', None)
        if fcf is not None:
            free_cash_flow = f'${fcf/1e9:.1f}B' if abs(fcf) >= 1e9 else f'${fcf/1e6:.0f}M'
        bv             = info.get('bookValue', None)
        book_value     = round(bv, 2) if bv else 'N/A'
        pb             = info.get('priceToBook', None)
        price_to_book  = round(pb, 2) if pb else 'N/A'
        dy             = info.get('dividendYield', None)
        dividend_yield = f'{dy*100:.2f}%' if dy else 'N/A'
        bt             = info.get('beta', None)
        beta           = round(bt, 2) if bt else 'N/A'
        at             = info.get('targetMeanPrice', None)
        analyst_target = f'${at:.2f}' if at else 'N/A'
        ar             = info.get('recommendationKey', None)
        analyst_rec    = ar.upper() if ar else 'N/A'
        next_earn      = info.get('earningsTimestamp', None)
        if next_earn:
            next_earnings = datetime.utcfromtimestamp(next_earn).strftime('%Y-%m-%d')
    except Exception:
        pass

    # Company-specific news
    company_news = _fetch_news_for(symbol, limit=8, alp_key=alp_key, alp_secret=alp_secret)

    fh_key = FINNHUB_API_KEY  # server-side key

    # Helper: fetch Finnhub general news by category
    def _fh_news(category: str, n: int = 6) -> list[str]:
        if not fh_key:
            return []
        try:
            r = requests.get(f'{FINNHUB_BASE}/news',
                             params={'category': category, 'token': fh_key}, timeout=6)
            return [f'- {a["headline"]}' for a in (r.json() if r.ok else [])[:n] if a.get('headline')]
        except Exception:
            return []

    # Broad macro / global market news
    macro_news_lines = _fh_news('general', 8)

    # Merger & acquisition news (signals sector consolidation, takeover premium)
    merger_news_lines = _fh_news('merger', 4)

    # Company-specific news from Finnhub (last 30 days) — deeper than Alpaca
    sector_news_lines = []
    try:
        if fh_key:
            date_from = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            date_to   = datetime.now().strftime('%Y-%m-%d')
            r2 = requests.get(f'{FINNHUB_BASE}/company-news',
                              params={'symbol': symbol, 'from': date_from,
                                      'to': date_to, 'token': fh_key}, timeout=6)
            if r2.ok:
                sector_news_lines = [f'- {a["headline"]}' for a in r2.json()[:6] if a.get('headline')]
    except Exception:
        pass

    # Broader market context via Alpaca news for SPY (proxy for market-wide news)
    market_context_lines = []
    if alp_key and alp_secret:
        try:
            spy_news = alp.get_news(alp_key, alp_secret, 'SPY', limit=5)
            market_context_lines = [f'- {n.get("headline", "")}' for n in spy_news if n.get('headline')]
        except Exception:
            pass

    last_date = hist.index[-1]
    wdates = [(last_date + timedelta(days=w * 7)).strftime('%Y-%m-%d') for w in range(1, 5)]
    mdates = [(last_date + timedelta(days=m * 30)).strftime('%Y-%m-%d') for m in range(1, 7)]

    rsi_str  = f'{last_rsi:.1f}' if last_rsi is not None else 'N/A'
    rsi_note = ('overbought' if last_rsi and last_rsi > 70
                else 'oversold' if last_rsi and last_rsi < 30 else 'neutral')
    macd_note = 'bullish momentum' if last_macd > 0 else 'bearish momentum'
    company_news_lines = [
        f'- {n.get("headline", "")}' + (f' [{n["sentiment"]}]' if n.get('sentiment') else '')
        for n in company_news[:6]
    ]

    system_prompt = (
        'You are a senior buy-side equity analyst. Your PRIMARY job is to produce '
        'REALISTIC, GROUNDED price predictions anchored in hard data — not aspirational targets.\n\n'
        'CRITICAL RULES FOR PRICE PREDICTIONS:\n'
        '1. VALUATION FIRST: If the trailing P/E is already above sector average or forward P/E shows '
        'contraction, that is BEARISH pressure — acknowledge it.\n'
        '2. HISTORICAL VOLATILITY: You are given the stock\'s actual historical 4-week and 6-month '
        'volatility ranges. Your price targets MUST stay within 1.5 standard deviations of current price. '
        'Do NOT predict moves larger than what historical volatility supports.\n'
        '3. MEAN REVERSION: Stocks that rallied significantly in the last 1-3 months often face '
        'pullbacks. A stock up 20%+ in 3 months with a high P/E is NOT likely to keep surging.\n'
        '4. ANALYST CONSENSUS: If wall street analyst targets are provided, your targets should be '
        'in the same ballpark. Do not wildly deviate without clear justification.\n'
        '5. BASE RATES: Most stocks move ±2-8% in a month and ±10-25% in 6 months. Moves beyond '
        'this require exceptional catalysts.\n'
        '6. BE WILLING TO SAY BEARISH: If the data points to downside, say BEARISH. Do not default '
        'to BULLISH. Most stocks at any given time are fairly valued — NEUTRAL is a valid signal.\n\n'
        'Combine fundamentals, macro-economics, geopolitics, sector dynamics, AI/tech disruption, '
        'technicals, and options flow into a holistic outlook.\n'
        'Return ONLY a valid JSON object — no markdown, no code fences, no text outside the JSON.'
    )

    user_prompt = f"""Analyse {symbol} ({company_name}), sector: {sector}, industry: {industry}

COMPANY FUNDAMENTALS:
Market Cap: {market_cap} | Trailing P/E: {pe_ratio} | Forward P/E: {forward_pe} | PEG Ratio: {peg}
EPS: {eps} | Revenue Growth: {revenue_growth}
Profit Margin: {profit_margin} | Operating Margin: {operating_margin}
Debt/Equity: {debt_equity} | Free Cash Flow: {free_cash_flow}
Book Value: {book_value} | Price/Book: {price_to_book}
Dividend Yield: {dividend_yield} | Beta: {beta}
Analyst Consensus Target: {analyst_target} | Analyst Recommendation: {analyst_rec}
Next Earnings: {next_earnings}

PRICE ACTION:
Current: ${last_price:.2f} | 52w High: ${high_52} | 52w Low: ${low_52}
Performance: 1M: {pct_1m}% | 3M: {pct_3m}% | 6M: {pct_6m}% | 1Y: {pct_1y}%
Last 20 closes: {close_20d}
Last volume: {last_vol:,} | 20d avg: {avg_vol_20:,}

HISTORICAL VOLATILITY (use this to bound your predictions):
Annualised volatility: {hist_vol_annual*100:.1f}%
4-week 1σ range: ${expected_4w_low} — ${expected_4w_high}
6-month 1σ range: ${expected_6m_low} — ${expected_6m_high}
Average daily return: {avg_daily_return*100:.3f}%

TECHNICALS:
RSI(14): {rsi_str} ({rsi_note})
MACD histogram: {last_macd:.4f} ({macd_note})

OPTIONS FLOW:
{chr(10).join(opts_lines) if opts_lines else 'No options data available'}

COMPANY & SECTOR NEWS (last 30 days):
{chr(10).join(company_news_lines) if company_news_lines else 'No recent company news'}

INDUSTRY / COMPETITOR NEWS:
{chr(10).join(sector_news_lines) if sector_news_lines else 'No recent industry news'}

M&A / DEAL ACTIVITY:
{chr(10).join(merger_news_lines) if merger_news_lines else 'None reported'}

BROAD MARKET CONTEXT:
{chr(10).join(market_context_lines) if market_context_lines else 'No market context available'}

GLOBAL MACRO & GEOPOLITICAL NEWS:
{chr(10).join(macro_news_lines) if macro_news_lines else 'No macro news available'}

Weekly target dates (4 weeks): {wdates[0]}, {wdates[1]}, {wdates[2]}, {wdates[3]}
Monthly target dates (6 months): {mdates[0]}, {mdates[1]}, {mdates[2]}, {mdates[3]}, {mdates[4]}, {mdates[5]}

Return ONLY this JSON (no nulls — estimate all values):
{{
  "signal": "BULLISH or BEARISH or NEUTRAL",
  "confidence": <0-100 integer>,
  "reasoning": "<4-5 sentences: dominant factor driving outlook, then fundamentals, then technicals, then sector>",
  "price_target_4w": <number>,
  "bull_target": <number>,
  "bear_target": <number>,
  "weekly_targets": [
    {{"week": 1, "date": "{wdates[0]}", "price": <number>, "change_pct": <number>}},
    {{"week": 2, "date": "{wdates[1]}", "price": <number>, "change_pct": <number>}},
    {{"week": 3, "date": "{wdates[2]}", "price": <number>, "change_pct": <number>}},
    {{"week": 4, "date": "{wdates[3]}", "price": <number>, "change_pct": <number>}}
  ],
  "monthly_targets": [
    {{"month": 1, "date": "{mdates[0]}", "price": <number>, "change_pct": <number>}},
    {{"month": 2, "date": "{mdates[1]}", "price": <number>, "change_pct": <number>}},
    {{"month": 3, "date": "{mdates[2]}", "price": <number>, "change_pct": <number>}},
    {{"month": 4, "date": "{mdates[3]}", "price": <number>, "change_pct": <number>}},
    {{"month": 5, "date": "{mdates[4]}", "price": <number>, "change_pct": <number>}},
    {{"month": 6, "date": "{mdates[5]}", "price": <number>, "change_pct": <number>}}
  ],
  "geopolitical_impact": "<How active conflicts, sanctions, or trade tensions specifically affect {symbol} — supply chain, demand, risk appetite>",
  "ai_tech_impact": "<How AI adoption or tech disruption acts as tailwind or headwind for {symbol} and its sector over 4 weeks>",
  "sector_tailwinds": ["<positive sector force 1>", "<positive sector force 2>"],
  "sector_headwinds": ["<negative sector force 1>", "<negative sector force 2>"],
  "external_influences": [
    {{"factor": "<e.g. Fed rate stance>", "sentiment": "positive or negative or neutral", "detail": "<1-sentence impact on {symbol}>"}},
    {{"factor": "<e.g. USD strength>", "sentiment": "positive or negative or neutral", "detail": "<1-sentence impact>"}},
    {{"factor": "<e.g. Oil / commodity prices>", "sentiment": "positive or negative or neutral", "detail": "<1-sentence impact>"}}
  ],
  "options_strategies": [
    {{
      "rank": 1,
      "name": "<primary strategy>",
      "rationale": "<why best fit given signal and IV>",
      "legs": ["<leg 1>", "<leg 2>"],
      "max_gain": "<e.g. $400/contract>",
      "max_loss": "<e.g. $150/contract>",
      "risk_level": "Low or Medium or High"
    }},
    {{
      "rank": 2,
      "name": "<conservative alternative>",
      "rationale": "<for risk-averse traders>",
      "legs": ["<leg 1>", "<leg 2>"],
      "max_gain": "<e.g. $200/contract>",
      "max_loss": "<e.g. $100/contract>",
      "risk_level": "Low or Medium or High"
    }},
    {{
      "rank": 3,
      "name": "<aggressive / speculative play>",
      "rationale": "<for high-conviction directional traders>",
      "legs": ["<leg 1>", "<leg 2>"],
      "max_gain": "<e.g. $600/contract>",
      "max_loss": "<e.g. $200/contract>",
      "risk_level": "Low or Medium or High"
    }}
  ],
  "gex_analysis": "<1-2 sentences on key GEX support/resistance levels>",
  "macro_impact": "<Fed policy, FX, commodities, tariffs — net effect on {symbol} over 4 weeks>",
  "key_risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "catalysts": ["<catalyst 1>", "<catalyst 2>", "<catalyst 3>"]
}}"""

    return {
        'symbol':        symbol,
        'current_price': last_price,
        'weekly_dates':  wdates,
        'monthly_dates': mdates,
        'system_prompt': system_prompt,
        'user_prompt':   user_prompt,
    }


def _parse_ai_result(raw: str, symbol: str, provider: str, model: str,
                     current_price: float) -> dict | None:
    """Parse raw LLM text into a structured result dict."""
    text = raw.strip()
    if text.startswith('```'):
        text = _re.sub(r'^```[a-z]*\n?', '', text)
        text = _re.sub(r'\n?```$', '', text.rstrip())
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        m = _re.search(r'\{[\s\S]*\}', raw)
        if not m:
            return None
        try:
            result = json.loads(m.group())
        except Exception:
            return None

    result['symbol']        = symbol
    result['llm_provider']  = provider
    result['llm_model']     = model
    result['current_price'] = current_price

    pred_series = []
    for wt in result.get('weekly_targets', []):
        try:
            d = datetime.strptime(wt['date'], '%Y-%m-%d')
            pred_series.append({'time': int(d.timestamp()), 'value': float(wt['price'])})
        except Exception:
            pass
    result['prediction_series'] = pred_series
    return result


@app.route('/api/ai-context/<symbol>')
def api_ai_context(symbol: str):
    """Return prepared prompts for client-side AI calls (Ollama running locally)."""
    symbol = symbol.upper()
    alp_key, alp_secret = get_alpaca_creds()
    ctx = _build_ai_context(symbol, alp_key, alp_secret)
    if ctx is None:
        return jsonify({'error': 'No price data available'}), 404
    return jsonify(ctx)


@app.route('/api/llm-analysis/<symbol>')
def api_llm_analysis(symbol: str):
    """Server-side AI analysis for cloud providers (OpenAI, Anthropic, Google, Groq, xAI)."""
    symbol     = symbol.upper()
    provider   = freq.headers.get('X-LLM-Provider', '').strip()
    model      = freq.headers.get('X-LLM-Model', '').strip()
    llm_key    = freq.headers.get('X-LLM-Key', '').strip()
    auth_type  = freq.headers.get('X-LLM-Auth-Type', 'apikey').strip()
    ollama_url = freq.headers.get('X-Ollama-URL', 'http://localhost:11434').strip()
    force      = freq.args.get('refresh', '') == '1'

    if not provider:
        return jsonify({'error': 'No AI provider specified'}), 400
    if not llm_key:
        return jsonify({'error': 'No API key provided'}), 400

    cache_key = f'llm_{symbol}_{provider}_{model}'
    now = time.time()
    if not force and cache_key in _cache and now - _cache_time.get(cache_key, 0) < 1800:
        return jsonify(_cache[cache_key])

    alp_key, alp_secret = get_alpaca_creds()
    ctx = _build_ai_context(symbol, alp_key, alp_secret)
    if ctx is None:
        return jsonify({'error': 'No price data available'}), 404

    raw = llm_mod.call_llm(provider, model, llm_key,
                            ctx['system_prompt'], ctx['user_prompt'],
                            ollama_url, auth_type)
    if not raw:
        return jsonify({'error': 'AI call failed or returned empty response'}), 500

    result = _parse_ai_result(raw, symbol, provider, model, ctx['current_price'])
    if result is None:
        return jsonify({'error': 'Could not parse AI response'}), 500

    _cache[cache_key]      = result
    _cache_time[cache_key] = now
    return jsonify(result)


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
