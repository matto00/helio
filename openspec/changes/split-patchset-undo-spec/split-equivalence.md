# Split equivalence evidence (HEL-1293)

> The sections below this banner up to "## Post-merge (cycle 2)" are the PRE-MERGE (19-test) results, SUPERSEDED by the post-HEL-1337 16-test results at the end of this file. Kept for the record.

Base commit: f78b4c5187a42ead6bf71eb6dce9070b020eda63 (merge-base == HEAD before the change); base file read via `git show`
(copy: scratchpad hel1293-base.scala, 805 lines).

## Runtime counts (D5 check 5 / task 1.1, 3.2, 3.3)

- Baseline (task 1.1), `testOnly com.helio.services.patchsets.PatchSetUndoServiceSpec` on the unmodified branch:
  [info] Suites: completed 1, aborted 0
  [info] Tests: succeeded 19, failed 0, canceled 0, ignored 0, pending 0
- After split (task 3.2), `testOnly` of the four new suites:
  [info] PatchSetUndoLaneSpec:
  [info] PatchSetUndoPanelDashboardSpec:
  [info] PatchSetUndoRepoWiringSpec:
  [info] PatchSetUndoRefusalSpec:
  [info] Suites: completed 4, aborted 0
  [info] Tests: succeeded 19, failed 0, canceled 0, ignored 0, pending 0
- Full `sbt testFull` (task 3.3), exit 0, includes RouteTestBaseGuardSpec:
  [info] RouteTestBaseGuardSpec:
  [info] Suites: completed 430, aborted 0
  [info] Tests: succeeded 6038, failed 0, canceled 0, ignored 0, pending 0

Commands: `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt ...`, `sbt --client shutdown` afterwards.

## Static checks 1, 2, 2b, 3, 4 (output of the script below)

```
check1 names: base=19 new=19 diff=EMPTY
check2 assertion multiset: base=118 new=118 diff=EMPTY
check2b comment multiset: base=77 new=77 diff=EMPTY
check3 per-test body+comment: tests=19 mismatching=NONE (EMPTY)
check4 fixture: base_lines=136 new_lines=136
    --- base
    +++ new
    @@ -1 +1 @@
    -class PatchSetUndoServiceSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {
    +trait PatchSetUndoServiceFixture extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {
check4 delta beyond allowed header swap: NONE
RESULT ALL EMPTY
```

Note: the design cites assertUnavailable at base lines 750-754; the def is at 751-754 (750 is blank, dropped by the check). No other deviation. No allowed delta other than the header swap (i) was needed; none for checks 1, 2, 2b, 3.

Check script (`python3 -I hel1293-check.py <base-file> <patchsets-test-dir>`):

