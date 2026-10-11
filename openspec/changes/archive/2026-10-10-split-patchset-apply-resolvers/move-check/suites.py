#!/usr/bin/env python3
"""Per-suite test-count extraction from an sbt testFull log. usage: suites.py <log>  -> prints `suite<TAB>tests<TAB>failed<TAB>canceled<TAB>ignored` sorted, then a total line."""
import re, sys, collections
ansi = re.compile(r"\x1b\[[0-9;]*m")
hdr = re.compile(r"^\[info\] ([A-Za-z0-9_$]+):$")
tst = re.compile(r"^\[info\]\s+- (.*)$")
cur = None; n = collections.Counter(); f = collections.Counter(); c = collections.Counter(); ig = collections.Counter(); order = []
for line in open(sys.argv[1], errors="replace"):
    line = ansi.sub("", line.rstrip("\n"))
    m = hdr.match(line)
    if m: cur = m.group(1); order.append(cur); continue
    m = tst.match(line)
    if m and cur:
        t = m.group(1)
        if t.endswith("*** FAILED ***"): f[cur] += 1
        elif t.endswith("*** CANCELED ***"): c[cur] += 1
        elif t.endswith("!!! IGNORED !!!"): ig[cur] += 1
        n[cur] += 1
tot = [0, 0, 0, 0]
for s in sorted(set(order)):
    print(f"{s}\t{n[s]}\t{f[s]}\t{c[s]}\t{ig[s]}"); tot[0] += n[s]; tot[1] += f[s]; tot[2] += c[s]; tot[3] += ig[s]
print(f"TOTAL\t{tot[0]}\t{tot[1]}\t{tot[2]}\t{tot[3]}\tsuites={len(set(order))}")
