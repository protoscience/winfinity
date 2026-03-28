import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import MinMaxScaler
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')


def predict_next_4_weeks(df: pd.DataFrame, symbol: str) -> dict:
    """
    Multi-method 4-week price prediction:
    1. Linear trend extrapolation
    2. EMA-based momentum projection
    3. Ensemble average
    """
    close = df['Close'].dropna()
    if len(close) < 30:
        return {'error': 'Insufficient data'}

    last_price = float(close.iloc[-1])
    last_date = close.index[-1]

    # Method 1: Linear regression on recent 60 days
    lr_pred = _linear_regression_predict(close, days_ahead=28)

    # Method 2: EMA momentum
    ema_pred = _ema_momentum_predict(close, days_ahead=28)

    # Method 3: Trend + volatility range
    trend_pred = _trend_volatility_predict(close, days_ahead=28)

    # Ensemble
    ensemble = []
    for i in range(28):
        avg = np.mean([lr_pred[i], ema_pred[i], trend_pred[i]])
        ensemble.append(avg)

    # Generate weekly targets (5 trading days ≈ 1 week, use calendar days)
    weekly_targets = []
    for week in range(1, 5):
        day_idx = min(week * 7 - 1, len(ensemble) - 1)
        target_date = last_date + timedelta(days=week * 7)
        weekly_targets.append({
            'week': week,
            'date': target_date.strftime('%Y-%m-%d'),
            'price': round(ensemble[day_idx], 2),
            'change_pct': round((ensemble[day_idx] - last_price) / last_price * 100, 2),
        })

    # Bull/bear targets based on ±1 std
    std_20 = float(close.pct_change().tail(20).std() * last_price * np.sqrt(20))
    bull_target = round(last_price + std_20, 2)
    bear_target = round(last_price - std_20, 2)

    # Overall signal
    final_pred = ensemble[-1]
    change_4w = (final_pred - last_price) / last_price * 100
    if change_4w > 3:
        signal = 'BULLISH'
    elif change_4w < -3:
        signal = 'BEARISH'
    else:
        signal = 'NEUTRAL'

    # Build prediction chart series (daily)
    prediction_series = []
    for i, val in enumerate(ensemble):
        d = last_date + timedelta(days=i + 1)
        # Skip weekends
        while d.weekday() >= 5:
            d += timedelta(days=1)
        prediction_series.append({
            'time': int(d.timestamp()),
            'value': round(val, 2),
        })

    return {
        'symbol': symbol,
        'current_price': last_price,
        'signal': signal,
        'change_4w_pct': round(change_4w, 2),
        'bull_target': bull_target,
        'bear_target': bear_target,
        'weekly_targets': weekly_targets,
        'prediction_series': prediction_series,
    }


def _linear_regression_predict(close: pd.Series, days_ahead: int) -> list:
    n = min(60, len(close))
    y = close.tail(n).values
    x = np.arange(n).reshape(-1, 1)
    model = LinearRegression()
    model.fit(x, y)
    future_x = np.arange(n, n + days_ahead).reshape(-1, 1)
    preds = model.predict(future_x)
    return preds.tolist()


def _ema_momentum_predict(close: pd.Series, days_ahead: int) -> list:
    ema9 = float(close.ewm(span=9).mean().iloc[-1])
    ema21 = float(close.ewm(span=21).mean().iloc[-1])
    last = float(close.iloc[-1])
    # Daily drift based on ema momentum
    daily_drift = (ema9 - ema21) / ema21 / 10  # dampened
    preds = []
    current = last
    for _ in range(days_ahead):
        current = current * (1 + daily_drift)
        preds.append(current)
    return preds


def _trend_volatility_predict(close: pd.Series, days_ahead: int) -> list:
    returns = close.pct_change().dropna()
    mean_return = float(returns.tail(20).mean())
    last = float(close.iloc[-1])
    preds = []
    current = last
    for _ in range(days_ahead):
        current = current * (1 + mean_return)
        preds.append(current)
    return preds
