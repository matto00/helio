#!/usr/bin/env python3
"""HEL-1287 / HEL-1758: regenerate project/test-suite-weights.tsv from CI JUnit artifacts.

Usage: gen-test-suite-weights.py <run-label>=<dir-with-TEST-*.xml> [<run-label>=<dir> ...] > project/test-suite-weights.tsv
  <run-label> is the CI run id (any string). Repeat a label for each shard dir of the same run: a run's dirs are unioned
  first (a suite that appears twice inside one run keeps the last one read), then each suite's weight is the MEAN of its
  per-run time over the runs it appears in, plus 1.0 s (JUnit `time` excludes beforeAll/afterAll, so the measured ~1 s/suite
  average of EmbeddedPostgres/JVM setup, 420 s over 416 suites in run 37352303257, is added flat).
The header is written by this script from what it actually read: the run labels, the run count, and a "mean of N runs" claim
only when N >= 2. Feed it only reports a leg really produced (see extract-fresh-junit.py: shard artifacts also hold stale
reports restored from earlier runs).
"""
import sys, glob, os
import xml.etree.ElementTree as ET


def read_runs(args):
    runs = {}  # label -> {suite: seconds}
    for arg in args:
        if "=" not in arg:
            sys.exit(f"gen-test-suite-weights: expected <run-label>=<dir>, got '{arg}'")
        label, d = arg.split("=", 1)
        suites = runs.setdefault(label, {})
        for f in sorted(glob.glob(os.path.join(d, "**", "TEST-*.xml"), recursive=True)):
            root = ET.parse(f).getroot()
            for ts in [root] if root.tag == "testsuite" else root.iter("testsuite"):
                suites[ts.get("name")] = float(ts.get("time", "0"))
    return runs


def mean_weights(runs):
    per_suite = {}
    for suites in runs.values():
        for name, t in suites.items():
            per_suite.setdefault(name, []).append(t)
    return {name: sum(ts) / len(ts) + 1.0 for name, ts in per_suite.items()}


def header(runs):
    n = len(runs)
    labels = " ".join(runs)
    how = f"mean of {n} runs" if n >= 2 else "1 run, no averaging"
    return (
        f"# SuiteName<TAB>seconds (regenerated from CI JUnit artifacts by gen-test-suite-weights.py; "
        f"{how}: {labels}; +1.0 s/suite setup)"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    runs = read_runs(sys.argv[1:])
    weights = mean_weights(runs)
    print(header(runs))
    for name in sorted(weights):
        print(f"{name}\t{weights[name]:.3f}")
