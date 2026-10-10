#!/usr/bin/env python3
"""Move checker (HEL-1463 design D6a), adapted from HEL-1371. usage: check.py <base-sha> <spec.json> <dir-with-the-ten-files>
Forward : every inventoried member's base text equals its text in the new file (only `private` -> `private[pipelines]`
          on the declaration line is allowed).
Reverse : walking each new file top to bottom, every non-blank line must be consumed POSITIONALLY by the next expected
          item (a member block or an explicit scaffold line tagged with its D3 category); any extra / missing /
          altered line fails.
Coverage: every non-blank base line of the class header + body + top-level case class + companion (35..2571, except
          the class-closing brace 2384) is claimed by exactly one member block.
Block rule: each block's first line is a comment line or its declaration, and the BASE line before it is blank or is
          the last line of another claimed block, so a doc can never be split from its member."""
import json, subprocess, sys, collections, os, re
sha, specp, d = sys.argv[1:4]
BASEPATH = "backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala"
W = os.environ.get("W", "/home/matt/Development/helio/.claude/worktrees/task/split-pipeline-service/hel-1463")
base = subprocess.check_output(["git", "-C", W, "show", f"{sha}:{BASEPATH}"], text=True).split("\n")
if base[-1] == "": base = base[:-1]
spec = json.load(open(specp)); fails = []; stats = {}
claims = collections.Counter(); ranges = []
for fn, items in spec.items():
    lines = open(os.path.join(d, fn)).read().split("\n")
    if lines and lines[-1] == "": lines = lines[:-1]
    pos = 0; st = collections.Counter()
    for it in items:
        while pos < len(lines) and lines[pos] == "": pos += 1
        if "member" in it:
            a, b = it["range"]; ranges.append((a, b, it["member"]))
            for orig in range(a, b + 1):
                exp = base[orig - 1]
                if str(orig) in it["subst"]:
                    new = it["subst"][str(orig)]
                    if new != exp.replace("private ", "private[pipelines] ", 1) or new == exp:
                        fails.append(f"{fn}: illegal substitution at base line {orig}")
                    exp = new; st["visibility-subst"] += 1
                else: st["moved/kept verbatim"] += 1
                if pos >= len(lines) or lines[pos] != exp:
                    got = lines[pos] if pos < len(lines) else "<EOF>"
                    fails.append(f"{fn}:{pos+1}: member {it['member']} base line {orig} mismatch\n    expected: {exp!r}\n    actual:   {got!r}")
                pos += 1; claims[orig] += 1
        else:
            if pos >= len(lines) or lines[pos] != it["scaffold"]:
                got = lines[pos] if pos < len(lines) else "<EOF>"
                fails.append(f"{fn}:{pos+1}: scaffold [{it['cat']}] expected {it['scaffold']!r} got {got!r}")
            pos += 1; st["scaffold:" + it["cat"]] += 1
    while pos < len(lines) and lines[pos] == "": pos += 1
    if pos < len(lines): fails.append(f"{fn}:{pos+1}: UNACCOUNTED line(s) from here on: {lines[pos]!r} (+{len(lines)-pos-1} more)")
    stats[fn] = (len(lines), st)
body = [i for i in range(35, 2572) if i != 2384 and base[i - 1].strip() != ""]
unclaimed = [i for i in body if claims[i] == 0]; multi = [i for i in body if claims[i] > 1]
if unclaimed: fails.append(f"base lines not claimed by any member: {unclaimed[:20]} (n={len(unclaimed)})")
if multi: fails.append(f"base lines claimed more than once: {multi[:20]} (n={len(multi)})")
# block rule
ends = {b for _, b, _ in ranges}
iscomment = lambda s: re.match(r"^\s*(/\*\*|\*|//)", s) is not None
isdecl = lambda s: re.match(r"^(\s{2})?(private|final|object|def|val|require|import|package|/\*\*|\)|\w)", s) is not None
for a, b, name in ranges:
    if not (iscomment(base[a - 1]) or isdecl(base[a - 1])): fails.append(f"block {name} ({a}-{b}) does not start with a comment or declaration")
    if a > 1 and base[a - 2].strip() != "" and (a - 1) not in ends:
        fails.append(f"block {name} ({a}-{b}): base line {a-1} is neither blank nor the end of another block (doc/member split)")
for fn, (n, st) in stats.items():
    print(f"{fn}: {n} lines :: " + ", ".join(f"{k}={v}" for k, v in sorted(st.items())))
print(f"blocks: {len(ranges)}; base non-blank lines 35..2571 (less the class-closing brace): {len(body)}; unclaimed {len(unclaimed)}; multiply-claimed {len(multi)}")
if fails:
    print("FAIL"); [print(" -", f) for f in fails[:25]]; sys.exit(1)
print("PASS")
