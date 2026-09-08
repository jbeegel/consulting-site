"""Export a self-contained HTML snapshot of the dashboard (embeds current data) for sharing."""
from __future__ import annotations

import json
import time
from pathlib import Path

from .config import Settings
from .db import Store
from .server import STATIC, build_opportunity
from .scoring import TIME_BUCKETS, score_lot


def export_html(settings: Settings, store: Store, out: Path, *, demo: bool = False) -> Path:
    now = time.time()
    lots = store.lots(ends_after=now - 60)
    vals = store.valuations_for([l["id"] for l in lots])
    opps = [build_opportunity(l, vals.get(l["id"]), settings, now) for l in lots]
    opps.sort(key=lambda o: o["score"]["score"], reverse=True)
    agg: dict[str, dict] = {}
    for o in opps:
        c = o["lot"].get("category") or "Uncategorized"
        a = agg.setdefault(c, {"category": c, "lots": 0, "valued": 0, "best_score": 0.0, "hot": 0})
        a["lots"] += 1
        if o["valuation"]:
            a["valued"] += 1
            a["best_score"] = max(a["best_score"], o["score"]["score"])
            a["hot"] += o["score"]["score"] >= 60
    cats = sorted(agg.values(), key=lambda a: (-a["best_score"], -a["lots"]))
    data = {
        "config": {"buyer_premium": settings.default_buyer_premium, "sales_tax": settings.sales_tax,
                   "resale_fee": settings.resale_fee, "resale_shipping": settings.resale_shipping,
                   "pickup_cost": settings.pickup_cost, "model": "demo" if demo else settings.model,
                   "claude_enabled": False, "ebay_sold": False, "hibid": settings.hibid_site,
                   "time_buckets": [b[0] for b in TIME_BUCKETS]},
        "opportunities": opps, "categories": cats,
        "status": {"status": {"phase": "done", "lots_seen": len(opps), "lots_valued": len(vals)},
                   "last_scan": {"finished_at": now}, "stats": {"open_lots": len(opps), "valued_lots": len(vals)}},
        "exported_at": now,
    }
    html = (STATIC / "index.html").read_text()
    payload = json.dumps(data).replace("</", "<\\/")
    html = html.replace("<script>\n(function(){", f"<script>window.__ARB_DATA__={payload};</script>\n<script>\n(function(){{", 1)
    out.write_text(html)
    return out
