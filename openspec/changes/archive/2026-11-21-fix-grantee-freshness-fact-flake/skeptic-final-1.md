## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `7eeb209c45e8343745ffb2611f0d268058018d4f`. The base was resolved live with `resolve-review-base.sh` (main/origin): `9c2b5ba8ea1749c1db1b4e61b53ea4ebab09b134`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/freshness-fact-flake/HEL-1812`.
- **Diff:** `git diff $BASE...HEAD` has two commits.
  - The only code change is `e2e/hel1786-shared-dashboard-freshness.spec.ts`, 25 added lines, all in `beforeAll`:
    - `test.setTimeout(180_000)` for the hook.
    - A 50 s `expect.poll` on `GET /api/pipelines/:checked/run-history` that waits for a terminal run with `triggerSource === "auto-run"`.
  - Every other changed file is in the change dir.
- **The assertion is not weakened:**
  - `expectedFactPrefix` and `expectFact` (spec lines 122-143) are unchanged from the base.
  - The regex still accepts exactly one fact.
  - The 15 s poll window is unchanged.
  - The grantee fact is still compared with the owner's live `GET /api/pipelines/:id` for both pipelines on every iteration.
- **Root cause (AC1): it holds.**
  - The probe excerpt in `root-cause.md` and the full `red-run.log` (working tree only, see CR1) show that for the whole window the owner's history held `auto-run:failed@09:08:34` newer than the manual runs, while the grantee still rendered the previous `panel-status` body's "refreshed". The grantee's next poll returned `failed@09:08:34` about 0.2 s after the window closed.
  - The `auto-run` trigger string is real: `PipelineRunService.scala:386` has `val AutoRun: String = "auto-run"`.
  - The mechanism is coherent:
    - The violating-row write arms a HEL-1093 auto-run.
    - The blocked manual run fails, so it cannot cancel that auto-run under HEL-1739.
    - The auto-run fires at an uncontrolled scheduler tick.
  - H2 (a UI bug) is refuted by the logged bodies: the stale text always matched the previous body.
  - So AC3 (a failing-first test for a UI bug) does not apply.
- **The fix closes the race:**
  - After the settle, no armed auto-run remains on the checked pipeline, and nothing writes to the checked source again.
  - Pipeline 1's succeeded run is created after the settle, so the latest run is deterministically "refreshed". A later pipeline-1 auto-run could only succeed, which keeps the same prefix.
  - The evaluator's mutation evidence persisted in scratch (`evalprobe/mut7.log`, `mut0-control.log`):
    - With the settle removed, 4/4 runs failed with the exact CI message; the log shows `expected="last run failed " rendered="refreshed 28 seconds ago"`.
    - With the settle kept, 4/4 runs passed (`4 passed (1.9m)`).
    - So the guard is failable.
- **The hook timeout is needed:** the evaluator's `hooktimeout.log` shows that a hook with no override gets the 30 s project timeout (`playwright.config.ts:189`, `timeout: 30_000`). The override is required, not cosmetic.
- **AC2 (20 consecutive passes):**
  - The evaluator's four serial runs: `eval-serial-1..4.log` each end `15 passed (2.9m)`, and `eval-serial-20.log` has 60 checkmarks.
  - My own fresh run, on the lane servers (start-servers.sh 7244/10151, lane DB `helio_hel1812`, `DB_USER=matt`, empty password, empty `ANTHROPIC_API_KEY`):
    - Command: `nice -n 19 npx playwright test e2e/hel1786-shared-dashboard-freshness.spec.ts --repeat-each=5 --workers=2` with `DEV_PORT=7244`.
    - Result: `15 passed (2.9m)`, exit 0. The teardown deleted 15 throwaway users.
  - Servers were stopped afterwards: `STOPPED ports=7244,10151`.
- **UI review:** not applicable. No `frontend/**` change.

### Verdict: REFUTE

The test fix is correct and I would ship it. The refusal is about committed delivery artifacts that make false claims, and about a standing constraint whose stated evidence never reached the branch.

### Change Requests

1. **The red run was never committed (C12), but committed text says it was.**
   - `red-run.log` and `green-runs.log` match `.gitignore:27` (`*.log`). `git ls-files` on the change dir does not list them, and `git show e52b5dce5 --stat` shows no log.
   - Yet three committed places claim them:
     - `root-cause.md` says the "red excerpt committed as `red-run.log`".
     - Commit e52b5dce5 is titled "...and the induced red run".
     - `files-modified.md` lists both logs.
   - Fix: force-add the red evidence (`git add -f .../red-run.log`), so the PR carries the probe evidence that AC1 and C12 require. Otherwise, rename it to an unignored extension such as `red-run.txt` and update every reference. Either way, `root-cause.md` and `files-modified.md` must describe what is actually committed.
2. **`files-modified.md` and `green-runs.log` cite unclean AC2 evidence.**
   - The executor's `green-runs.log` ("25 passing full-file repeats") came from batches that overlapped, per evaluation-1.md. Two Playwright invocations running at once breaks C4 and is not valid evidence for "20 in a row".
   - Fix: cite the evaluator's serial transcript (`eval-serial-20.log`, commit it the same way as CR1) as the AC2 evidence. Either drop the `green-runs.log` claim or label it as concurrent and not AC2 evidence.
3. **The code comment at `e2e/hel1786-shared-dashboard-freshness.spec.ts:162` is factually wrong.**
   - It says the hook "can exceed the describe's 90 s".
   - A `beforeAll` hook does not get the describe-level `test.setTimeout(90_000)`. It gets the project's 30 s (`playwright.config.ts:189`), as `evalprobe/hooktimeout.log` shows.
   - Fix: reword to say the hook otherwise gets the 30 s project timeout, because the describe's `setTimeout` does not apply to hooks.
4. **`tasks.md` 2.1 is ticked `[x]` but the work was not done.**
   - The task is the H2-only red unit test, fix and spec delta. H2 was refuted, so correctly nothing was done.
   - Fix: mark it "N/A: H2 refuted (root-cause.md)" so the archived task list does not claim work that never happened.

### Non-blocking notes

- `schemas/pipelines/pipeline-run-record.schema.json`'s `triggerSource` enum lacks `auto-run`, which the run-history route returns. The executor already flagged this as a follow-up. It is worth a ticket.
- No mtime-ordering claim is relied on anywhere in this report.
