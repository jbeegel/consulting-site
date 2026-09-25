#!/usr/bin/env python3
"""Regenerate the BUILTIN_LENSES block in arb/lenses.py from lib/spread/lenses.ts.

A lens is mostly prose -- a paragraph telling an appraiser what to physically look at -- and that prose
has to be word-for-word identical in both backends or the two stacks quietly appraise differently. So it
is written once, in TypeScript next to the rest of the watchlist code, and transliterated here.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ts = (ROOT / "lib/spread/lenses.ts").read_text()
decl = ts.index("export const BUILTIN_LENSES")
body = ts[ts.index("= [", decl) + 2:ts.index("export function defaultWatchlist")]
body = body[:body.rindex("]") + 1]

s = re.sub(r"^\s*//.*$", "", body, flags=re.M)                          # whole-line comments only
s = re.sub(r'"\s*\n\s*\+\s*"', "", s)                                   # "a"\n + "b" -> "ab"
s = re.sub(r"(\n\s*)([A-Za-z_][A-Za-z0-9_]*):", r'\1"\2":', s)          # bare keys -> quoted
s = re.sub(r",(\s*[\]\}])", r"\1", s)                                   # trailing commas
lenses = json.loads(s)
assert lenses and all(l.get("id") and l.get("prompt") for l in lenses), "lens pack looks malformed"
# `builtin` is the only boolean in the block and it is true by definition here; dropping it keeps the
# generated literal valid Python (JSON's `true` is not), and arb/lenses.py adds it back on read.
for l in lenses:
    l.pop("builtin", None)

target = ROOT / "tools/auction-arbitrage/arb/lenses.py"
text = target.read_text()
head, sep, rest = text.partition("BUILTIN_LENSES: list[dict[str, Any]] = ")
assert sep, "marker not found in arb/lenses.py"
tail = rest[rest.index("\n# --- end lenses ---"):]
target.write_text(head + sep + json.dumps(lenses, indent=4, ensure_ascii=False) + tail)
print(f"wrote {len(lenses)} lenses -> {target}")
