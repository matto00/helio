## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `188c9b672c49c66fca09a66fc935fac940b27eb7`. The base was resolved live with `resolve-review-base.sh` (main/origin): `9c2b5ba8ea1749c1db1b4e61b53ea4ebab09b134`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/freshness-fact-flake/HEL-1812`.
- **Diff (`git diff $BASE...HEAD`):** the only code change is `e2e/hel1786-shared-dashboard-freshness.spec.ts` (+25 lines, all in `beforeAll`):
  - a hook `test.setTimeout(180_000)`;
  - a 50 s `expect.poll` on `GET /api/pipelines/:checked/run-history` that waits for a terminal run with `triggerSource === "auto-run"`.
  - Everything else is in the change dir.
- **The assertion is not weakened (C15):**
  - `expectedFactPrefix` and `expectFact` (spec lines 122-143) are untouched by the diff.
  - The regex still accepts exactly one fact.
  - The 15 s window is unchanged.
  - The owner's live `GET /api/pipelines/:id` for both pipelines is still read on every iteration.
- **The fix is deterministic:**
  - After the checked pipeline is created, the checked source is written to only once (the violating row). So only one auto-run can be armed.
  - That auto-run is not cancelled, because the manual run it follows is blocked, and HEL-1739 cancels only on `succeeded`.
  - Once a terminal auto-run is seen, nothing can flip the checked pipeline's latest run again.
  - Pipeline 1's succeeded run is created after the settle.
- **AC1, the root cause, is met:**
  - `root-cause.md` and the committed `red-run.txt` show the owner's history holding `auto-run:failed@09:08:34` for the whole 15 s window, while the grantee still rendered "refreshed 32 seconds ago".
  - The grantee's own `panel-status` poll returned the failed run about 0.2 s after the window closed.
  - H2 (a UI bug) is refuted: the rendered text always matched the latest body the grantee had received.
  - The evaluator's mutation probe (scratch `evalprobe/mut7.log` vs `mut0-control.log`) makes the guard failable: with the settle removed, 4/4 runs failed with the CI message; with it kept, 4/4 passed.
- **AC2, 20 in a row, is met:**
  - Committed `eval-serial-20.txt` has four serial batches started at 01:45:40, 01:48:41, 01:51:40 and 01:54:42. Each says `Running 15 tests using 2 workers` and ends `15 passed (2.9m)`, with 60 checkmarks in total.
  - Those batches ran at 7eeb209c4. `git diff 7eeb209c4 HEAD -- e2e/` is a one-line comment change only.
  - My own fresh run at HEAD:
    - Setup: lane servers via `start-servers.sh` 7244/10151 (`PASS servers`), lane DB `helio_hel1812`, `DB_USER=matt`, empty password, empty `ANTHROPIC_API_KEY`.
    - Command: `nice -n 19 npx playwright test e2e/hel1786-shared-dashboard-freshness.spec.ts --repeat-each=5 --workers=2`.
    - Result: exit 0, `15 passed (2.9m)`. The teardown deleted the 15 throwaway users.
    - Log: `.concertino/scratch/HEL-1812/skeptic-final-2.log`.
    - Servers stopped afterwards (`STOPPED ports=7244,10151`).
- **AC3** (a failing-first test, only if it was a UI bug): N/A, because H2 was refuted.
- **Round-1 change requests are all resolved:**
  1. The red evidence is now committed as `red-run.txt` (`git ls-files`). `root-cause.md:15` discloses that it was added in the follow-up commit.
  2. `files-modified.md` cites `eval-serial-20.txt` as the AC2 evidence and no longer claims `green-runs.log`.
  3. The comment at spec:162 now says hooks get the 30 s project timeout and that the describe's 90 s applies only to tests. That is correct per `playwright.config.ts:189`.
  4. `tasks.md` 2.1 reads "N/A: H2 refuted".
- **Format and lint:** `prettier --check` on the spec and the change-dir markdown passes. `eslint --max-warnings=0` on the spec printed nothing.
- **UI review:** not applicable. There is no `frontend/**` change.

### Verdict: CONFIRM

### Non-blocking notes

- C12 asks for the red run to be committed before the implementation. Here it was committed after it (188c9b672 follows 7eeb209c4), because `*.log` is gitignored. `root-cause.md` says so, and squash-merge makes the order moot.
- `evaluation-1.md` still refers to `.log` names (`eval-serial-20.log`, `red-run.log`). It is a historical gate record, and its own finding explains why those files were uncommitted, so it is not misleading.
- Follow-up candidate: the `triggerSource` enum in `schemas/pipelines/pipeline-run-record.schema.json` lacks `auto-run`, which the run-history route returns.
- No mtime-ordering claim is relied on. The batch ordering is taken from the timestamps written inside the transcript content.
