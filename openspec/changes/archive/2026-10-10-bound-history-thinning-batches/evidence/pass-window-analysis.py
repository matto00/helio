#!/usr/bin/env python3
"""HEL-1435: worst 20-batch pass stall from the committed one-batch-per-pass drains (no re-measurement)."""
import re, glob, os
M = 20
OLD = {("S2","desktop"):10.9, ("S2","prod-io-base"):29.1, ("S3","desktop"):16.4, ("S3","prod-io-base"):32.7, ("S4","desktop"):81.5, ("S4","prod-io-base"):109.6}  # drain-old-*-R25000 ms
here = os.path.dirname(os.path.abspath(__file__))
print(f"{'scenario':<14}{'profile':<14}{'batches':>8}{'avg/pass':>10}{'worst aligned':>15}{'worst any':>11}{'max txn':>9}{'old tick':>10}{'worst/old':>10}")
for f in sorted(glob.glob(f"{here}/drain-new-M1-S*-R25000.log")):
    sc, prof = re.match(r".*drain-new-M1-(S\d)-(.*)-R25000\.log", f).groups()
    ms = [float(re.search(r" ms=([\d.]+)", l)[1]) / 1000 for l in open(f) if l.startswith("@@PASS")]
    al = [sum(ms[i:i+M]) for i in range(0, len(ms), M)]
    an = [sum(ms[i:i+M]) for i in range(0, max(len(ms) - M + 1, 1))]
    old = OLD[(sc, prof)]
    print(f"{sc:<14}{prof:<14}{len(ms):>8}{sum(ms)/len(ms)*M:>9.1f}s{max(al):>14.1f}s{max(an):>10.1f}s{max(ms):>8.1f}s{old:>9.1f}s{max(an)/old:>10.2f}")
