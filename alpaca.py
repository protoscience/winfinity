"""
Alpaca Market Data helpers for Winfinity.
All functions return normalised dicts/lists compatible with the existing
yfinance/Finnhub data shapes so callers need minimal changes.
"""

import os
import requests
from datetime import datetime, timedelta, timezone
from typing import Optional

ALPACA_DATA_URL  = 'https://data.alpaca.markets'
ALPACA_TRADE_URL = 'https://paper-api.alpaca.markets'   # paper; swap for live if needed

_ENV_KEY    = os.environ.get('ALPACA_API_KEY', '')
_ENV_SECRET = os.environ.get('ALPACA_API_SECRET', '')


def _headers(key: str, secret: str) -> dict:
    return {
        'APCA-API-KEY-ID':     key,
        'APCA-API-SECRET-KEY': secret,
        'Accept': 'application/json',
    }


def _get(key: str, secret: str, base: str, path: str, params: dict = None) -> dict | list | None:
    if not key or not secret:
        return None
    try:
        r = requests.get(f'{base}{path}', headers=_headers(key, secret),
                         params=params or {}, timeout=10)
        if r.ok:
            return r.json()
        return None
    except Exception:
        return None


# ── Quotes / Snapshots ──────────────────────────────────────────────────────

def get_snapshots(key: str, secret: str, symbols: list[str]) -> dict:
    """
    Batch snapshot: { AAPL: {price, prev_close, change, change_pct, volume}, … }
    Uses /v2/stocks/snapshots endpoint.
    """
    if not key or not secret or not symbols:
        return {}
    chunk_size = 40
    result = {}
    for i in range(0, len(symbols), chunk_size):
        chunk = symbols[i:i + chunk_size]
        raw = _get(key, secret, ALPACA_DATA_URL, '/v2/stocks/snapshots',
                   {'symbols': ','.join(chunk), 'feed': 'iex'})
        if not isinstance(raw, dict):
            continue
        for sym, snap in raw.items():
            try:
                dp   = snap.get('dailyBar', {})
                prev = snap.get('prevDailyBar', {})
                lat  = snap.get('latestTrade', {})
                price      = float(lat.get('p') or dp.get('c') or 0)
                prev_close = float(prev.get('c') or price)
                change     = price - prev_close
                change_pct = (change / prev_close * 100) if prev_close else 0
                result[sym] = {
                    'price':      round(price, 2),
                    'prev_close': round(prev_close, 2),
                    'change':     round(change, 2),
                    'change_pct': round(change_pct, 2),
                    'volume':     int(dp.get('v') or 0),
                    'vwap':       round(float(dp.get('vw') or 0), 2),
                    'source':     'alpaca',
                }
            except Exception:
                pass
    return result


def get_latest_quote(key: str, secret: str, symbol: str) -> dict | None:
    """Real-time latest quote for one symbol."""
    raw = _get(key, secret, ALPACA_DATA_URL, f'/v2/stocks/{symbol}/quotes/latest',
               {'feed': 'iex'})
    if not raw:
        return None
    try:
        q = raw.get('quote', {})
        return {
            'symbol':   symbol,
            'bid':      float(q.get('bp', 0)),
            'ask':      float(q.get('ap', 0)),
            'bid_size': int(q.get('bs', 0)),
            'ask_size': int(q.get('as', 0)),
            'timestamp': q.get('t', ''),
            'source':   'alpaca',
        }
    except Exception:
        return None


# ── Historical Bars ─────────────────────────────────────────────────────────

_PERIOD_MAP = {
    '1mo':  30,  '3mo': 90,  '6mo': 180,
    '1y':  365,  '2y': 730,  '5y': 1825,
}


def get_bars(key: str, secret: str, symbol: str, period: str = '6mo') -> list[dict]:
    """
    Daily OHLCV bars compatible with /api/chart response shape.
    Returns list of {time(unix), open, high, low, close, volume}.
    """
    days  = _PERIOD_MAP.get(period, 180)
    start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%dT00:00:00Z')
    raw   = _get(key, secret, ALPACA_DATA_URL, f'/v2/stocks/{symbol}/bars', {
        'timeframe': '1Day', 'start': start, 'limit': 1000,
        'adjustment': 'all', 'feed': 'iex',
    })
    if not raw or 'bars' not in raw:
        return []
    bars = []
    for b in raw['bars']:
        try:
            t = int(datetime.fromisoformat(b['t'].replace('Z', '+00:00')).timestamp())
            bars.append({
                'time':   t,
                'open':   round(float(b['o']), 4),
                'high':   round(float(b['h']), 4),
                'low':    round(float(b['l']), 4),
                'close':  round(float(b['c']), 4),
                'volume': int(b['v']),
            })
        except Exception:
            pass
    return sorted(bars, key=lambda x: x['time'])


