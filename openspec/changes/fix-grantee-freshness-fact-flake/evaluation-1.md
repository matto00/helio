## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7eeb209c45e8343745ffb2611f0d268058018d4f` (commits e52b5dce5, 7eeb209c4), base `9c2b5ba8e` (resolved live).
The only code change is `e2e/hel1786-shared-dashboard-freshness.spec.ts` (+25 lines, all inside `beforeAll`). Everything else
is under `openspec/changes/fix-grantee-freshness-fact-flake/`.

Durable evidence from this evaluation (all under `/home/matt/Development/helio/.concertino/runs/HEL-1812/evidence/.concertino/scratch/HEL-1812/`):
- `eval-serial-20.log`: 20 consecutive full-file passes (serial)
- `evalprobe/mut7.log`: mutation red, settle reverted
- `evalprobe/mut0-control.log`: control green, settle kept
- `evalprobe/hooktimeout.log`: hook-timeout probe
- `evalprobe/tests/evalprobe.spec.ts`, `evalprobe/make.py`, `evalprobe/pw.config.ts`: probe source
- `evalprobe/tests/hooktimeout.spec.ts`: hook-timeout probe source

Environment: lane servers via `start-servers.sh` on 7244/10151, `DATABASE_URL` pointing at `helio_hel1812`, `DB_USER=matt`,
empty `DB_PASSWORD`, `ANTHROPIC_API_KEY` exported empty. Every Playwright run used `nice -n 19` and at most 2 workers, and
only one invocation ran at a time. Servers were stopped afterwards with `stop-servers.sh`; ports 7244 and 10151 are free.

### Phase 1: Spec Review — PASS
- **AC1 (root cause with probe evidence): met, and verified independently.** `root-cause.md` says H1 (test race) is
  confirmed and H2 (UI derivation bug) refuted. I re-derived this with my own probe; see the mutation section below. The
  armed HEL-1093 auto-run from the `beforeAll` violating-row write can finish after the grantee's first `panel-status`
  read. The owner's live view then says "last run failed" while the grantee still shows the previous body's "refreshed".
  The grantee converged at its next poll in every run (logged `panel-status` bodies). It never kept a stale fact past a
  newer body, so the UI is correct.
- **AC2 (20 in a row, 2 workers, `nice -n 19`): met, by my own serial run.** The executor's `green-runs.log` is not clean
  evidence for this AC (two of its batches ran concurrently), so it was not relied on. I ran four foreground
  `--repeat-each=5` runs of the full spec file, one after another, `--workers=2`, `nice -n 19`, all at HEAD 7eeb209c4.
  Each run passed 15 of 15, so 20 consecutive full-file repeats gave 60/60 tests passing with exit 0 every time
  (01:45:40 to 01:57:37). Transcript: `eval-serial-20.log`.
- **AC3 (failing-first test if UI bug): N/A.** H2 is refuted, so no UI change was needed or made. This is correct.
- **C15 (do not weaken the assertion): honored.** `expectFact` and `expectedFactPrefix` are byte-identical to base. The
  grantee fact is still compared with the owner's live `GET /api/pipelines/:id` for both pipelines on every iteration.
  There is no timeout bump on `expectFact`, and the regex still accepts only one fact.
- **D2 is followed:** the settle waits for a terminal `triggerSource: "auto-run"` run in the checked pipeline's
  run-history, bounded at 50 s with an explicit message. No settle was added after the viewer test. That matches the
  probe5 finding that pipeline 1's auto-run is cancelled by its succeeded manual run (HEL-1739).
- No scope creep. No backend, schema or migration change. `skip_specs: true` is correct because there is no behavior change.
- CONSTRAINTS C1 to C5 and C12 to C15 are honored in the diff. C12 is honored in substance: e52b5dce5, which carries the
  root cause and the red excerpt in `root-cause.md`, precedes the spec change in 7eeb209c4. See the non-blocking note
  about the `.log` files.

