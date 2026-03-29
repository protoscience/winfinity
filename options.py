"""
Winfinity Options Strategy Engine
Scores technical + fundamental + sentiment signals and maps them to
ranked options strategies for the next 4 weeks.
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta


# ---------------------------------------------------------------------------
# Signal Analysis
# ---------------------------------------------------------------------------

def analyze_signals(hist: pd.DataFrame, indicators: dict, prediction: dict, news: list) -> dict:
    close  = hist['Close']
    volume = hist['Volume']
    last_price = float(close.iloc[-1])

    score   = 0   # positive = bullish, negative = bearish
    signals = []

    # ── 1. 4-Week Prediction (weight 3) ──────────────────────────────────
    pred_signal = prediction.get('signal', 'NEUTRAL')
    pred_change = prediction.get('change_4w_pct', 0)
    sign = '+' if pred_change >= 0 else ''
    if pred_signal == 'BULLISH':
        score += 3
        signals.append({'source': 'Prediction', 'signal': 'BULLISH',
                        'detail': f'{sign}{pred_change:.1f}% projected 4W'})
    elif pred_signal == 'BEARISH':
        score -= 3
        signals.append({'source': 'Prediction', 'signal': 'BEARISH',
                        'detail': f'{sign}{pred_change:.1f}% projected 4W'})
    else:
        signals.append({'source': 'Prediction', 'signal': 'NEUTRAL',
                        'detail': f'{sign}{pred_change:.1f}% projected 4W'})

    # ── 2. RSI (weight 2) ────────────────────────────────────────────────
    rsi_data = indicators.get('rsi', [])
    if rsi_data:
        rsi_val = rsi_data[-1]['value']
        if rsi_val < 30:
            score += 2
            signals.append({'source': 'RSI', 'signal': 'BULLISH',
                            'detail': f'Oversold at {rsi_val:.0f} — potential reversal'})
        elif rsi_val > 70:
            score -= 2
            signals.append({'source': 'RSI', 'signal': 'BEARISH',
                            'detail': f'Overbought at {rsi_val:.0f} — momentum fading'})
        elif rsi_val >= 55:
            score += 1
            signals.append({'source': 'RSI', 'signal': 'BULLISH',
                            'detail': f'Healthy at {rsi_val:.0f} — above midline'})
        elif rsi_val <= 45:
            score -= 1
            signals.append({'source': 'RSI', 'signal': 'BEARISH',
                            'detail': f'Weak at {rsi_val:.0f} — below midline'})
        else:
            signals.append({'source': 'RSI', 'signal': 'NEUTRAL',
                            'detail': f'Neutral at {rsi_val:.0f}'})

    # ── 3. MACD Histogram (weight 2) ─────────────────────────────────────
    macd_hist = indicators.get('macd', {}).get('histogram', [])
    if len(macd_hist) >= 3:
        h0 = macd_hist[-1]['value']
        h1 = macd_hist[-2]['value']
        h2 = macd_hist[-3]['value']
        if h0 > 0 and h0 > h1:
            score += 2
            signals.append({'source': 'MACD', 'signal': 'BULLISH',
                            'detail': 'Histogram positive & expanding'})
        elif h0 > 0 and h0 < h1:
            score += 1
            signals.append({'source': 'MACD', 'signal': 'BULLISH',
                            'detail': 'Histogram positive but narrowing'})
        elif h0 < 0 and h0 < h1:
            score -= 2
            signals.append({'source': 'MACD', 'signal': 'BEARISH',
                            'detail': 'Histogram negative & expanding'})
        elif h0 < 0 and h0 > h1:
            score -= 1
            signals.append({'source': 'MACD', 'signal': 'BEARISH',
                            'detail': 'Histogram negative but narrowing'})
        else:
            signals.append({'source': 'MACD', 'signal': 'NEUTRAL',
                            'detail': 'Histogram near zero'})

    # ── 4. Ripster EMA Cloud (weight 2) ──────────────────────────────────
    ripster = indicators.get('ripster', {})
    ema8  = ripster.get('ema8',  [])
    ema9  = ripster.get('ema9',  [])
    ema34 = ripster.get('ema34', [])
    ema39 = ripster.get('ema39', [])
    ema200 = ripster.get('ema200', [])

    if ema8 and ema9:
        fast_bull = ema8[-1]['value'] > ema9[-1]['value']
        score += 1 if fast_bull else -1
        signals.append({'source': 'EMA Fast Cloud', 'signal': 'BULLISH' if fast_bull else 'BEARISH',
                        'detail': 'EMA 8 > EMA 9 (bullish)' if fast_bull else 'EMA 8 < EMA 9 (bearish)'})

    if ema34 and ema39:
        slow_bull = ema34[-1]['value'] > ema39[-1]['value']
        score += 1 if slow_bull else -1
        signals.append({'source': 'EMA Slow Cloud', 'signal': 'BULLISH' if slow_bull else 'BEARISH',
                        'detail': 'EMA 34 > EMA 39 (bullish trend)' if slow_bull else 'EMA 34 < EMA 39 (bearish trend)'})

    if ema200:
        above_200 = last_price > ema200[-1]['value']
        score += 1 if above_200 else -1
        signals.append({'source': 'EMA 200', 'signal': 'BULLISH' if above_200 else 'BEARISH',
                        'detail': f'Price {"above" if above_200 else "below"} EMA 200 (${ema200[-1]["value"]:.2f})'})

    # ── 5. Volume (weight 1 — conviction modifier) ───────────────────────
    avg_vol  = float(volume.tail(20).mean())
    last_vol = float(volume.iloc[-1])
    vol_ratio = last_vol / avg_vol if avg_vol > 0 else 1.0

    if vol_ratio >= 1.5:
        vol_signal = 'HIGH'
        signals.append({'source': 'Volume', 'signal': 'NEUTRAL',
                        'detail': f'{vol_ratio:.1f}x avg volume — high conviction'})
    elif vol_ratio <= 0.6:
        vol_signal = 'LOW'
        signals.append({'source': 'Volume', 'signal': 'NEUTRAL',
                        'detail': f'{vol_ratio:.1f}x avg volume — low conviction'})
    else:
        vol_signal = 'NORMAL'
        signals.append({'source': 'Volume', 'signal': 'NEUTRAL',
                        'detail': f'{vol_ratio:.1f}x avg volume — normal'})

    # ── 6. News / Catalyst Sentiment ─────────────────────────────────────
    BULL_KW = ['beat', 'beats', 'upgrade', 'upgraded', 'raise', 'raised', 'raised guidance',
               'growth', 'record', 'surge', 'surges', 'partnership', 'deal', 'bullish',
               'buy', 'outperform', 'strong', 'positive', 'profit', 'revenue beat']
    BEAR_KW = ['miss', 'misses', 'downgrade', 'downgraded', 'cut', 'cuts', 'weak',
               'decline', 'loss', 'losses', 'lawsuit', 'investigation', 'recall',
               'bearish', 'sell', 'underperform', 'warning', 'layoff', 'restructure']

    news_score = 0
    catalyst_flags = []
    for article in (news or [])[:15]:
        text = (article.get('headline', '') + ' ' + article.get('summary', '')).lower()
        for kw in BULL_KW:
            if kw in text:
                news_score += 1
        for kw in BEAR_KW:
            if kw in text:
                news_score -= 1
        # Flag upcoming catalysts
        for kw in ['earnings', 'fda', 'clinical trial', 'merger', 'acquisition', 'split',
                   'dividend', 'results', 'guidance']:
            if kw in text and kw not in catalyst_flags:
                catalyst_flags.append(kw)

    if news_score >= 3:
        score += 1
        signals.append({'source': 'News Sentiment', 'signal': 'BULLISH',
                        'detail': 'Positive news flow from recent headlines'})
    elif news_score <= -3:
        score -= 1
        signals.append({'source': 'News Sentiment', 'signal': 'BEARISH',
                        'detail': 'Negative news flow from recent headlines'})
    else:
        signals.append({'source': 'News Sentiment', 'signal': 'NEUTRAL',
                        'detail': 'Mixed or neutral recent news'})

    # ── 7. Bollinger Band position ────────────────────────────────────────
    bb = indicators.get('bollinger', {})
    bb_upper = bb.get('upper', [])
    bb_lower = bb.get('lower', [])
    bb_mid   = bb.get('mid', [])
    if bb_upper and bb_lower and bb_mid:
        upper = bb_upper[-1]['value']
        lower = bb_lower[-1]['value']
        mid   = bb_mid[-1]['value']
        bb_pct = (last_price - lower) / (upper - lower) if (upper - lower) > 0 else 0.5
        if bb_pct >= 0.9:
            score -= 1
            signals.append({'source': 'Bollinger Bands', 'signal': 'BEARISH',
                            'detail': f'Price near upper band — overextended'})
        elif bb_pct <= 0.1:
            score += 1
            signals.append({'source': 'Bollinger Bands', 'signal': 'BULLISH',
                            'detail': f'Price near lower band — oversold'})
        elif bb_pct >= 0.6:
            signals.append({'source': 'Bollinger Bands', 'signal': 'BULLISH',
                            'detail': f'Price in upper half of bands'})
        else:
            signals.append({'source': 'Bollinger Bands', 'signal': 'BEARISH',
                            'detail': f'Price in lower half of bands'})

    # ── Composite ────────────────────────────────────────────────────────
    max_possible = 12
    confidence = min(100, int(abs(score) / max_possible * 100))

    if score >= 3:
        direction = 'BULLISH'
    elif score <= -3:
        direction = 'BEARISH'
    else:
        direction = 'NEUTRAL'

    # Historical volatility (20-day annualised)
    returns = close.pct_change().dropna().tail(20)
    hv20 = float(returns.std() * np.sqrt(252) * 100)
    if hv20 > 45:
        iv_regime = 'HIGH'
    elif hv20 > 22:
        iv_regime = 'MEDIUM'
    else:
        iv_regime = 'LOW'

    return {
        'direction':      direction,
        'score':          score,
        'confidence':     confidence,
        'iv_regime':      iv_regime,
        'hv20':           round(hv20, 1),
        'vol_signal':     vol_signal,
        'vol_ratio':      round(vol_ratio, 2),
        'catalyst_flags': catalyst_flags,
        'signals':        signals,
    }


# ---------------------------------------------------------------------------
# Strategy Library
# ---------------------------------------------------------------------------

def _nearest_strike(price: float, pct: float) -> float:
    raw = price * (1 + pct / 100)
    if price < 20:
        return round(raw * 2) / 2       # $0.50 increments
    elif price < 50:
        return round(raw)               # $1
    elif price < 200:
        return round(raw / 2.5) * 2.5  # $2.50
    else:
        return round(raw / 5) * 5       # $5


def get_strategies(last_price: float, analysis: dict) -> list:
    direction  = analysis['direction']
    iv_regime  = analysis['iv_regime']
    confidence = analysis['confidence']
    vol_signal = analysis['vol_signal']
    days       = 28

    expiry = (datetime.now() + timedelta(days=days)).strftime('%b %d')

    atm       = _nearest_strike(last_price, 0)
    up5       = _nearest_strike(last_price, 5)
    up10      = _nearest_strike(last_price, 10)
    up15      = _nearest_strike(last_price, 15)
    dn5       = _nearest_strike(last_price, -5)
    dn10      = _nearest_strike(last_price, -10)
    dn15      = _nearest_strike(last_price, -15)

    def fmt(v): return f'${v:.0f}' if v == int(v) else f'${v:.1f}'

    strategies = []

    # ── BULLISH ───────────────────────────────────────────────────────────
    if direction == 'BULLISH':
        if iv_regime == 'LOW':
            strategies = [
                {
                    'rank': 1, 'name': 'Long Call', 'type': 'bullish',
                    'risk_level': 'Medium',
                    'max_risk': 'Premium paid (defined)',
                    'max_reward': 'Unlimited',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Call'],
                    'why': f'Low IV makes calls cheap. Best when a strong breakout is expected above {fmt(up5)}.',
                    'ideal_move': f'Stock rallies above {fmt(up5)} (+5%)',
                    'greek_note': 'High delta, positive gamma & vega',
                },
                {
                    'rank': 2, 'name': 'Bull Call Spread', 'type': 'bullish',
                    'risk_level': 'Low',
                    'max_risk': 'Net debit paid',
                    'max_reward': f'Spread width minus debit (max at {fmt(up10)})',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Call',
                             f'SELL {expiry}  {fmt(up10)} Call'],
                    'why': f'Reduces cost vs. naked long call. Caps profit at +10% but meaningful premium reduction.',
                    'ideal_move': f'Stock reaches {fmt(up10)} (+10%)',
                    'greek_note': 'Reduced vega exposure vs. long call',
                },
                {
                    'rank': 3, 'name': 'Cash-Secured Put', 'type': 'bullish',
                    'risk_level': 'Low-Medium',
                    'max_risk': f'Own stock at {fmt(dn5)} minus premium',
                    'max_reward': 'Full premium collected',
                    'legs': [f'SELL {expiry}  {fmt(dn5)} Put  (hold cash collateral)'],
                    'why': f'Collect income now, buy the dip at {fmt(dn5)} only if needed. Profits if stock stays flat or rises.',
                    'ideal_move': f'Stock stays above {fmt(dn5)}',
                    'greek_note': 'Short delta, negative theta works for you',
                },
                {
                    'rank': 4, 'name': 'Call Ratio Spread', 'type': 'bullish',
                    'risk_level': 'High',
                    'max_risk': 'Unlimited above the 2nd short strike (requires margin)',
                    'max_reward': f'Max at {fmt(up10)} — spread width + credit',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Call',
                             f'SELL {expiry}  {fmt(up10)} Call  (×2)'],
                    'why': f'Net credit entry in low IV. Profits on moderate rally to {fmt(up10)}, but losses accelerate above {fmt(up15)}. High-conviction bounded bullish view.',
                    'ideal_move': f'Stock rallies to exactly {fmt(up10)} (+10%) then stops',
                    'greek_note': 'Net short gamma above upper strike — dangerous in fast rallies',
                },
            ]
        else:  # MEDIUM / HIGH IV — sell premium
            strategies = [
                {
                    'rank': 1, 'name': 'Bull Put Spread', 'type': 'bullish',
                    'risk_level': 'Low',
                    'max_risk': 'Spread width minus credit received',
                    'max_reward': 'Net credit (keep if stock stays above short strike)',
                    'legs': [f'SELL {expiry}  {fmt(dn5)} Put',
                             f'BUY  {expiry}  {fmt(dn10)} Put'],
                    'why': f'High IV inflates put premiums — collect a fat credit. Profit as long as stock stays above {fmt(dn5)}.',
                    'ideal_move': f'Stock stays above {fmt(dn5)}',
                    'greek_note': 'Short vega — profits from IV crush',
                },
                {
                    'rank': 2, 'name': 'Covered Call', 'type': 'bullish',
                    'risk_level': 'Low',
                    'max_risk': 'Stock drops below purchase price',
                    'max_reward': f'Premium + gain up to {fmt(up5)}',
                    'legs': ['HOLD 100 shares',
                             f'SELL {expiry}  {fmt(up5)} Call'],
                    'why': f'High IV produces fat call premiums. Generate income on existing position, cap upside at {fmt(up5)}.',
                    'ideal_move': f'Stock stays below {fmt(up5)}, collect full premium',
                    'greek_note': 'Delta-hedged; short vega',
                },
                {
                    'rank': 3, 'name': 'Bull Call Spread', 'type': 'bullish',
                    'risk_level': 'Low',
                    'max_risk': 'Net debit paid',
                    'max_reward': f'Spread width minus debit',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Call',
                             f'SELL {expiry}  {fmt(up10)} Call'],
                    'why': 'Selling the OTM call offsets high-IV cost on the long leg. Directional play with limited vega drag.',
                    'ideal_move': f'Stock reaches {fmt(up10)} (+10%)',
                    'greek_note': 'Near-neutral vega spread',
                },
                {
                    'rank': 4, 'name': 'Naked Short Put', 'type': 'bullish',
                    'risk_level': 'High',
                    'max_risk': f'Up to {fmt(dn10)} loss per contract (stock to zero) — requires margin',
                    'max_reward': 'Full fat premium collected (max in high IV)',
                    'legs': [f'SELL {expiry}  {fmt(atm)} Put  (naked — margin required)'],
                    'why': f'High IV creates a very large premium on ATM puts. Maximum income if stock holds at or above {fmt(atm)}. Suitable for highly liquid stocks with margin account.',
                    'ideal_move': f'Stock holds at {fmt(atm)} or rallies',
                    'greek_note': 'Large short delta + short vega — double IV crush benefit',
                },
            ]

    # ── BEARISH ───────────────────────────────────────────────────────────
    elif direction == 'BEARISH':
        if iv_regime == 'LOW':
            strategies = [
                {
                    'rank': 1, 'name': 'Long Put', 'type': 'bearish',
                    'risk_level': 'Medium',
                    'max_risk': 'Premium paid (defined)',
                    'max_reward': f'Up to {fmt(atm)} (if stock → $0)',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Put'],
                    'why': f'Low IV makes puts cheap. Best when a sharp drop below {fmt(dn5)} is expected.',
                    'ideal_move': f'Stock falls below {fmt(dn5)} (–5%)',
                    'greek_note': 'High negative delta, positive vega',
                },
                {
                    'rank': 2, 'name': 'Bear Put Spread', 'type': 'bearish',
                    'risk_level': 'Low',
                    'max_risk': 'Net debit paid',
                    'max_reward': f'Spread width minus debit (max at {fmt(dn10)})',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Put',
                             f'SELL {expiry}  {fmt(dn10)} Put'],
                    'why': f'Cheaper than outright put. Caps protection at –10% but reduces cost significantly.',
                    'ideal_move': f'Stock falls to {fmt(dn10)} (–10%)',
                    'greek_note': 'Reduced vega vs. naked long put',
                },
                {
                    'rank': 3, 'name': 'Bear Call Spread', 'type': 'bearish',
                    'risk_level': 'Low',
                    'max_risk': 'Spread width minus credit',
                    'max_reward': 'Net credit received',
                    'legs': [f'SELL {expiry}  {fmt(up5)} Call',
                             f'BUY  {expiry}  {fmt(up10)} Call'],
                    'why': f'Collect credit if stock fails to break resistance at {fmt(up5)}. No upside participation needed.',
                    'ideal_move': f'Stock stays below {fmt(up5)}',
                    'greek_note': 'Short vega, benefits from IV drop',
                },
                {
                    'rank': 4, 'name': 'Put Ratio Spread', 'type': 'bearish',
                    'risk_level': 'High',
                    'max_risk': f'Unlimited below {fmt(dn10)} (naked short puts below — requires margin)',
                    'max_reward': f'Max at {fmt(dn10)} — spread width + credit',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Put',
                             f'SELL {expiry}  {fmt(dn10)} Put  (×2)'],
                    'why': f'Net credit entry in low IV. Maximizes at {fmt(dn10)}, but losses grow if stock collapses past {fmt(dn15)}. High-conviction bounded bearish play.',
                    'ideal_move': f'Stock falls to exactly {fmt(dn10)} (–10%) then stabilizes',
                    'greek_note': 'Net short gamma below lower strike — dangerous in crashes',
                },
            ]
        else:  # HIGH IV bearish
            strategies = [
                {
                    'rank': 1, 'name': 'Bear Call Spread', 'type': 'bearish',
                    'risk_level': 'Low',
                    'max_risk': 'Spread width minus credit',
                    'max_reward': 'Net credit received',
                    'legs': [f'SELL {expiry}  {fmt(up5)} Call',
                             f'BUY  {expiry}  {fmt(up10)} Call'],
                    'why': f'High IV bloats call premiums — collect a large credit. Profit if stock stays below {fmt(up5)}.',
                    'ideal_move': f'Stock stays below {fmt(up5)}',
                    'greek_note': 'Short vega — profits from IV crush',
                },
                {
                    'rank': 2, 'name': 'Bear Put Spread', 'type': 'bearish',
                    'risk_level': 'Low',
                    'max_risk': 'Net debit paid',
                    'max_reward': 'Spread width minus debit',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Put',
                             f'SELL {expiry}  {fmt(dn10)} Put'],
                    'why': 'Short put offsets IV cost on the long leg. Directional play with reduced theta drag.',
                    'ideal_move': f'Stock falls to {fmt(dn10)} (–10%)',
                    'greek_note': 'Near-neutral vega spread',
                },
                {
                    'rank': 3, 'name': 'Long Put', 'type': 'bearish',
                    'risk_level': 'Medium',
                    'max_risk': 'Premium paid (higher cost in high IV)',
                    'max_reward': f'Up to {fmt(atm)}',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Put'],
                    'why': 'High IV increases cost but a large drop still delivers strong returns. Best for high-conviction bearish calls.',
                    'ideal_move': f'Stock falls sharply below {fmt(dn10)}',
                    'greek_note': 'Long vega — benefits if IV keeps rising',
                },
                {
                    'rank': 4, 'name': 'Naked Short Call', 'type': 'bearish',
                    'risk_level': 'High',
                    'max_risk': 'Theoretically unlimited — requires margin, highest-risk strategy',
                    'max_reward': 'Full fat premium collected (maximized in high IV)',
                    'legs': [f'SELL {expiry}  {fmt(up5)} Call  (naked — margin required)'],
                    'why': f'High IV inflates OTM call premiums dramatically. Maximum income if stock stays below {fmt(up5)}. Absolute maximum risk — a gap-up wipes the account. Only for experienced traders.',
                    'ideal_move': f'Stock stays below {fmt(up5)} through expiry',
                    'greek_note': 'Extreme short gamma + short vega — gap risk is catastrophic',
                },
            ]

    # ── NEUTRAL ───────────────────────────────────────────────────────────
    else:
        if iv_regime in ('MEDIUM', 'HIGH'):
            strategies = [
                {
                    'rank': 1, 'name': 'Iron Condor', 'type': 'neutral',
                    'risk_level': 'Low',
                    'max_risk': 'Spread width minus credit received',
                    'max_reward': 'Full credit if stock stays in range',
                    'legs': [f'SELL {expiry}  {fmt(up5)} Call',
                             f'BUY  {expiry}  {fmt(up10)} Call',
                             f'SELL {expiry}  {fmt(dn5)} Put',
                             f'BUY  {expiry}  {fmt(dn10)} Put'],
                    'why': f'High IV generates large credits on both sides. Profit zone: {fmt(dn5)} – {fmt(up5)}. Ideal for a rangebound 4 weeks.',
                    'ideal_move': f'Stock stays between {fmt(dn5)} and {fmt(up5)}',
                    'greek_note': 'Short vega — major IV crush profits',
                },
                {
                    'rank': 2, 'name': 'Short Strangle', 'type': 'neutral',
                    'risk_level': 'High',
                    'max_risk': 'Unlimited (naked)',
                    'max_reward': 'Full premium on both sides',
                    'legs': [f'SELL {expiry}  {fmt(up5)} Call',
                             f'SELL {expiry}  {fmt(dn5)} Put'],
                    'why': f'Collect premium on both wings. Requires margin. High IV creates maximum income potential. Risk: large gap move.',
                    'ideal_move': f'Stock stays between {fmt(dn5)} and {fmt(up5)}',
                    'greek_note': 'Short vega, short gamma — avoid near events',
                },
                {
                    'rank': 3, 'name': 'Iron Butterfly', 'type': 'neutral',
                    'risk_level': 'Low',
                    'max_risk': 'Spread width minus credit',
                    'max_reward': 'Max credit if stock pins ATM at expiry',
                    'legs': [f'SELL {expiry}  {fmt(atm)} Call',
                             f'BUY  {expiry}  {fmt(up10)} Call',
                             f'SELL {expiry}  {fmt(atm)} Put',
                             f'BUY  {expiry}  {fmt(dn10)} Put'],
                    'why': f'Max profit if stock pins near {fmt(atm)}. High IV makes the body credit very large.',
                    'ideal_move': f'Stock pins at {fmt(atm)} at expiry',
                    'greek_note': 'Extreme short vega, high theta decay',
                },
                {
                    'rank': 4, 'name': 'Naked Short Strangle', 'type': 'neutral',
                    'risk_level': 'High',
                    'max_risk': 'Unlimited on both sides — requires margin',
                    'max_reward': 'Full premium on both wings (maximum in high IV)',
                    'legs': [f'SELL {expiry}  {fmt(up10)} Call  (naked)',
                             f'SELL {expiry}  {fmt(dn10)} Put  (naked)'],
                    'why': f'Wider wings than standard strangle — larger profit zone ({fmt(dn10)}–{fmt(up10)}). High IV creates massive credits. Unlimited risk in either direction.',
                    'ideal_move': f'Stock stays between {fmt(dn10)} and {fmt(up10)} through expiry',
                    'greek_note': 'Maximum short vega + short gamma — catastrophic in tail moves',
                },
            ]
        else:  # LOW IV neutral — buy volatility
            strategies = [
                {
                    'rank': 1, 'name': 'Long Straddle', 'type': 'neutral',
                    'risk_level': 'Medium',
                    'max_risk': 'Total premium paid (both legs)',
                    'max_reward': 'Unlimited in either direction',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Call',
                             f'BUY  {expiry}  {fmt(atm)} Put'],
                    'why': f'Low IV makes options cheap. Profit from any large move > ~7% from {fmt(atm)}. Great before earnings or catalysts.',
                    'ideal_move': f'Stock moves >{fmt(_nearest_strike(last_price, 7))} or <{fmt(_nearest_strike(last_price, -7))} (±7%+)',
                    'greek_note': 'Long vega + long gamma — benefits from IV spike',
                },
                {
                    'rank': 2, 'name': 'Long Strangle', 'type': 'neutral',
                    'risk_level': 'Medium',
                    'max_risk': 'Total premium paid',
                    'max_reward': 'Unlimited in either direction',
                    'legs': [f'BUY  {expiry}  {fmt(up5)} Call',
                             f'BUY  {expiry}  {fmt(dn5)} Put'],
                    'why': 'Cheaper than straddle — OTM options cost less. Needs a larger move to profit but lower breakeven.',
                    'ideal_move': 'Stock moves > ±10% from current price',
                    'greek_note': 'Long vega + long gamma',
                },
                {
                    'rank': 3, 'name': 'Iron Condor', 'type': 'neutral',
                    'risk_level': 'Low',
                    'max_risk': 'Spread width minus credit',
                    'max_reward': 'Net credit (modest in low IV)',
                    'legs': [f'SELL {expiry}  {fmt(up5)} Call',
                             f'BUY  {expiry}  {fmt(up10)} Call',
                             f'SELL {expiry}  {fmt(dn5)} Put',
                             f'BUY  {expiry}  {fmt(dn10)} Put'],
                    'why': f'Defined risk if you expect no big move. Credit is smaller in low IV but risk is fully capped.',
                    'ideal_move': f'Stock stays between {fmt(dn5)} and {fmt(up5)}',
                    'greek_note': 'Short vega, limited risk on both sides',
                },
                {
                    'rank': 4, 'name': 'Leveraged Long Straddle', 'type': 'neutral',
                    'risk_level': 'High',
                    'max_risk': 'Total premium × 2 contracts (double size)',
                    'max_reward': 'Unlimited in either direction (2× leverage)',
                    'legs': [f'BUY  {expiry}  {fmt(atm)} Call  (×2)',
                             f'BUY  {expiry}  {fmt(atm)} Put   (×2)'],
                    'why': f'Low IV keeps both legs cheap. Doubling size maximizes gamma exposure around {fmt(atm)}. Best before an expected major catalyst (earnings, FDA, macro data) where you are uncertain of direction.',
                    'ideal_move': f'Stock makes a large move (>10%) in either direction',
                    'greek_note': '2× long gamma + 2× long vega — benefits massively from IV spike',
                },
            ]

    return strategies


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_options_report(hist: pd.DataFrame, indicators: dict, prediction: dict,
                          news: list, symbol: str, last_price: float) -> dict:
    analysis   = analyze_signals(hist, indicators, prediction, news)
    strategies = get_strategies(last_price, analysis)

    return {
        'symbol':         symbol,
        'price':          round(last_price, 2),
        'direction':      analysis['direction'],
        'confidence':     analysis['confidence'],
        'score':          analysis['score'],
        'iv_regime':      analysis['iv_regime'],
        'hv20':           analysis['hv20'],
        'vol_signal':     analysis['vol_signal'],
        'vol_ratio':      analysis['vol_ratio'],
        'catalyst_flags': analysis['catalyst_flags'],
        'signals':        analysis['signals'],
        'strategies':     strategies,
        'expiry_target':  (datetime.now() + timedelta(days=28)).strftime('%b %d, %Y'),
        'generated_at':   datetime.now().strftime('%Y-%m-%d %H:%M'),
        'disclaimer':     'For educational purposes only. Not financial advice. Options trading involves substantial risk of loss.',
    }
