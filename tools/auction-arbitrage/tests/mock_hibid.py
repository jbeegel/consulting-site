"""A stand-in for hibid.com/graphql that speaks the same operations, backed by demo lots.

Run standalone to point the real tool at it:
    python -m tests.mock_hibid   # serves on :8799
    ARB_HIBID_GRAPHQL=http://127.0.0.1:8799/graphql ARB_HIBID_SITE=http://127.0.0.1:8799 python -m arb scan --no-value
"""
from __future__ import annotations

import time

from fastapi import FastAPI, Request

from arb.demo import make_demo, to_raw_graphql


def build(seed: int = 7) -> FastAPI:
    app = FastAPI()
    lots, _ = make_demo(seed=seed, now=time.time())
    raw = {l["id"]: to_raw_graphql(l) for l in lots}
    app.state.calls = []

    @app.post("/graphql")
    async def graphql(req: Request):
        body = await req.json()
        op, var = body.get("operationName"), body.get("variables") or {}
        app.state.calls.append(op)
        if op == "LotSearch":
            items = list(raw.values())
            if var.get("searchText"):
                items = [r for r in items if var["searchText"].lower() in r["lead"].lower()]
            if var.get("category"):
                items = [r for r in items if r["category"]["id"] == var["category"]]
            items.sort(key=lambda r: r["lotState"]["timeLeftSeconds"], reverse=(var.get("sortDirection") == "DESC"))
            pl, pn = int(var.get("pageLength", 100)), int(var.get("pageNumber", 1))
            page = items[(pn - 1) * pl: pn * pl]
            return {"data": {"lotSearch": {"pagedResults": {"pageLength": pl, "pageNumber": pn, "totalCount": len(raw),
                                                            "filteredCount": len(items), "results": page}}}}
        if op == "GetLotStateQuery":
            r = raw.get(int(var["lotId"]))
            if not r:
                return {"data": {"lotState": None}, "errors": [{"message": "not found"}]}
            st = dict(r["lotState"])
            st["highBid"] = (st["highBid"] or 0) + 5  # simulate a new bid since the scan
            st["bidCount"] += 1
            st["minBid"] = st["highBid"] + 1
            st["timeLeftSeconds"] = max(0, st["timeLeftSeconds"] - 60)
            return {"data": {"lotState": st}}
        if op == "GetLotDetails":
            r = raw.get(int(var["lotId"]))
            if not r:
                return {"data": {"lot": {"accessability": "HIDDEN", "lot": None}}}
            full = dict(r, pictures=[{"fullSizeLocation": "https://example.invalid/p1.jpg", "hdThumbnailLocation": None}])
            full["auction"] = dict(r["auction"], termsAndConditions="Demo terms", shippingAndPickupInfo="Pickup only", paymentInfo="Card")
            return {"data": {"lot": {"accessability": "PUBLIC", "lot": full}}}
        if op == "CategoryTree":
            return {"data": {"categoryTree": [{"id": 1, "parentCategoryId": None, "baseCategoryId": 1, "categoryName": "Tools",
                                              "fullCategory": "Tools", "hasChildren": False, "uRLPath": "tools", "children": []}]}}
        return {"errors": [{"message": f"unknown operation {op}"}]}

    @app.get("/graphql")
    def health():
        return {"version": "1.0.0.0", "site": "MOCK"}

    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(build(), host="127.0.0.1", port=8799)
