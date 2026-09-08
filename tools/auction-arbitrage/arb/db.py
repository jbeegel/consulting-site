"""SQLite persistence: lots (latest snapshot), valuations, a title-keyed valuation cache, scan log."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY,
  title TEXT, category TEXT, category_path TEXT, auction_id INTEGER,
  ends_at REAL, high_bid REAL, min_bid REAL, bid_count INTEGER, is_closed INTEGER,
  fetched_at REAL, first_seen REAL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lots_ends ON lots(ends_at);
CREATE INDEX IF NOT EXISTS lots_cat ON lots(category);
CREATE TABLE IF NOT EXISTS valuations (
  lot_id INTEGER PRIMARY KEY, title_key TEXT, low REAL, mid REAL, high REAL, confidence REAL,
  method TEXT, created_at REAL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS valuation_cache (
  title_key TEXT PRIMARY KEY, created_at REAL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at REAL, finished_at REAL, status TEXT,
  params TEXT, lots_seen INTEGER DEFAULT 0, lots_valued INTEGER DEFAULT 0, message TEXT
);
"""


class Store:
    def __init__(self, path: str = "arb.sqlite3"):
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        with self._lock:
            self._conn.executescript(SCHEMA)

    # ------------------------------------------------------------------ lots
    def upsert_lots(self, lots: Iterable[dict[str, Any]]) -> int:
        n = 0
        now = time.time()
        with self._lock:
            self._conn.execute("BEGIN")
            for lot in lots:
                self._conn.execute(
                    """INSERT INTO lots (id,title,category,category_path,auction_id,ends_at,high_bid,min_bid,
                       bid_count,is_closed,fetched_at,first_seen,data)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET title=excluded.title, category=excluded.category,
                         category_path=excluded.category_path, auction_id=excluded.auction_id,
                         ends_at=excluded.ends_at, high_bid=excluded.high_bid, min_bid=excluded.min_bid,
                         bid_count=excluded.bid_count, is_closed=excluded.is_closed,
                         fetched_at=excluded.fetched_at, data=excluded.data""",
                    (lot["id"], lot.get("title"), lot.get("category"), lot.get("category_path"),
                     lot.get("auction_id"), lot.get("ends_at"), lot.get("high_bid"), lot.get("min_bid"),
                     lot.get("bid_count"), int(bool(lot.get("is_closed"))), lot.get("fetched_at", now), now,
                     json.dumps(lot)),
                )
                n += 1
            self._conn.execute("COMMIT")
        return n

    def get_lot(self, lot_id: int) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM lots WHERE id=?", (lot_id,)).fetchone()
        return json.loads(row["data"]) if row else None

    def lots(self, *, include_closed: bool = False, ends_before: float | None = None,
             ends_after: float | None = None, category: str | None = None, limit: int | None = None,
             only_unvalued: bool = False) -> list[dict[str, Any]]:
        sql = "SELECT l.data FROM lots l"
        where, args = [], []
        if only_unvalued:
            sql += " LEFT JOIN valuations v ON v.lot_id=l.id"
            where.append("v.lot_id IS NULL")
        if not include_closed:
            where.append("l.is_closed=0")
        if ends_before is not None:
            where.append("l.ends_at <= ?"); args.append(ends_before)
        if ends_after is not None:
            where.append("(l.ends_at IS NULL OR l.ends_at >= ?)"); args.append(ends_after)
        if category:
            where.append("l.category = ?"); args.append(category)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY l.ends_at ASC"
        if limit:
            sql += f" LIMIT {int(limit)}"
        with self._lock:
            rows = self._conn.execute(sql, args).fetchall()
        return [json.loads(r["data"]) for r in rows]

    def purge_closed(self, older_than_seconds: float = 3 * 86400) -> int:
        cutoff = time.time() - older_than_seconds
        with self._lock:
            cur = self._conn.execute("DELETE FROM lots WHERE is_closed=1 AND fetched_at < ?", (cutoff,))
        return cur.rowcount

    # ------------------------------------------------------------ valuations
    def save_valuation(self, lot_id: int, val: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                """INSERT INTO valuations (lot_id,title_key,low,mid,high,confidence,method,created_at,data)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(lot_id) DO UPDATE SET title_key=excluded.title_key, low=excluded.low, mid=excluded.mid,
                     high=excluded.high, confidence=excluded.confidence, method=excluded.method,
                     created_at=excluded.created_at, data=excluded.data""",
                (lot_id, val.get("title_key"), val.get("low"), val.get("mid"), val.get("high"),
                 val.get("confidence"), val.get("method"), val.get("created_at", time.time()), json.dumps(val)),
            )
            if val.get("title_key") and val.get("method") not in (None, "none"):
                self._conn.execute(
                    "INSERT OR REPLACE INTO valuation_cache (title_key, created_at, data) VALUES (?,?,?)",
                    (val["title_key"], val.get("created_at", time.time()), json.dumps(val)),
                )

    def get_valuation(self, lot_id: int) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM valuations WHERE lot_id=?", (lot_id,)).fetchone()
        return json.loads(row["data"]) if row else None

    def valuations_for(self, lot_ids: Iterable[int]) -> dict[int, dict[str, Any]]:
        ids = list(lot_ids)
        out: dict[int, dict[str, Any]] = {}
        with self._lock:
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                q = f"SELECT lot_id, data FROM valuations WHERE lot_id IN ({','.join('?' * len(chunk))})"
                for r in self._conn.execute(q, chunk):
                    out[r["lot_id"]] = json.loads(r["data"])
        return out

    def cached_valuation(self, title_key: str, max_age_seconds: float) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT created_at, data FROM valuation_cache WHERE title_key=?",
                                     (title_key,)).fetchone()
        if not row or (time.time() - row["created_at"]) > max_age_seconds:
            return None
        return json.loads(row["data"])

    def delete_valuation(self, lot_id: int) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM valuations WHERE lot_id=?", (lot_id,))

    # ------------------------------------------------------------------ scans
    def start_scan(self, params: dict[str, Any]) -> int:
        with self._lock:
            cur = self._conn.execute("INSERT INTO scans (started_at,status,params) VALUES (?,?,?)",
                                     (time.time(), "running", json.dumps(params)))
            return int(cur.lastrowid)

    def update_scan(self, scan_id: int, **fields: Any) -> None:
        if not fields:
            return
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._lock:
            self._conn.execute(f"UPDATE scans SET {cols} WHERE id=?", (*fields.values(), scan_id))

    def last_scan(self) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return None
        d = dict(row)
        d["params"] = json.loads(d["params"] or "{}")
        return d

    def stats(self) -> dict[str, Any]:
        with self._lock:
            lots = self._conn.execute("SELECT COUNT(*) c FROM lots WHERE is_closed=0").fetchone()["c"]
            valued = self._conn.execute(
                "SELECT COUNT(*) c FROM valuations v JOIN lots l ON l.id=v.lot_id WHERE l.is_closed=0").fetchone()["c"]
        return {"open_lots": lots, "valued_lots": valued}

    def close(self) -> None:
        with self._lock:
            self._conn.close()
