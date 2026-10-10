# Test-count evidence (HEL-1463, D6e)

Both runs: `nice -n 19 sbt -J-Xmx3g testFull` from `backend/` (exit 0), logs in the run evidence dir
(`.concertino/runs/HEL-1463/evidence/sbt-base.log` at BASE 1b765f59d on the unmodified worktree; `sbt-after.log` after the change).

| | BASE | AFTER |
|---|---|---|
| `[hel1468-guard]` line | `ScalaTest summary: failed=0 aborted=0 unreadable=0` | `ScalaTest summary: failed=0 aborted=0 unreadable=0` |
| Suites | completed 484, aborted 0 | completed 484, aborted 0 |
| Tests | succeeded 6655, failed 0, canceled 4, ignored 0, pending 0 | succeeded 6655, failed 0, canceled 4, ignored 0, pending 0 |
| Result | All tests passed | All tests passed |

Per-suite: `move-check/suites.py` extracts per-suite test-line counts from each log (`move-check/suites-base.tsv`,
`move-check/suites-after.tsv`, 484 suites, 6659 test lines = 6655 succeeded + 4 canceled): `diff suites-base.tsv suites-after.tsv`
is EMPTY. No flakes on either side; no re-runs needed.

`git diff 1b765f59d -- backend/src/test`: empty (zero test-source diff).
No sbt server of this run left running.