def get_bars_df(key: str, secret: str, symbol: str, period: str = '1y'):
    """Return bars as a pandas DataFrame (for indicators/predictions)."""
    import pandas as pd
    bars = get_bars(key, secret, symbol, period)
    if not bars:
        return None
    df = pd.DataFrame(bars)
    df['time'] = pd.to_datetime(df['time'], unit='s', utc=True)
    df = df.set_index('time')
    df.columns = [c.capitalize() for c in df.columns]   # Open, High, Low, Close, Volume
    return df


# ── News with Sentiment ─────────────────────────────────────────────────────

def get_news(key: str, secret: str, symbols: list[str] | None = None,
             limit: int = 10) -> list[dict]:
    """
    Alpaca News API — returns articles with sentiment scores.
    If symbols is None/empty → general market news.
    """
    params: dict = {'limit': limit, 'sort': 'desc'}
    if symbols:
        params['symbols'] = ','.join(symbols)
    raw = _get(key, secret, 'https://data.alpaca.markets', '/v1beta1/news', params)
    if not isinstance(raw, dict) or 'news' not in raw:
        return []
    articles = []
    for item in raw['news']:
        try:
            ts = 0
            if item.get('created_at'):
                ts = int(datetime.fromisoformat(
                    item['created_at'].replace('Z', '+00:00')
                ).timestamp())
            articles.append({
                'headline':  item.get('headline', ''),
                'summary':   item.get('summary', ''),
                'url':       item.get('url', ''),
                'source':    item.get('source', 'Alpaca'),
                'datetime':  ts,
                'sentiment': item.get('sentiment', None),   # positive/negative/neutral
                'symbols':   item.get('symbols', []),
            })
        except Exception:
            pass
    return [a for a in articles if a.get('headline')]


# ── Options Chain ───────────────────────────────────────────────────────────

