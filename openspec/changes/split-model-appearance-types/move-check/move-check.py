#!/usr/bin/env python3
"""usage: move-check.py <base-model.scala> <model.scala> <ChartAppearance.scala> <PanelAppearance.scala>
Forward + positional reverse + coverage check of the HEL-1376 byte-move (design D6a)."""
import sys
base_p, model_p, chart_p, panel_p = sys.argv[1:5]
rd = lambda p: open(p).read().split("\n")
B = rd(base_p)
if B and B[-1] == "": B = B[:-1]
b = lambda a, z: [(i, B[i-1]) for i in range(a, z+1)]  # 1-based inclusive
CHART = b(206, 216) + b(220, 374)
PANEL = b(218, 218) + b(399, 491)
IMPORTS = b(3, 3) + b(7, 7)
moved = {i for i, _ in CHART + PANEL + IMPORTS}
KEPT = [(i, B[i-1]) for i in range(1, len(B)+1) if i not in moved]
scaffold_chart = ["package com.helio.domain.model", "import com.helio.api.http.RequestValidation", "import spray.json._"]
scaffold_panel = ["package com.helio.domain.model", "import com.helio.api.http.RequestValidation", "import org.slf4j.LoggerFactory", "import spray.json._"]
nb = lambda xs: [x for x in xs if x.strip() != ""]
fail = []
# coverage: every non-blank base line is kept, moved once, or a removed import
cats = {}
for name, spans in (("chart", CHART), ("panel", PANEL), ("import", IMPORTS), ("kept", KEPT)):
    for i, _ in spans:
        cats.setdefault(i, []).append(name)
for i, t in enumerate(B, 1):
    if t.strip() and len(cats.get(i, [])) != 1:
        fail.append(f"coverage: base line {i} categories={cats.get(i)}")
# the base package line must be the only line kept in model.scala that is also scaffold
def positional(label, actual_path, expected):
    act = nb(rd(actual_path)); exp = nb(expected)
    n = max(len(act), len(exp))
    for k in range(n):
        a = act[k] if k < len(act) else "<missing>"
        e = exp[k] if k < len(exp) else "<extra in file>"
        if a != e:
            fail.append(f"{label}: nonblank line {k+1} differs\n   file:     {a!r}\n   expected: {e!r}"); return
    print(f"OK {label}: {len(act)} non-blank lines match positionally")
# forward is implied by positional against base text; also report explicit forward per span
positional("ChartAppearance.scala", chart_p, scaffold_chart + [t for _, t in CHART])
positional("PanelAppearance.scala", panel_p, scaffold_panel + [t for _, t in PANEL])
positional("model.scala", model_p, [t for _, t in KEPT])
print(f"coverage: {sum(1 for t in B if t.strip())} non-blank base lines; moved chart={len(nb([t for _,t in CHART]))} panel={len(nb([t for _,t in PANEL]))} imports={len(IMPORTS)} kept={len(nb([t for _,t in KEPT]))}")
if fail:
    print("FAIL"); [print(" ", f) for f in fail]; sys.exit(1)
print("PASS")
