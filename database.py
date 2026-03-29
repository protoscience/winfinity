import os
import sqlite3

_default_db = os.path.join(os.path.dirname(__file__), 'data', 'winfinity.db')
DB_PATH = os.environ.get('DB_PATH', _default_db)

DEFAULT_LISTS = {
    'Top 20':      ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','BRK-B','LLY','AVGO',
                    'JPM','UNH','XOM','JNJ','V','MA','PG','HD','COST','ABBV'],
    'Technology':  ['AAPL','MSFT','NVDA','GOOGL','META','AVGO','AMD','TSM','ORCL','CRM',
                    'INTC','QCOM','TXN','MU','AMAT','LRCX','KLAC','SNPS','ADBE','CSCO'],
    'Energy':      ['XOM','CVX','COP','SLB','EOG','PSX','MPC','VLO','OXY','HAL',
                    'DVN','HES','BKR','MRO','APA','FANG','TPL','RRC','AR','EQT'],
    'Financials':  ['JPM','BAC','WFC','GS','MS','BRK-B','V','MA','AXP','BLK',
                    'C','USB','PNC','TFC','COF','SCHW','CB','MMC','AON','ICE'],
    'Healthcare':  ['UNH','LLY','JNJ','ABBV','MRK','PFE','TMO','ABT','BMY','AMGN',
                    'MDT','ISRG','ELV','CVS','CI','HUM','REGN','VRTX','BIIB','GILD'],
    'Consumer':    ['AMZN','TSLA','HD','COST','MCD','NKE','SBUX','TGT','WMT','PG',
                    'KO','PEP','PM','MO','MDLZ','CL','GIS','LOW','TJX','ROST'],
    'Industrials': ['CAT','BA','GE','HON','UPS','RTX','DE','LMT','NOC','FDX',
                    'CSX','NSC','UNP','EMR','ETN','ITW','ROK','IR','PH','GWW'],
}


def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS stock_lists (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL UNIQUE,
                position   INTEGER DEFAULT 0,
                created_at TEXT    DEFAULT (datetime('now')),
                updated_at TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS list_stocks (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id  INTEGER NOT NULL REFERENCES stock_lists(id) ON DELETE CASCADE,
                symbol   TEXT    NOT NULL,
                position INTEGER DEFAULT 0,
                added_at TEXT    DEFAULT (datetime('now')),
                UNIQUE(list_id, symbol)
            );
        """)
        # Seed defaults only on first run
        count = conn.execute('SELECT COUNT(*) FROM stock_lists').fetchone()[0]
        if count == 0:
            _seed_defaults(conn)


def _seed_defaults(conn):
    for i, (name, symbols) in enumerate(DEFAULT_LISTS.items()):
        conn.execute(
            'INSERT INTO stock_lists (name, position) VALUES (?, ?)', (name, i)
        )
        list_id = conn.execute(
            'SELECT id FROM stock_lists WHERE name=?', (name,)
        ).fetchone()['id']
        for j, sym in enumerate(symbols):
            conn.execute(
                'INSERT INTO list_stocks (list_id, symbol, position) VALUES (?,?,?)',
                (list_id, sym, j)
            )


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def get_all_lists() -> list:
    with get_db() as conn:
        rows = conn.execute(
            'SELECT id, name, position FROM stock_lists ORDER BY position, id'
        ).fetchall()
        result = []
        for row in rows:
            stocks = conn.execute(
                'SELECT symbol FROM list_stocks WHERE list_id=? ORDER BY position, id',
                (row['id'],)
            ).fetchall()
            result.append({
                'id':       row['id'],
                'name':     row['name'],
                'position': row['position'],
                'symbols':  [s['symbol'] for s in stocks],
            })
        return result


def get_list(list_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            'SELECT id, name, position FROM stock_lists WHERE id=?', (list_id,)
        ).fetchone()
        if not row:
            return None
        stocks = conn.execute(
            'SELECT symbol FROM list_stocks WHERE list_id=? ORDER BY position, id',
            (list_id,)
        ).fetchall()
        return {
            'id':      row['id'],
            'name':    row['name'],
            'position': row['position'],
            'symbols': [s['symbol'] for s in stocks],
        }


# ---------------------------------------------------------------------------
# Lists CRUD
# ---------------------------------------------------------------------------

def create_list(name: str) -> dict:
    with get_db() as conn:
        max_pos = conn.execute('SELECT COALESCE(MAX(position),0) FROM stock_lists').fetchone()[0]
        conn.execute(
            'INSERT INTO stock_lists (name, position) VALUES (?,?)',
            (name.strip(), max_pos + 1)
        )
        list_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    return get_list(list_id)


def rename_list(list_id: int, name: str) -> dict | None:
    with get_db() as conn:
        conn.execute(
            "UPDATE stock_lists SET name=?, updated_at=datetime('now') WHERE id=?",
            (name.strip(), list_id)
        )
    return get_list(list_id)


def reorder_lists(order: list[int]) -> list:
    """order = list of list IDs in desired sequence."""
    with get_db() as conn:
        for pos, list_id in enumerate(order):
            conn.execute(
                "UPDATE stock_lists SET position=?, updated_at=datetime('now') WHERE id=?",
                (pos, list_id)
            )
    return get_all_lists()


def delete_list(list_id: int) -> bool:
    with get_db() as conn:
        rowcount = conn.execute(
            'DELETE FROM stock_lists WHERE id=?', (list_id,)
        ).rowcount
    return rowcount > 0


# ---------------------------------------------------------------------------
# Stocks CRUD
# ---------------------------------------------------------------------------

def add_stock(list_id: int, symbol: str) -> dict | None:
    symbol = symbol.upper().strip()
    with get_db() as conn:
        max_pos = conn.execute(
            'SELECT COALESCE(MAX(position),0) FROM list_stocks WHERE list_id=?', (list_id,)
        ).fetchone()[0]
        try:
            conn.execute(
                'INSERT INTO list_stocks (list_id, symbol, position) VALUES (?,?,?)',
                (list_id, symbol, max_pos + 1)
            )
            conn.execute(
                "UPDATE stock_lists SET updated_at=datetime('now') WHERE id=?", (list_id,)
            )
        except sqlite3.IntegrityError:
            pass  # already exists
    return get_list(list_id)


def remove_stock(list_id: int, symbol: str) -> dict | None:
    symbol = symbol.upper().strip()
    with get_db() as conn:
        conn.execute(
            'DELETE FROM list_stocks WHERE list_id=? AND symbol=?', (list_id, symbol)
        )
        conn.execute(
            "UPDATE stock_lists SET updated_at=datetime('now') WHERE id=?", (list_id,)
        )
    return get_list(list_id)


# ---------------------------------------------------------------------------
# GitHub sync helpers
# ---------------------------------------------------------------------------

def export_lists() -> dict:
    """Serialize all lists to a JSON-friendly dict for GitHub push."""
    return {'lists': get_all_lists()}


def import_lists(data: dict) -> list:
    """Replace all lists from a GitHub-pulled dict."""
    lists = data.get('lists', [])
    with get_db() as conn:
        conn.execute('DELETE FROM stock_lists')   # CASCADE deletes list_stocks too
        for i, lst in enumerate(lists):
            conn.execute(
                'INSERT INTO stock_lists (id, name, position) VALUES (?,?,?)',
                (lst['id'], lst['name'], i)
            )
            for j, sym in enumerate(lst.get('symbols', [])):
                conn.execute(
                    'INSERT INTO list_stocks (list_id, symbol, position) VALUES (?,?,?)',
                    (lst['id'], sym, j)
                )
    return get_all_lists()
