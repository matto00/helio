#!/usr/bin/env python3
"""HEL-1735 mechanical gate: wrap every ungated :hover rule in `@media (hover: hover)` in place (D1), splitting a mixed
selector list so the non-hover members stay ungated at the same position and the :hover members follow in the gate (D2).
Usage: gate-hover.py <frontend/src> <file.css>... (paths relative to frontend/src). Output is then run through prettier.
Skips rules already gated and the allowlisted reveal (ALLOW). Recurses only into @media/@supports/@container/@layer."""
import re, sys

HOVER = "@media (hover: hover)"
ALLOW = {("features/dashboards/ui/DashboardList.css", ".dashboard-list__item-row:hover .popover.actions-menu")}
NEST = re.compile(r"^@(media|supports|container|layer)")


def strip_comments(s):
    return re.sub(r"/\*[\s\S]*?\*/", "", s)


def split_top(sel):
    parts, depth, cur = [], 0, ""
    for c in sel:
        if c in "([": depth += 1
        if c in ")]": depth -= 1
        if c == "," and depth == 0:
            parts.append(cur.strip()); cur = ""
        else:
            cur += c
    parts.append(cur.strip())
    return [p for p in parts if p]


def blocks(css, lo, hi):
    """Yield (prelude_start, open, close_exclusive) for each top-level block in css[lo:hi]; comments are skipped."""
    i = lo; start = lo
    while i < hi:
        if css.startswith("/*", i):
            i = css.index("*/", i) + 2
            continue
        c = css[i]
        if c == ";" : start = i + 1
        if c == "{":
            depth = 1; j = i + 1
            while depth and j < hi:
                if css.startswith("/*", j): j = css.index("*/", j) + 2; continue
                if css[j] == "{": depth += 1
                elif css[j] == "}": depth -= 1
                j += 1
            yield start, i, j
            start = j; i = j; continue
        if c == "}": start = i + 1
        i += 1


def lead_end(css, a, b):
    """Index of the first non-whitespace, non-comment char in css[a:b]."""
    i = a
    while i < b:
        if css[i].isspace(): i += 1
        elif css.startswith("/*", i): i = css.index("*/", i) + 2
        else: break
    return i


def transform(css, f, lo, hi, gated):
    out = []; pos = lo; n_rules = 0; n_split = 0; prev_gate = False
    for ps, op, cl in blocks(css, lo, hi):
        ls = lead_end(css, ps, op)
        if css[pos:ls].strip() != "": prev_gate = False
        prelude = css[ls:op]
        body_start, body_end = op + 1, cl - 1
        pre_norm = re.sub(r"\s+", " ", strip_comments(prelude)).strip()
        if pre_norm.startswith("@"):
            prev_gate = False
            if NEST.match(pre_norm):
                inner, r, s = transform(css, f, body_start, body_end, gated or pre_norm == HOVER)
                n_rules += r; n_split += s
                out.append(css[pos:body_start]); out.append(inner); pos = body_end
            continue
        sels = split_top(re.sub(r"\s+", " ", strip_comments(prelude)))
        hov = [s for s in sels if ":hover" in s]
        if gated or not hov or all((f, s) in ALLOW for s in hov):
            prev_gate = False
            continue
        if "/*" in prelude: raise SystemExit(f"{f}: comment inside selector list: {prelude!r}")
        non = [s for s in sels if ":hover" not in s]
        body = css[body_start:body_end]
        rule = lambda ss: ",\n".join(ss) + " {" + body + "}"
        gap = css[pos:ls]
        if prev_gate and not non and gap.strip() == "":
            # Directly after another gated rule with only whitespace between: share its @media block.
            out[-1] = out[-1][:-2]
            out.append("\n\n" + rule(hov) + "\n}")
        else:
            text = (rule(non) + "\n\n" if non else "") + HOVER + " {\n" + rule(hov) + "\n}"
            out.append(gap); out.append(text)
        prev_gate = True; pos = cl; n_rules += 1; n_split += bool(non); continue
    out.append(css[pos:hi])
    return "".join(out), n_rules, n_split


if __name__ == "__main__":
    root = sys.argv[1]; tot = 0; sp = 0
    for f in sys.argv[2:]:
        p = f"{root}/{f}"; css = open(p).read()
        new, r, s = transform(css, f, 0, len(css), False)
        open(p, "w").write(new); tot += r; sp += s
        print(f"{f}: gated {r} rules ({s} split)")
    print(f"TOTAL gated rules={tot} split={sp}")
