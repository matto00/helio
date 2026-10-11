# Test counts (HEL-1482, D7)

Final `cd backend && nice -n 19 sbt -batch -J-Xmx3g testFull` on the committed tree (log
`/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/final-testfull.log`, not committed):

```
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Suites: completed 488, aborted 0
[info] Tests: succeeded 6690, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.        (exit 0)
```

`canceled 4` is the pre-existing figure HEL-1479 recorded. Base total = 6690 - 24 new tests = 6666 (the 24 are the only increase).

| Suite | Base | Now | Change |
|---|---|---|---|
| `PatchSetPipelineStepGrantSpec` (new) | - | 9 | +9 |
| `PatchSetDashboardGrantSpec` (new) | - | 9 | +9 |
| `PatchSetResolverMessagesSpec` (new) | - | 6 | +6 |
| `ExistenceNotLeakedRoutesSpec` | 61 | 61 | `sites` labels only (4 rows) |
| `PatchSetPreviewServiceSpec` | 18 | 18 | comment only |
| `RefinementEditShapeSpec` | 21 | 21 | comment only |

"Base" for the three touched existing suites: the diff against base changes no test declaration line (`git diff -U0 -- backend/src/test`,
filtered for `" in {"` / `should {`, 0 hits), and `ExistenceNotLeakedRoutesSpec` was 61/61 green on the base-equivalent `sites` run
before the mutation runs (`M4-green.log` is the post-change control; the row set is unchanged).
