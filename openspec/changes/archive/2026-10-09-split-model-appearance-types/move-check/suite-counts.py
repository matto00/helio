#!/usr/bin/env python3
"""usage: suite-counts.py <sbt-testFull.log> -> JSON {suite: test-line-count} (ScalaTest reporter lines '- ...')"""
import re, sys, json
cur = None; out = {}
for l in open(sys.argv[1], errors="replace"):
    l = re.sub(r"\x1b\[[0-9;]*m", "", l.rstrip("\n"))
    m = re.match(r"^\[info\] ([A-Za-z0-9_]+(?:Spec|Test|Suite)):\s*$", l)
    if m: cur = m.group(1); out.setdefault(cur, 0); continue
    if cur and re.match(r"^\[info\]\s+- ", l): out[cur] += 1
print(json.dumps(dict(sorted(out.items()))))
