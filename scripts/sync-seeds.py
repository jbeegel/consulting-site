#!/usr/bin/env python3
"""Regenerate arb/seeds.py from lib/spread/seeds.ts so the two backends cannot drift.

The seed pack is prose-heavy and identical for both stacks, so it lives in one place (TypeScript, next
to the rest of the playbook) and is transliterated here rather than maintained twice.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ts = (ROOT / "lib/spread/seeds.ts").read_text()
decl = ts.index("export const SEED_THESES")
body = ts[ts.index("= [", decl) + 2:ts.index("/** The seed pack as full Thesis objects")]
body = body[:body.rindex("]") + 1]

s = re.sub(r"^\s*//.*$", "", body, flags=re.M)                          # whole-line comments only
s = re.sub(r'"\s*\n\s*\+\s*"', "", s)                                   # "a"\n + "b" -> "ab"
s = re.sub(r"(\n\s*)([A-Za-z_][A-Za-z0-9_]*):", r'\1"\2":', s)           # bare keys -> quoted
s = re.sub(r",(\s*[\]\}])", r"\1", s)                                    # trailing commas
seeds = json.loads(s)
assert seeds and all(x.get("name") and x.get("queries") for x in seeds), "seed pack looks malformed"

target = ROOT / "tools/auction-arbitrage/arb/seeds.py"
head = target.read_text().split("SEED_THESES: list[dict[str, Any]] = ")[0]
target.write_text(head + "SEED_THESES: list[dict[str, Any]] = " + json.dumps(seeds, indent=4, ensure_ascii=False) + "\n")
print(f"wrote {len(seeds)} seeds -> {target}")
