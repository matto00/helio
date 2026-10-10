# Test counts (HEL-1480, task 5.2)

Final `nice -n 19 sbt -batch -J-Xmx3g testFull` (log: run evidence dir `full-testfull.log`, exit 0):

```
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Total number of tests run: 6662
[info] Tests: succeeded 6662, failed 0, canceled 4, ignored 0, pending 0
```

Per-suite counts for touched suites (count of `- ` result lines under the suite header in the final log; base = same suite at HEAD):

| Suite | Base | Now | Delta |
|---|---|---|---|
| `PipelineServiceCoverageGapsSpec` (new) | - | 5 | +5 (G1 service, G2 x2, G4 x2) |
| `PipelineAclSpec` | 22 | 23 | +1 (G1 route) |
| `PipelineAnalyzeProposalRoutesSpec` | 18 | 19 | +1 (G3) |
| `ExistenceNotLeakedRoutesSpec` | 61 | 61 | 0 (sites only) |
| `PipelineCreateTransactionalSpec`, `PipelineStepRoutesSpec` and the other comment-only specs | unchanged | unchanged | 0 |

New tests are the only increase (+7). `npm run check:scala-quality`: "clean (231 soft warning(s))". No sbt server was left running
(every invocation was `-batch`).
