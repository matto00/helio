#!/usr/bin/env python3
"""HEL-1758: extract only the JUnit reports a backend CI leg actually produced, from its backend-junit-reports-shard-N zip.

Usage: extract-fresh-junit.py <artifact.zip> <step-start-iso> <step-end-iso> <out-dir>
  e.g. extract-fresh-junit.py 2.zip 2026-11-18T04:45:56Z 2026-11-18T04:51:50Z junit/RUN/2

Why: the uploaded `backend/target/**/test-reports/*.xml` also holds reports restored from earlier runs (the compile-cache
restore brings sbt's content-addressed outputs back), so every shard artifact carries reports for suites it did NOT run,
dated from older runs (measured: 570 of 715 suite names appear in all four shards of main run 44239430764, three of the four
copies stale). Zip entries carry the runner's UTC mtime; a report is kept only when it falls inside the leg's "Compile and
test" step window (start/end from `gh api repos/<o>/<r>/actions/runs/<id>/jobs`, step "Compile and test"), and the count kept
is printed so the caller can compare the four legs' sum with the suite count the build discovered.
"""
import sys, zipfile, os
from datetime import datetime

zpath, start, end, out = sys.argv[1:5]
parse = lambda s: datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")
t0, t1 = parse(start), parse(end)
os.makedirs(out, exist_ok=True)
kept = skipped = 0
with zipfile.ZipFile(zpath) as z:
    for info in z.infolist():
        if not info.filename.endswith(".xml"):
            continue
        m = datetime(*info.date_time)
        # zip timestamps have 2 s resolution; allow that slack on both ends
        if (t0 - m).total_seconds() <= 2 and (m - t1).total_seconds() <= 2:
            with open(os.path.join(out, os.path.basename(info.filename)), "wb") as f:
                f.write(z.read(info))
            kept += 1
        else:
            skipped += 1
print(f"{zpath}: kept {kept} fresh reports, skipped {skipped} stale", file=sys.stderr)