```python
import re, sys, collections
BASE, DIR = sys.argv[1], sys.argv[2]
NEW = ["PatchSetUndoPanelDashboardSpec", "PatchSetUndoLaneSpec", "PatchSetUndoRefusalSpec", "PatchSetUndoRepoWiringSpec"]
FIX = DIR + "/PatchSetUndoServiceFixture.scala"
def rd(p): return open(p).read().splitlines()
SUBJ = re.compile(r'^  "(.*)" should \{$'); TEST = re.compile(r'^    "(.*)" in \{$')
ASSERT = re.compile(r'shouldBe|should |shouldEqual|should be|fail\(|assert|withClue|theSameInstanceAs|contain|include|defined|empty')
def tests(lines):
    out = {}; subj = None; i = 0
    while i < len(lines):
        m = SUBJ.match(lines[i])
        if m: subj = m.group(1)
        t = TEST.match(lines[i])
        if t:
            j = i
            while lines[j] != "    }": j += 1
            k = i
            while k > 0 and lines[k-1].strip().startswith("//"): k -= 1
            name = subj + " should " + t.group(1)
            assert name not in out, name
            out[name] = (lines[k:j+1], lines[i:j+1]); i = j
        i += 1
    return out
base = rd(BASE); news = {n: rd(f"{DIR}/{n}.scala") for n in NEW}
bt = tests(base); nt = {}
for n, l in news.items():
    for k, v in tests(l).items(): assert k not in nt; nt[k] = v
fails = 0
def report(label, a, b, ca, cb):
    global fails
    d = (a - b) + (b - a)
    print(f"{label}: base={ca} new={cb} diff={'EMPTY' if not d else dict(d)}")
    if d: fails += 1
# 1
report("check1 names", collections.Counter(list(bt)), collections.Counter(list(nt)), len(bt), len(nt))
# 2
def asserts(t): return collections.Counter(l.strip() for v in t.values() for l in v[1][1:] if ASSERT.search(l))
a, b = asserts(bt), asserts(nt); report("check2 assertion multiset", a, b, sum(a.values()), sum(b.values()))
# 2b
CM = lambda l: l.strip().startswith("//") or l.strip().startswith("*")
def region(l):
    s = next(i for i, x in enumerate(l) if SUBJ.match(x)); return l[s:]
cb = collections.Counter(l.strip() for l in base[202:] if CM(l))
cn = collections.Counter(l.strip() for n in NEW for l in region(news[n]) if CM(l))
report("check2b comment multiset", cb, cn, sum(cb.values()), sum(cn.values()))
# 3
bad = [k for k in bt if bt[k][0] != nt.get(k, (None,))[0]]
print(f"check3 per-test body+comment: tests={len(bt)} mismatching={bad if bad else 'NONE (EMPTY)'}")
fails += bool(bad)
# 4
norm = lambda ls: [l.replace("private ", "protected ") for l in ls if l.strip()]
bfix = norm(base[52:200] + base[709:714] + base[749:754])
fx = rd(FIX); h = next(i for i, x in enumerate(fx) if x.startswith("trait PatchSetUndoServiceFixture"))
last = max(i for i, x in enumerate(fx) if x == "}")
nfix = fx[h:last]
rw = news["PatchSetUndoRepoWiringSpec"]
u = next(i for i, x in enumerate(rw) if "undoServiceWithoutOutputRepo: PatchSetUndoService" in x)
au = next(i for i, x in enumerate(rw) if "def assertUnavailable" in x)
nfix = norm(nfix + rw[u:u+5] + rw[au:au+4])
import difflib
bn = [l.replace("private ", "protected ") for l in bfix]
dl = [x for x in difflib.unified_diff(bn, nfix, "base", "new", lineterm="", n=0)]
print(f"check4 fixture: base_lines={len(bn)} new_lines={len(nfix)}")
for x in dl: print("   ", x)
allowed = {"-class PatchSetUndoServiceSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {",
           "+trait PatchSetUndoServiceFixture extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {"}
body = [x for x in dl if (x[0] in "+-") and not x.startswith(("---", "+++"))]
extra = [x for x in body if x not in allowed]
print("check4 delta beyond allowed header swap:", extra if extra else "NONE")
fails += bool(extra) or len(body) != 2
print("RESULT", "FAIL" if fails else "ALL EMPTY")
```

## D7 pointers
`grep -rn PatchSetUndoServiceSpec backend/src` after the change:
```
backend/src/test/scala/com/helio/services/pipelines/Hel914Ac1EndToEndSpec.scala:63: *  confirmed prerequisite: `WorkspaceContextServiceSpec`/`PatchSetUndoServiceSpec` both hit a
```

## Post-merge (cycle 2) — current results

Base: `git show origin/main:backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` (origin/main = b2a0d8088 HEL-1337 or later; 742 lines, copy hel1293-base2.scala). HEL-1337 removed the null-outputRepo block (3 tests), `undoServiceWithoutOutputRepo`, `assertUnavailable` and reworded the `seedOutput` comment; ported into the split (RepoWiring keeps only the parity test; fixture takes the new comment). Merge: `git merge origin/main`, modify/delete conflict resolved by keeping the deletion.

- Baseline: old spec at merged tree (origin/main version) `testOnly PatchSetUndoServiceSpec` ran in the merged working tree before deleting it:
  [info] Suites: completed 1, aborted 0
  [info] Tests: succeeded 16, failed 0, canceled 0, ignored 0, pending 0
- Four new suites `testOnly`:
  [info] PatchSetUndoLaneSpec:
  [info] PatchSetUndoRefusalSpec:
  [info] PatchSetUndoRepoWiringSpec:
  [info] PatchSetUndoPanelDashboardSpec:
  [info] Suites: completed 4, aborted 0
  [info] Tests: succeeded 16, failed 0, canceled 0, ignored 0, pending 0
- Full `sbt testFull`, exit 0:
  [info] Suites: completed 431, aborted 0
  [info] Tests: succeeded 6039, failed 0, canceled 0, ignored 0, pending 0

Static checks (D5.4 base range re-derived: class header through end of applySuccessfully, base lines 53-200; helper terms dropped):
```
check1 names: base=16 new=16 diff=EMPTY
check2 assertion multiset: base=108 new=108 diff=EMPTY
check2b comment multiset: base=76 new=76 diff=EMPTY
check3 per-test body+comment: tests=16 mismatching=NONE (EMPTY)
check4 fixture: base_lines=127 new_lines=127
    --- base
    +++ new
    @@ -1 +1 @@
    -class PatchSetUndoServiceSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {
    +trait PatchSetUndoServiceFixture extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {
check4 delta beyond allowed header swap: NONE
RESULT ALL EMPTY
```

