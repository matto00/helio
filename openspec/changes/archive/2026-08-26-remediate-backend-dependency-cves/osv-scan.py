#!/usr/bin/env python3
"""HEL-452: scan the backend's RESOLVED Maven coordinates against OSV.dev.

Usage:
    cd backend
    sbt -batch "Compile/dependencyTree" > /tmp/compile.txt
    sbt -batch "Test/dependencyTree"    > /tmp/test.txt
    python3 osv-scan.py compile=/tmp/compile.txt test=/tmp/test.txt

Two correctness properties this tool exists to preserve (both were real defects
found during HEL-452 planning, so do not "simplify" them away):

1. **Evicted coordinates are excluded.** `sbt dependencyTree` prints losers of
   version conflicts as `... (evicted by: X)`. Those artifacts are NOT on the
   resolved classpath and do not ship. Counting them overstated the HEL-452
   baseline by 32%, including a phantom CRITICAL.
2. **Scopes are reported separately.** Compile-scope artifacts ship in the
   production image; Test-scope-only artifacts do not. Merging them makes any
   "live attack surface" claim unsupportable.
3. **Truncated input is refused outright.** `sbt dependencyTree` truncates each
   row to the terminal width and ends it with `..`, which silently destroys the
   `(evicted by: ...)` marker on deep rows AND fabricates bogus versions
   (`listenablefuture:9999.0-empty-to-avoid-co..`). Filtering on the substring
   `(evicted` does not fix this — some rows truncate before that word begins.
   Always dump with the graph width raised:
       sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree"
   This tool aborts if it sees a truncated coordinate row.

The groupId pattern deliberately requires an alphanumeric first character:
the tree's `+-` / `|` glyphs would otherwise be captured into the groupId,
making every lookup query a nonexistent package and silently returning zero
advisories.

4. **KNOWN LIMITATION, NOT GUARDED: relocated Maven coordinates are silently
   invisible.** When a POM is a Maven "relocation" (groupId/artifactId moved,
   e.g. org.lz4:lz4-java -> at.yawk.lz4:lz4-java), `sbt-dependency-graph` does
   not render a tree node for the relocated artifact at all -- it is on the
   resolved classpath (verify with `sbt 'show Compile/dependencyClasspath'`)
   but this tool never sees or queries it. A clean-looking result from this
   tool is therefore NOT sufficient proof that nothing at that coordinate is
   vulnerable -- cross-check the classpath jars against the tree dump by hand
   when a scanned artifact's advisory history looks suspiciously short (HEL-452
   cycle 2: this exact gap hid two still-open lz4-java advisories, GHSA-cmp6-
   m4wj-q63q and GHSA-xx22-p4ch-683r, at 1.8.1). Unlike defects 1-3 above, this
   one is NOT guarded in the tool itself -- it is a real gap, documented here
   deliberately so it isn't mistaken for a solved problem.

5. **KNOWN LIMITATION, NOT GUARDED: letter-prefixed Maven versions are silently
   dropped.** The COORD regex's version group is `r':([0-9][a-zA-Z0-9_.+-]*)'`
   -- it requires the version to START with a digit. A Maven version that
   starts with a letter (common for Google API client libraries, which version
   by API revision, e.g. `v1-rev20240621-2.0.0`) fails the match even though
   its coordinate row IS present, verbatim, in the tree dump -- the row is
   silently skipped rather than counted or flagged. Found at the HEL-452
   cycle-3 skeptic gate via a full classpath-vs-tree cross-check: two shipped
   compile-scope artifacts hit this, `com.google.apis:google-api-services-
   storage:v1-rev20240621-2.0.0` and `com.google.apis:google-api-services-
   sqladmin:v1beta4-rev20240925-2.0.0`. Both happen to be OSV-clean today, so
   this defect changed no delivered number in HEL-452, but it is a second,
   independent false-clean mode distinct from defect #4 (that one hides a node
   missing from the tree entirely; this one hides a node that IS in the tree
   but fails the version regex). Like defect #4, this is NOT guarded in the
   tool -- widening the regex risked false-positive coordinate matches on the
   glyph-stripping logic defect #1 already had to fix once, so the safer
   choice was to document the gap rather than force a fragile regex change.
   Cross-check the classpath against the tree by hand (`sbt 'show
   Compile/dependencyClasspath'`) whenever a version format looks unusual.

Exit code is always 0 — this is an evidence tool, not a gate (the CI CVE gate
is a separate ticket in epic HEL-434).
"""
import collections
import json
import re
import sys
import urllib.request

COORD = re.compile(
    r'(?<![\w.])'                         # not mid-token (a leading '-'/'+' tree glyph is allowed but not captured)
    r'([a-zA-Z0-9_][a-zA-Z0-9_.-]*)'      # groupId (must start alnum: strips tree glyphs like '+-')
    r':([a-zA-Z0-9_][a-zA-Z0-9_.-]*)'     # artifactId
    r':([0-9][a-zA-Z0-9_.+-]*)'           # version
)
EVICTED = "(evicted by:"


