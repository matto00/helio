#!/usr/bin/env python3
"""Summarise HEL-1665-spec shift-*.json files (fontSwapSpread) of one or more run dirs into a markdown table.
usage: summarize.py label=dir [label=dir ...]   (rows: viewport; columns: label x theme; max over both orders)"""
import glob, json, os, re, sys
runs = [a.split("=", 1) for a in sys.argv[1:]]
data = {}
for label, d in runs:
    for f in glob.glob(os.path.join(d, "shift-*.json")):
        j = json.load(open(f))
        key = (j["viewport"]["width"], j["viewport"]["height"])
        for th in ("light", "dark"):
            if j["theme"] == th:
                cur = data.setdefault(key, {}).setdefault((label, th), [])
                cur.append(j["fontSwapSpread"])
cols = [(l, t) for l, _ in runs for t in ("light", "dark")]
print("| viewport | " + " | ".join(f"{l} {t}" for l, t in cols) + " |")
print("|" + "--|" * (len(cols) + 1))
for key in sorted(data):
    row = []
    for c in cols:
        v = data[key].get(c)
        row.append("-" if not v else (str(max(v)) if min(v) == max(v) else f"{min(v)}..{max(v)}"))
    print(f"| {key[0]}x{key[1]} | " + " | ".join(row) + " |")
