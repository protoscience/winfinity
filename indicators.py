import numpy as np
import pandas as pd


def calculate_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_macd(close: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calculate_ema(close: pd.Series, period: int) -> pd.Series:
    return close.ewm(span=period, adjust=False).mean()


def calculate_ripster_ema_cloud(close: pd.Series):
    """
    Ripster EMA Cloud:
    - Fast Cloud: EMA 8 & EMA 9
    - Slow Cloud: EMA 34 & EMA 39
    - Trend Filter: EMA 200
    - Cross Signal: EMA 5 & EMA 13
    """
    return {
        'ema5': calculate_ema(close, 5),
        'ema8': calculate_ema(close, 8),
        'ema9': calculate_ema(close, 9),
        'ema13': calculate_ema(close, 13),
        'ema34': calculate_ema(close, 34),
        'ema39': calculate_ema(close, 39),
        'ema200': calculate_ema(close, 200),
    }


def calculate_bollinger_bands(close: pd.Series, period=20, std_dev=2):
    sma = close.rolling(window=period).mean()
    std = close.rolling(window=period).std()
    upper = sma + std_dev * std
    lower = sma - std_dev * std
    return upper, sma, lower


def get_all_indicators(df: pd.DataFrame) -> dict:
    close = df['Close']
    high = df['High']
    low = df['Low']

    rsi = calculate_rsi(close)
    macd_line, signal_line, histogram = calculate_macd(close)
    ripster = calculate_ripster_ema_cloud(close)
    bb_upper, bb_mid, bb_lower = calculate_bollinger_bands(close)

    result = {
        'rsi': _series_to_list(rsi, df.index),
        'macd': {
            'macd': _series_to_list(macd_line, df.index),
            'signal': _series_to_list(signal_line, df.index),
            'histogram': _series_to_list(histogram, df.index),
        },
        'ripster': {k: _series_to_list(v, df.index) for k, v in ripster.items()},
        'bollinger': {
            'upper': _series_to_list(bb_upper, df.index),
            'mid': _series_to_list(bb_mid, df.index),
            'lower': _series_to_list(bb_lower, df.index),
        },
    }
    return result


def _series_to_list(series: pd.Series, index) -> list:
    out = []
    for ts, val in zip(index, series):
        if pd.notna(val):
            t = int(ts.timestamp()) if hasattr(ts, 'timestamp') else int(ts)
            out.append({'time': t, 'value': round(float(val), 4)})
    return out