class TruncatedTreeError(RuntimeError):
    """The dependency-tree dump was truncated to terminal width — refuse to scan it."""


def coords(path):
    """Resolved coordinates only. Returns (resolved_set, evicted_line_count).

    Aborts on truncated input: a truncated row can hide an `(evicted by:)` marker
    (counting a non-shipping artifact as resolved) or fabricate a version string
    (producing a guaranteed-clean no-hit against OSV). Both silently understate or
    overstate the result, which is exactly what this tool must never do.
    """
    resolved, evicted, truncated = set(), 0, []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for n, line in enumerate(fh, 1):
            stripped = line.rstrip("\n").rstrip()
            if stripped.endswith("..") and COORD.search(stripped):
                truncated.append((n, stripped[-70:]))
                continue
            if EVICTED in line:
                evicted += 1
                continue
            for g, a, v in COORD.findall(line):
                resolved.add((g, a, v))

    if truncated:
        detail = "\n".join(f"    line {n}: ...{t}" for n, t in truncated[:5])
        raise TruncatedTreeError(
            f"{path}: {len(truncated)} coordinate row(s) are truncated to terminal width.\n"
            f"{detail}\n"
            "  Re-dump with the graph width raised, e.g.:\n"
            "    sbt -batch 'set ThisBuild/asciiGraphWidth := 400' \"Compile/dependencyTree\"\n"
            "  Scanning truncated input would silently miscount evicted artifacts."
        )
    return resolved, evicted


def post(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))


def scan(coordinates, cache):
    queries = [{"package": {"name": f"{g}:{a}", "ecosystem": "Maven"}, "version": v}
               for g, a, v in sorted(coordinates)]
    hits = []
    for i in range(0, len(queries), 100):
        chunk = queries[i:i + 100]
        results = post("https://api.osv.dev/v1/querybatch", {"queries": chunk})["results"]
        for q, r in zip(chunk, results):
            ids = [x["id"] for x in r.get("vulns", [])]
            if ids:
                hits.append((q["package"]["name"], q["version"], ids))

    rows = []
    for pkg, ver, ids in hits:
        for vid in ids:
            if vid not in cache:
                cache[vid] = json.load(urllib.request.urlopen(
                    f"https://api.osv.dev/v1/vulns/{vid}", timeout=60))
            v = cache[vid]
            fixed = sorted({e["fixed"]
                            for aff in v.get("affected", [])
                            if aff.get("package", {}).get("name") == pkg
                            for rng in aff.get("ranges", [])
                            for e in rng.get("events", []) if "fixed" in e})
            rows.append((pkg, ver, vid,
                         v.get("database_specific", {}).get("severity", "?"),
                         ",".join(fixed) or "-",
                         (v.get("summary") or "").replace("|", "/")[:80]))
    return rows, len(hits)


SEV_ORDER = {"CRITICAL": 0, "HIGH": 1, "MODERATE": 2, "LOW": 3}


def report(label, rows, n_artifacts, n_coords, n_evicted):
    rows = sorted(rows, key=lambda r: (SEV_ORDER.get(r[3], 9), r[0]))
    hist = collections.Counter(r[3] for r in rows)
    print(f"### {label}")
    print(f"resolved coordinates: {n_coords}   (excluded {n_evicted} evicted tree rows)")
    print(f"TOTALS: {len(rows)} advisories across {n_artifacts} vulnerable artifacts")
    for k in ["CRITICAL", "HIGH", "MODERATE", "LOW"]:
        print(f"  {k}: {hist.get(k, 0)}")
    print()
    for pkg, ver, vid, sev, fixed, summ in rows:
        print(f"{sev:9} {pkg} {ver} {vid} fixed={fixed} | {summ}")
    print()


def main(argv):
    if not argv:
        print(__doc__)
        return
    inputs = []
    for arg in argv:
        label, _, path = arg.partition("=")
        inputs.append((label, path) if path else ("all", label))

    cache = {}
    sets = {}
    try:
        for label, path in inputs:
            coords(path)
    except TruncatedTreeError as exc:
        print(f"ABORT: {exc}", file=sys.stderr)
        raise SystemExit(2)

    for label, path in inputs:
        resolved, evicted = coords(path)
        sets[label] = resolved
        rows, n_art = scan(resolved, cache)
        report(f"{label} scope", rows, n_art, len(resolved), evicted)

    # Test-only exposure = what Test adds beyond Compile. Only Compile ships.
    if "compile" in sets and "test" in sets:
        test_only = sets["test"] - sets["compile"]
        rows, n_art = scan(test_only, cache)
        report("test-ONLY (does NOT ship in the production image)",
               rows, n_art, len(test_only), 0)


if __name__ == "__main__":
    main(sys.argv[1:])