Check script v2 (differs from v1 only in the check-4 base/new fixture ranges):
```python
import re, sys, collections
BASE, DIR = sys.argv[1], sys.argv[2]
NEW = ["PatchSetUndoPanelDashboardSpec", "PatchSetUndoLaneSpec", "PatchSetUndoRefusalSpec", "PatchSetUndoRepoWiringSpec"]
FIX = DIR + "/PatchSetUndoServiceFixture.scala"
def rd(p): return open(p).read().splitlines()
SUBJ = re.compile(r'^  "(.*)" should \{$'); TEST = re.compile(r'^    "(.*)" in \{$')
ASSERT = re.compile(r'shouldBe|should |shouldEqual|should be|fail\(|assert|withClue|theSameInstanceAs|contain|include|defined|empty')
def tests(lines):
    out = {}; subj = None; i = 0
    while i < len(lines):
        m = SUBJ.match(lines[i])
        if m: subj = m.group(1)
        t = TEST.match(lines[i])
        if t:
            j = i
            while lines[j] != "    }": j += 1
            k = i
            while k > 0 and lines[k-1].strip().startswith("//"): k -= 1
            name = subj + " should " + t.group(1)
            assert name not in out, name
            out[name] = (lines[k:j+1], lines[i:j+1]); i = j
        i += 1
    return out
base = rd(BASE); news = {n: rd(f"{DIR}/{n}.scala") for n in NEW}
bt = tests(base); nt = {}
for n, l in news.items():
    for k, v in tests(l).items(): assert k not in nt; nt[k] = v
fails = 0
def report(label, a, b, ca, cb):
    global fails
    d = (a - b) + (b - a)
    print(f"{label}: base={ca} new={cb} diff={'EMPTY' if not d else dict(d)}")
    if d: fails += 1
# 1
report("check1 names", collections.Counter(list(bt)), collections.Counter(list(nt)), len(bt), len(nt))
# 2
def asserts(t): return collections.Counter(l.strip() for v in t.values() for l in v[1][1:] if ASSERT.search(l))
a, b = asserts(bt), asserts(nt); report("check2 assertion multiset", a, b, sum(a.values()), sum(b.values()))
# 2b
CM = lambda l: l.strip().startswith("//") or l.strip().startswith("*")
def region(l):
    s = next(i for i, x in enumerate(l) if SUBJ.match(x)); return l[s:]
cb = collections.Counter(l.strip() for l in base[202:] if CM(l))
cn = collections.Counter(l.strip() for n in NEW for l in region(news[n]) if CM(l))
report("check2b comment multiset", cb, cn, sum(cb.values()), sum(cn.values()))
# 3
bad = [k for k in bt if bt[k][0] != nt.get(k, (None,))[0]]
print(f"check3 per-test body+comment: tests={len(bt)} mismatching={bad if bad else 'NONE (EMPTY)'}")
fails += bool(bad)
# 4
norm = lambda ls: [l.replace("private ", "protected ") for l in ls if l.strip()]
bfix = norm(base[52:200])  # post-HEL-1337 base: class header .. end of applySuccessfully (53-200); helper terms removed upstream
fx = rd(FIX); h = next(i for i, x in enumerate(fx) if x.startswith("trait PatchSetUndoServiceFixture"))
last = max(i for i, x in enumerate(fx) if x == "}")
nfix = fx[h:last]
nfix = norm(nfix)
import difflib
bn = [l.replace("private ", "protected ") for l in bfix]
dl = [x for x in difflib.unified_diff(bn, nfix, "base", "new", lineterm="", n=0)]
print(f"check4 fixture: base_lines={len(bn)} new_lines={len(nfix)}")
for x in dl: print("   ", x)
allowed = {"-class PatchSetUndoServiceSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {",
           "+trait PatchSetUndoServiceFixture extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {"}
body = [x for x in dl if (x[0] in "+-") and not x.startswith(("---", "+++"))]
extra = [x for x in body if x not in allowed]
print("check4 delta beyond allowed header swap:", extra if extra else "NONE")
fails += bool(extra) or len(body) != 2
print("RESULT", "FAIL" if fails else "ALL EMPTY")
```

D7 grep `grep -rn PatchSetUndoServiceSpec backend/src`:
```
backend/src/test/scala/com/helio/services/pipelines/Hel914Ac1EndToEndSpec.scala:63: *  confirmed prerequisite: `WorkspaceContextServiceSpec`/`PatchSetUndoServiceSpec` both hit a
```

Grep for removed pieces (undoServiceWithoutOutputRepo|assertUnavailable|null outputRepo) in backend/src/test/scala/com/helio/services/patchsets:
```
(no hits)
```
