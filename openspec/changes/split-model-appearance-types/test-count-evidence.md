# Test-count evidence (D6c)

Baseline: fresh `nice -n 19 sbt -J-Xmx3g -J-XX:ActiveProcessorCount=3 testFull` run in THIS worktree at b409172a with the golden spec set aside (the previously-left baseline JSON had no provable provenance; it was identical to this re-run, which replaced it). After: same command on the split tree + golden spec.

```
BASELINE [info] Total number of tests run: 6436
BASELINE [info] Suites: completed 462, aborted 0
BASELINE [info] Tests: succeeded 6436, failed 0, canceled 4, ignored 0, pending 0
BASELINE [info] All tests passed.
BASELINE exit=0
AFTER    [info] Total number of tests run: 6441
AFTER    [info] Suites: completed 463, aborted 0
AFTER    [info] Tests: succeeded 6441, failed 0, canceled 4, ignored 0, pending 0
AFTER    [info] All tests passed.
AFTER    exit=0
```
Per-suite counts (`move-check/suite-counts.py` on each log; counts = ScalaTest reporter test lines incl. 4 canceled):
```
baseline suites 462 tests 6440 | after suites 463 tests 6445
changed pre-existing: {}
added: {'PanelAppearanceWireGoldenSpec': 5}
MergeSpec: 13 13
```
Baseline per-suite JSON: `move-check/baseline-suite-counts.json`.

`git diff b409172a -- backend/src/test --name-only`: only `PanelAppearanceWireGoldenSpec.scala` (added, 48 lines). Zero edits to existing test files; `PanelAppearanceMergeSpec` 13 -> 13, green, not touched.

## Golden spec (D5)
Uses the production `JsonProtocols` trait (`com.helio.api.JsonProtocols`, which mixes in PanelProtocol), no re-declared formats. Goldens captured from the unmodified base.
Green on base (5/5): see commit b35c5453, log `golden-green`. Red run: `ChartAppearance.Default` legend position "top" -> "bottom" in model.scala: 3 of 5 failed (the 4th case overrides position via its patch, so it is legitimately insensitive), reverted:
```
[info] - should serialize a panel carrying ChartAppearance.Default *** FAILED ***
[info] - should omit chartType and a None axis label rather than writing null *** FAILED ***
[info] - should serialize PanelAppearanceResponse.fromDomain identically to the domain format *** FAILED ***
[info] Tests: succeeded 2, failed 3, canceled 0, ignored 0, pending 0
[info] *** 3 TESTS FAILED ***
```
Known flake HEL-1439 (AutoRunGuardBurstProofSpec): passed in both runs.