def get_options_chain(key: str, secret: str, symbol: str,
                      expiry: str = '') -> dict | None:
    """
    Fetch options snapshots from Alpaca (/v1beta1/options/snapshots/{symbol}).
    Returns dict with keys: strikes, call_volume, put_volume, call_oi, put_oi,
    gex, gex_vol, last_price, expiry, available_expiries — same shape as our
    existing options-chain endpoint so the frontend needs no changes.
    """
    import math

    # Available contracts list to find expiries
    params: dict = {'underlying_symbols': symbol, 'limit': 1000, 'type': 'call'}
    if expiry:
        params['expiration_date'] = expiry
    else:
        # Find nearest ~28-day expiry
        target = (datetime.now(timezone.utc) + timedelta(days=28)).strftime('%Y-%m-%d')
        params['expiration_date_gte'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        params['expiration_date_lte'] = (datetime.now(timezone.utc) + timedelta(days=185)).strftime('%Y-%m-%d')

    raw_contracts = _get(key, secret, ALPACA_DATA_URL,
                         '/v1beta1/options/contracts', params)
    if not isinstance(raw_contracts, dict):
        return None

    contracts = raw_contracts.get('option_contracts', [])
    if not contracts:
        return None

    # Collect all available expiries
    all_expiries = sorted({c['expiration_date'] for c in contracts})
    if not all_expiries:
        return None

    # Pick expiry
    if expiry and expiry in all_expiries:
        chosen = expiry
    else:
        target_date = datetime.now(timezone.utc) + timedelta(days=28)
        chosen = min(all_expiries, key=lambda e: abs(
            (datetime.strptime(e, '%Y-%m-%d').replace(tzinfo=timezone.utc) - target_date).days
        ))

    # Get put contracts for same expiry
    raw_puts = _get(key, secret, ALPACA_DATA_URL, '/v1beta1/options/contracts', {
        'underlying_symbols': symbol, 'limit': 1000,
        'type': 'put', 'expiration_date': chosen,
    })
    put_contracts = raw_puts.get('option_contracts', []) if isinstance(raw_puts, dict) else []

    # Filter to chosen expiry
    call_contracts = [c for c in contracts if c['expiration_date'] == chosen]

    # Get snapshots for all contract symbols
    def fetch_snapshots(contract_list):
        syms = [c['symbol'] for c in contract_list]
        if not syms:
            return {}
        snaps = {}
        for i in range(0, len(syms), 100):
            chunk = syms[i:i+100]
            raw = _get(key, secret, ALPACA_DATA_URL, '/v1beta1/options/snapshots', {
                'symbols': ','.join(chunk),
                'feed': 'indicative',
            })
            if isinstance(raw, dict):
                snaps.update(raw.get('snapshots', {}))
        return snaps

    call_snaps = fetch_snapshots(call_contracts)
    put_snaps  = fetch_snapshots(put_contracts)

    # Build strike-indexed data
    call_by_strike: dict = {}
    for c in call_contracts:
        strike = float(c.get('strike_price', 0))
        snap   = call_snaps.get(c['symbol'], {})
        greeks = snap.get('greeks', {})
        bar    = snap.get('dailyBar', {})
        call_by_strike[strike] = {
            'volume': int(bar.get('v') or snap.get('latestTrade', {}).get('s') or 0),
            'oi':     int(c.get('open_interest') or 0),
            'iv':     float(snap.get('impliedVolatility') or greeks.get('impliedVolatility') or 0),
            'gamma':  float(greeks.get('gamma') or 0),
        }

    put_by_strike: dict = {}
    for c in put_contracts:
        strike = float(c.get('strike_price', 0))
        snap   = put_snaps.get(c['symbol'], {})
        greeks = snap.get('greeks', {})
        bar    = snap.get('dailyBar', {})
        put_by_strike[strike] = {
            'volume': int(bar.get('v') or snap.get('latestTrade', {}).get('s') or 0),
            'oi':     int(c.get('open_interest') or 0),
            'iv':     float(snap.get('impliedVolatility') or greeks.get('impliedVolatility') or 0),
            'gamma':  float(greeks.get('gamma') or 0),
        }

    # Get current price via snapshot
    price_snap = get_snapshots(key, secret, [symbol])
    last_price  = price_snap.get(symbol, {}).get('price', 0)

    # Merge on strikes (±25% of last_price)
    all_strikes = sorted(set(call_by_strike) | set(put_by_strike))
    if last_price > 0:
        all_strikes = [s for s in all_strikes
                       if last_price * 0.75 <= s <= last_price * 1.25]

    strikes = call_volume = put_volume = call_oi = put_oi = gex_oi = gex_vol = []
    strikes, call_volume, put_volume, call_oi, put_oi, gex_oi, gex_vol = (
        [], [], [], [], [], [], []
    )
    for strike in all_strikes:
        c = call_by_strike.get(strike, {})
        p = put_by_strike.get(strike, {})

        c_vol = c.get('volume', 0)
        p_vol = p.get('volume', 0)
        c_oi  = c.get('oi', 0)
        p_oi  = p.get('oi', 0)

        # GEX: use real gamma if available, else approximate
        c_g = c.get('gamma', 0)
        p_g = p.get('gamma', 0)
        if c_g == 0 and c.get('iv', 0) > 0 and last_price > 0:
            c_g = _approx_gamma(last_price, strike, c['iv'], chosen)
        if p_g == 0 and p.get('iv', 0) > 0 and last_price > 0:
            p_g = _approx_gamma(last_price, strike, p['iv'], chosen)

        gex_by_oi  = (c_oi  * c_g - p_oi  * p_g) * last_price * 100
        gex_by_vol = (c_vol * c_g - p_vol * p_g) * last_price * 100

        strikes.append(strike)
        call_volume.append(c_vol)
        put_volume.append(p_vol)
        call_oi.append(c_oi)
        put_oi.append(p_oi)
        gex_oi.append(round(gex_by_oi, 0))
        gex_vol.append(round(gex_by_vol, 0))

    return {
        'symbol':             symbol,
        'expiry':             chosen,
        'available_expiries': all_expiries,
        'last_price':         round(last_price, 2),
        'strikes':            strikes,
        'call_volume':        call_volume,
        'put_volume':         put_volume,
        'call_oi':            call_oi,
        'put_oi':             put_oi,
        'gex':                gex_oi,
        'gex_vol':            gex_vol,
        'source':             'alpaca',
    }


def _approx_gamma(S: float, K: float, iv: float, expiry_str: str) -> float:
    """Black-Scholes gamma approximation."""
    from math import log, sqrt, exp, pi
    try:
        T = max((datetime.strptime(expiry_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
                 - datetime.now(timezone.utc)).days, 1) / 365.0
        r = 0.05
        d1 = (log(S / K) + (r + 0.5 * iv**2) * T) / (iv * sqrt(T))
        phi = exp(-0.5 * d1**2) / sqrt(2 * pi)
        return phi / (S * iv * sqrt(T))
    except Exception:
        return 0.0
