# Test-count evidence (HEL-1291, design D6)

Baseline: unmodified worktree at b2a0d8088. After: this change. Both `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` (exit 0 each).

## Totals
```
BASELINE (/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1291-baseline-testfull.log):
[info] Total number of tests run: 6039
[info] Suites: completed 428, aborted 0
[info] Tests: succeeded 6039, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.

AFTER (/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1291-after-testfull.log):
[info] Total number of tests run: 6039
[info] Suites: completed 428, aborted 0
[info] Tests: succeeded 6039, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

## Related suites (isolated `sbt "testOnly *.<Suite>"` runs; the full-run log interleaves parallel suites so per-suite counts are taken from isolated runs)

| Suite | before | after |
|---|---|---|
| PublicDashboardRoutesSpec | succeeded=23 | succeeded=23 |
| OutputHistoryPublicRoutesSpec | succeeded=4 | succeeded=4 |
| OutputHistoryPayloadPublicRoutesSpec | succeeded=2 | succeeded=2 |
| PublicProvenanceRoutesSpec | succeeded=5 | succeeded=5 |
| PublicRouteOwnerIdLeakSpec | succeeded=8 | succeeded=8 |
| ShareTokenPublicAccessSpec | succeeded=4 | succeeded=4 |
| OutputHistoryQueryCountSpec | succeeded=3 | succeeded=3 |
| ExistenceNotLeakedRoutesSpec | succeeded=61 | succeeded=61 |
| DashboardPanelAclSpec | succeeded=41 | succeeded=41 |
| ApiRoutesSpec | succeeded=172 | succeeded=172 |
| PublicPathRlsSmokeSpec | succeeded=3 | succeeded=3 |

diff of before/after tables: empty (identical).

## No test edits
```
$ git diff b2a0d8088...HEAD --stat -- backend/src/test | wc -l
0
$ git status --short -- backend/src/test | wc -l
0
```
(Re-checked after the commit in the return report.)
