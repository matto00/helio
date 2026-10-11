# Test-count evidence (HEL-1479, D6e / AC4)

Re-baselined in cycle 2: **BASE = 55b53be4a** (`git merge-base HEAD origin/main`, HEL-1480 merged into this branch in `46c0ba9b4`).
The earlier `6d298d5f8` baseline and the power-loss-truncated after run are in `.concertino/runs/HEL-1479/evidence/superseded-6d298d5f8/`.

Both runs: `nice -n 19 sbt -J-Xmx3g testFull` from `backend/`, backgrounded to a log in `.concertino/runs/HEL-1479/evidence/`, polled with
`scripts/concertino/await-sentinel.sh` on the `.exit` file (both `0`). Free memory 47-48 GB before each; no other `testFull` on the machine.

- **BASE run** (`sbt-base3.log`, exit `sbt-base3.exit` = 0): ran in a clean detached scratch worktree at `55b53be4a`
  (`.concertino/runs/HEL-1479/evidence/hel1479-base-wt`, `git status` clean, `rev-parse HEAD` = `55b53be4a305ec0fbd3fd44c1f137e97ad24a5c1`; removed afterwards).
  The earlier cycle-2 BASE run (`sbt-base2.log`) was in a worktree of the same path that was gone after the power loss, so its tree could not be re-verified;
  it is kept only as corroboration: its per-suite output is identical to `sbt-base3.log`.
- **AFTER run** (`sbt-after3.log`, exit `sbt-after3.exit` = 0): on this branch at commit `fb5b09ef2` (HEAD, clean working tree, all source edits in place).

| | BASE 55b53be4a | AFTER fb5b09ef2 |
|---|---|---|
| `[hel1468-guard]` line | `ScalaTest summary: failed=0 aborted=0 unreadable=0` | `ScalaTest summary: failed=0 aborted=0 unreadable=0` |
| Suites | completed 485, aborted 0 | completed 485, aborted 0 |
| Tests | succeeded 6666, failed 0, canceled 4, ignored 0, pending 0 | succeeded 6666, failed 0, canceled 4, ignored 0, pending 0 |
| Result | All tests passed | All tests passed |

Per-suite: `move-check/suites.py` extracts per-suite counts from each log (`move-check/suites-base.tsv`, `move-check/suites-after.tsv`):
`diff suites-base.tsv suites-after.tsv` is EMPTY (IDENTICAL). No flakes on either side; no re-runs needed.

`git diff 55b53be4a -- backend/src/test`: empty (0 lines): zero test-source diff (C1).
Every sbt invocation exited on its own; no sbt server left running.