### Phase 2: Code Review — PASS
Gates, run fresh by me in the worktree:
- `npm run lint`: exit 0
- `npm run format:check`: "All matched files use Prettier code style!"
- `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0
- `node scripts/check-e2e-evidence-paths.mjs`: clean
- `node scripts/check-e2e-user-cleanup.mjs`: clean
- `node scripts/check-openspec-hygiene.mjs`: clean

No `frontend/**` or `backend/**` files changed, so `npm test`, the frontend build and `sbt testFull` are not triggered.

**`test.setTimeout(180_000)` inside `beforeAll` really governs the hook (verified two ways).**
- Source, Playwright 1.55.1: `workerMain.js:424` creates each hook's slot with `this._project.project.timeout`, and
  `timeoutManager.js:105-109` `setTimeout` rewrites the running slot.
- Empirical: in a scratch spec with a 40 s `beforeAll` under a describe-level `test.setTimeout(90_000)`, `SET=1` passed
  (40.5 s). `SET=0` failed with `"beforeAll" hook timeout of 30000ms exceeded.` (`hooktimeout.log`). The call is
  therefore necessary as well as effective. Without it the hook has the 30 s project budget, which the up-to-35 s settle
  could exceed.

**Mutation: reverting the settle can be made red, and the committed settle turns it green.**
- The executor's induced probe (`hel1812-probe.spec.ts.txt`, INDUCE=3) writes a NEW row inside the grantee test. That
  arms a fresh auto-run which the `beforeAll` settle cannot cover, so it proves the mechanism but not the guard.
- I built a separate mutation probe (`evalprobe.spec.ts`, generated from the committed spec by `make.py`; the worktree
  was not touched). Its changes:
  - `MUT=1` skips only the new settle block.
  - It adds instrumentation logs.
  - In the first grantee test it targets the `beforeAll` write's own armed auto-run. It predicts the scheduler tick,
    self-calibrated from the previous repeat's observed auto-run start because the single-timer tick drifts about
    35 ms per tick. It navigates so that the grantee's first `panel-status` read lands just before that tick, then waits
    owner-side until the auto-run is terminal, then runs the unchanged `expectFact`.
- `MUT=1` (settle reverted): **4/4 FAILED with the exact CI message**, `Received string: "last run failed <> refreshed 13 seconds ago"` (`mut7.log`).
- `MUT=0` (settle as committed), same probe and settings: **4/4 passed**, and 0 mismatched iterations (`mut0-control.log`).
  Its log shows the auto-run already terminal before the grantee test starts ("NOT INDUCED (tick already passed)").
- The guard therefore is failable by mutation and closes the exact window.
- Note: earlier tuning attempts (`mut1`-`mut6` in scratch, not persisted) passed narrowly. The grantee converged at
  P+14.9 s, within 0.1 to 0.4 s of the `expect.poll` deadline, so whether the unsettled race shows up depends on how
  the poll iterations line up. That is why it was a rare CI flake rather than a constant failure.

Other review points:
- **Readability and errors:** the predicate handles a non-200 by returning a string, which keeps polling and then fails
  with the explicit message. Types are a narrow inline cast. There is no dead code.
- **Ordering:** the settle starts only after `assertion-status` reports `invalid`, so the blocked manual run is already
  finished. Pipeline 1's succeeded run (created after the settle) is then the dashboard's latest run, so the first fact is
  deterministically "refreshed".
- **Behavior-preserving:** the test asserts exactly what it did before; it only waits on observable state first.

### Phase 3: UI Review — N/A
No UI-trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The e2e spec itself
exercised the grantee UI 60 times above. No Playwright MCP browser was used.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `e2e/hel1786-shared-dashboard-freshness.spec.ts:162` comment: "can exceed the describe's 90 s" is inaccurate. A
  `beforeAll` hook does not inherit the describe-level `test.setTimeout(90_000)`; it gets the project `timeout: 30_000`
  (`playwright.config.ts:189`), as `hooktimeout.log` shows. Suggested wording: "...can exceed the 30 s project
  timeout a beforeAll hook gets by default (the describe's setTimeout does not apply to hooks)".
- `tasks.md` 2.1 is ticked `[x]`, but its work (red unit test, fix, spec delta) was correctly not done because H2 was
  refuted. Mark it as N/A (e.g. "[x] 2.1 N/A: H2 refuted, see root-cause.md") so the archived task list does not claim
  work that did not happen.
- `red-run.log` and `green-runs.log` match `.gitignore:27` (`*.log`), so they are NOT in either commit. Commit e52b5dce5
  is titled "...and the induced red run", and `files-modified.md` lists both files. They do exist durably under
  `.concertino/runs/HEL-1812/evidence/openspec/changes/fix-grantee-freshness-fact-flake/`. Either `git add -f` them, or
  cite those durable paths in `root-cause.md` and `files-modified.md` and drop them from the modified-files list. Also
  consider citing this evaluation's `eval-serial-20.log` as the AC2 evidence instead of `green-runs.log`, whose batches
  overlapped.
- Follow-up candidate already noted by the executor: `schemas/pipelines/pipeline-run-record.schema.json`'s
  `triggerSource` enum lacks `auto-run`, which the route returns.
- Side effect of this evaluation, recorded for transparency: the scratch Playwright config resolved `outputDir` to the
  main checkout's gitignored `test-results/`. Playwright clears that directory at the start of each run. My one artifact
  subdirectory was removed by exact path afterwards; only Playwright's own `.last-run.json` remains.
