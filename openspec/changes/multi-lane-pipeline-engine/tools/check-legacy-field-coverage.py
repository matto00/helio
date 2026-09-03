"""HEL-911: every LIVE requirement whose body names a legacy secondary-source field
must have a MODIFIED or REMOVED delta block. Keyed on the PROPERTY, not a file list.

Hardened per skeptic-design-5: `covered` counts only MODIFIED/REMOVED sections, so an
ADDED block that happens to share a live header can never make this pass vacuously."""
import re, os, sys
LIVE = 'openspec/specs'
DELTA = 'openspec/changes/multi-lane-pipeline-engine/specs'
LEGACY = re.compile(r'rightDataSourceId|otherDataSourceId|referenceDataSourceId')

def reqs(path):
    out = {}
    for p in re.split(r'(?m)^### Requirement: ', open(path).read())[1:]:
        out[p.split('\n', 1)[0].strip()] = p
    return out

def covered_headers(path):
    """Headers under ## MODIFIED / ## REMOVED only."""
    out, cur = set(), None
    for line in open(path).read().splitlines():
        m = re.match(r'^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements', line)
        if m:
            cur = m.group(1); continue
        m = re.match(r'^### Requirement: (.+)$', line)
        if m and cur in ('MODIFIED', 'REMOVED'):
            out.add(m.group(1))
    return out

uncovered = []
for cap in sorted(os.listdir(LIVE)):
    lp = f'{LIVE}/{cap}/spec.md'
    if not os.path.exists(lp):
        continue
    tainted = {n for n, b in reqs(lp).items() if LEGACY.search(b)}
    if not tainted:
        continue
    dp = f'{DELTA}/{cap}/spec.md'
    cov = covered_headers(dp) if os.path.exists(dp) else set()
    uncovered += [(cap, n) for n in sorted(tainted) if n not in cov]

print("LIVE requirements naming a legacy field with no MODIFIED/REMOVED delta block:", len(uncovered))
for c, n in uncovered:
    print(f"  UNCOVERED: {c}: {n}")
sys.exit(1 if uncovered else 0)
