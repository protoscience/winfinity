import os
import time
import threading
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

from indicators import get_all_indicators
from predictions import predict_next_4_weeks

load_dotenv()

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


def finnhub_get(path: str, params: dict = None) -> dict:
    if not FINNHUB_API_KEY:
        return {}
    p = params or {}
    p['token'] = FINNHUB_API_KEY
    try:
        r = requests.get(f'{FINNHUB_BASE}{path}', params=p, timeout=8)
        return r.json() if r.ok else {}
    except Exception:
        return {}


def get_yf_ticker(symbol: str):
    return yf.Ticker(symbol)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/stocks')
def api_stocks():
    """Top 20 stocks with price, change, P/E, volume."""
    def fetch():
        result = []
        # Batch download for speed
        try:
            tickers = yf.Tickers(' '.join(TOP_20_STOCKS))
        except Exception:
            tickers = None

        for sym in TOP_20_STOCKS:
            try:
                ticker = get_yf_ticker(sym)
                info = ticker.fast_info
                hist = ticker.history(period='2d', interval='1d')

                price = float(info.last_price) if hasattr(info, 'last_price') and info.last_price else 0
                prev_close = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else price
                change = price - prev_close
                change_pct = (change / prev_close * 100) if prev_close else 0

                # P/E ratio
                full_info = ticker.info
                pe = full_info.get('trailingPE') or full_info.get('forwardPE') or None
                market_cap = full_info.get('marketCap') or 0
                volume = full_info.get('volume') or full_info.get('regularMarketVolume') or 0
                sector = full_info.get('sector', 'N/A')
                name = full_info.get('shortName') or full_info.get('longName') or sym

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
            except Exception as e:
                result.append({'symbol': sym, 'error': str(e)})

        return result

    data = cached('stocks_list', fetch, ttl=120)
    return jsonify(data)


@app.route('/api/chart/<symbol>')
def api_chart(symbol: str):
    """OHLCV candlestick data for a symbol."""
    symbol = symbol.upper()
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

    data = cached(f'chart_{symbol}', fetch, ttl=300)
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
        if FINNHUB_API_KEY:
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
        if FINNHUB_API_KEY:
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
        if FINNHUB_API_KEY:
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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
