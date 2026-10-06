#!/usr/bin/env python3
"""HEL-1287: regenerate project/test-suite-weights.tsv from the CI JUnit artifact.

Usage: gen-test-suite-weights.py <dir-with-TEST-*.xml> [more dirs...] > project/test-suite-weights.tsv
Weight = the testsuite `time` attribute in seconds + 1.0 (JUnit `time` excludes beforeAll/afterAll, so the
measured ~1 s/suite average of EmbeddedPostgres/JVM setup, 420 s over 416 suites in run 37352303257, is added flat).
If a suite appears in several dirs (e.g. the shard artifacts), the last one wins.
"""
import sys, glob, os
import xml.etree.ElementTree as ET

weights = {}
for d in sys.argv[1:]:
    for f in glob.glob(os.path.join(d, "**", "TEST-*.xml"), recursive=True):
        root = ET.parse(f).getroot()
        for ts in ([root] if root.tag == "testsuite" else root.iter("testsuite")):
            weights[ts.get("name")] = float(ts.get("time", "0")) + 1.0
print("# SuiteName<TAB>seconds (regenerated from CI JUnit artifact by gen-test-suite-weights.py)")
for name in sorted(weights):
    print(f"{name}\t{weights[name]:.3f}")
