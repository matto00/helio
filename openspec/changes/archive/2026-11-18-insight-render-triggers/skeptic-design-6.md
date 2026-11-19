## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed at HEAD 374741b68378cc38a0228b586f01e699f31b0a71. The change directory holds untracked planning artifacts.
The scope is the three items the orchestrator named: (1) attempt `created_at` = render start and the catch-up; (2)
status-only coalescing; (3) R3b. Earlier skeptic reports and the design's own claims were treated as claims to check.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/insight-render-triggers/HEL-1743`.
- **Round-5 fixes are in the text.**
  - D2 and the "Render guards" requirement now say `created_at` is the render START, captured before inputs are
    read. Task 4.5 and the scenario "Run during an in-flight render is caught up" were added.
  - D4 and the spec coalesce no-send outcomes on status alone and update `created_at`/`trigger`/`run_id`/
    `input_digest` by id. Task 4.3 now uses CHANGING data. The garbled D4 fragment is gone.
- **What `last_run_at` actually is.**
  - `val now = Instant.now()` is taken at the start of `writesChain()` (PipelineRunSucceededWrites.scala:80), BEFORE
    `materializedWrites` writes and commits the node snapshots and history (:93 onward).
  - That `now` is written as `last_run_at` by `writeLastRun` in `updateMeta` (:255-258), which is
    `updateLastRun`/`updateLastRunInternal` setting `lastRunAt = at` (PipelineRepository.scala:568-618).
  - So `last_run_at` is the time the run's write phase began. It is not the time its data became readable.
- **Same-pipeline runs can overlap.**
  - `hasActiveRunInternal` is consulted only by HookTriggerService.scala:52, PipelineAutoRunDebounceFirer.scala:56
    and PipelineSchedulerService.scala:187.
  - Neither PipelineRunService.scala nor PipelineRunExecutor.scala has an overlap check. A manual run can therefore
    overlap another manual run (owner plus editor) or a scheduled, hook or auto run.
- **The store.**
  - V145 has no CHECK tying `trigger`, `run_id` or `model` together, so an UPDATE of
    `trigger`/`run_id`/`created_at`/`input_digest` is mechanically allowed. UPDATE is granted to `helio_privileged`.
  - The V145 header states that token counts and `cost_micros` are NULL when no model call happened.
  - `latestAttempt`, `latestOk`, `listRecent` and `purge` all order by `created_at DESC, id DESC`
    (OutputInsightRepository.scala).
  - `purge` always keeps each Output's newest row and newest `ok` row, so a coalesced row whose `created_at` keeps
    moving forward is never purged while it is live. Purge is safe under coalescing.
- **"Ten identical runs, one model call" under coalescing.**
  - Run 1 inserts `ok`. Run 2 inserts `skipped_unchanged`, because the newest attempt is `ok` and the statuses
    differ. Runs 3-10 UPDATE that row.
  - Result: one `ok` row and one `skipped_unchanged` row whose `created_at` is the tenth render's start. This matches
    the scenario.
  - The digest guard runs before the throttle, so the throttle does not matter here. Test 4.4 awaits each render, so
    no run is dropped as in-flight. Sound.
- **Free tier, zero sends, one row.**
  - There is never an `ok` row and never a model call, so neither the digest guard nor the throttle fires. Every
    trigger reaches the quota guard, gets `skipped_quota`, and coalesces into one row on status alone, whatever the
    data.
  - Caveat: `skipped_budget` (PackTooLarge) is decided in `prepare`, before the guards (D2 order). A free Output whose
    pack crosses the budget gets a second row. Note only; test data is small.
- **Daily "exactly one daily attempt".**
  - A daily render that coalesces into yesterday's skip row relabels it `daily` and moves `created_at` to 06:00.
  - The 06:10 and 06:30 ticks then see a newest attempt at or after 06:00 and do not select it.
  - The scenario holds, provided render start comes from the same injected clock as the pass `now` (note below).
- **Catch-up under coalescing.**
  - A catch-up render that ends in a no-send status coalesces and moves `created_at` past `last_run_at`, so the
    catch-up stops after one pass. No loop.
- **`/insight/history`.** Fewer rows; a coalesced row shows its latest `trigger`/`run_id`. `since` filters on the
  moved `created_at`. Acceptable.
- **R3b.**
  - The public route returns only `latestOk` through an allow-list type with no status field
    (OutputInsightProtocol.scala). Viewers cannot reach the real status through the public route.
  - Both authenticated shapes emit `status` (`attemptJson`, `historyItemJson`). Both schemas enumerate exactly
    `ok, failed, skipped_quota, skipped_unchanged, skipped_budget`, so `not_updated` must be added to both.
  - D8 says to add it. Task 3.3 does not list it (note).
  - `findById` is pipeline-ACL via RLS (`helio_can_access_pipeline`, OutputRepository.scala:139-145). Resolving the
    role through `requireAccess("pipeline", ...)` is therefore consistent with who can read at all.
  - Spec, D8, task 3.1 and task 4.10 agree: viewer `not_updated` in `lastAttempt` and in every history item; owner and
    editor see the real status; a fail-first test per role on both routes.
  - Detail fields (model, tokens, cost, runId, inputDigest) are already optional in both schemas.

### Verdict: REFUTE

### Change Requests

1. **Render-start `created_at` does not close the catch-up gap. The design states that it does.**

   D2 says that because `created_at` is the render's start, "a run that succeeded during an in-flight render stays
   newer than that render's row". That holds only if a run's `last_run_at` is no earlier than the moment its data
   became readable. It is earlier: `last_run_at` is captured at the start of the write phase
   (PipelineRunSucceededWrites.scala:80), before the snapshot commits, and runs can overlap (manual submit has no
   overlap guard, see above).

   Counterexample:
   - Runs 1 and 2 of one pipeline overlap (owner and editor each click Run, or a manual run during a scheduled run).
   - Run 2 enters `writesChain` at L2 and captures `last_run_at = L2`.
   - Run 1 publishes. Render 1 starts at s1 > L2 and reads its inputs before run 2's node write commits.
   - Run 2 commits and publishes. Its render is dropped as an in-flight duplicate, or throttled if render 1 has
     already sent.
   - The catch-up predicate `last_run_at (L2) > newest attempt created_at (s1)` is false. Run 2's data is never
     rendered until a later run happens to render.
   - Overlap can also move `last_run_at` backwards: the later-finishing run writes the earlier L.

   Two more holes in the same predicate:
   - **Throttle path.** The same counterexample applies when render 2 is throttled rather than dropped, not only to
     the in-flight case.
   - **A later failed run hides the success.** D4 requires `last_run_status = 'succeeded'`. If run 2's render was
     throttled or dropped and run 3 then fails, `writeLastRun` writes `failed` with a newer `last_run_at`. Run 2's
     data is then never caught up, even though the spec says the pass renders an insight "whose pipeline succeeded
     after its newest attempt". Throttled renders are routine (any run within an hour of a send), so this is the
     common case, not an edge.

   Required, in D2, D4, D5, the "Daily renders on the scheduler tick" requirement and tasks 2.5/4.5:
   - Pick an anchor that is correct given these facts, or state the residual risk explicitly with its bound in
     Planner Notes ("Risks accepted").
   - One cheap option: a false-positive catch-up costs only a digest computation and a coalesced
     `skipped_unchanged` UPDATE (digest is checked before quota; no send, no charge). So the predicate can be widened
     safely. Examples: drop the `last_run_status` filter, and compare `last_run_at` with a margin covering a run's
     write phase.
   - Correct the D2 sentence so it does not claim more than the mechanism gives.
   - Add a test in which run 2's write phase begins before render 1 starts and commits after render 1 reads its
     inputs, plus a succeeded-then-failed sequence. The current task 4.5 scenario, with sequential runs, passes under
     the defect.

2. **Status-only coalescing of `failed` writes false model, token and cost data onto a new attempt.**

   D4 and the spec coalesce a null-model `failed` (unselectable model, keyless `Unavailable`) into the newest attempt
   whenever its status is `failed`. That newest row may be a SENT failure: a timeout, a transport error or a validator
   `Rejected` result, which carries `model` and, for `Rejected`, tokens and `cost_micros`.

   The UPDATE moves that row to the new `created_at`, `trigger` and `run_id` and keeps its `model`, tokens and cost.
   This happens, for example, after an API failure followed by a restart that narrowed `CLAUDE_SELECTABLE_MODELS` or
   dropped the key. Three consequences:
   - (a) The owner's history attributes a send, and possibly its cost, to a run that made no send. This contradicts
     the spec's "rows with no send SHALL leave it null" and V145's "NULL when no model call happened".
   - (b) The throttle anchor ("newest attempt with `model IS NOT NULL`") is pushed forward by every no-send failure.
   - (c) The catch-up's "last model call >= 1 h old" test is pushed forward with it.

   Required, in D4, task 2.6 and the "Render guards" requirement:
   - Coalesce a null-model `failed` only into a newest attempt that is also `failed` with `model IS NULL`. Say so for
     the other statuses too; they are always null-model, so the key is harmless there.
   - Add a test: a sent-failure row, then an unselectable-model run, leaves two rows and the first row unchanged.

   Also, so the archived specs do not contradict each other: the base requirement "Insight render store"
   (`openspec/specs/insight-render-store/spec.md:9`) says the system "SHALL store each insight render attempt". This
   change stores some attempts as updates of an earlier row. Add a MODIFIED delta for that requirement that names the
   coalescing rule.

### Non-blocking notes

- **`created_at` can move backwards.** The coalescing UPDATE can move `created_at` backwards when two no-send renders
  of one Output overlap. The in-flight set is per-process; a refresh on instance A can overlap the tick on instance
  B. Consider `created_at = GREATEST(created_at, :start)`.
- **One clock.** Render start must come from the same injected clock as `tickPass(now)`, or the 05:59/06:00/06:10/06:30
  test becomes wall-clock dependent.
- **Task text lags the design.**
  - Task 3.3 should list adding `not_updated` to the status enum in both `output-insight-response.schema.json` and
    `output-insight-history-response.schema.json` (D8 says so; the task does not).
  - Task 2.6 says "UPDATE created_at by id"; D4 also updates `trigger`, `run_id` and `input_digest`.
- **Row bounds.**
  - A status that alternates (quota then unchanged then quota, or budget flips) inserts one row per change. Runs bound
    this (10/min), but D4's "one row per status change" has no per-day cap. Stating that worst case in the purge doc
    comment would be honest.
  - A manual refresh that coalesces into the 06:00 daily skip row relabels it `manual`. The record of that day's
    daily attempt is lost. Acceptable; worth one sentence.
- **Viewer inference.** Because coalescing keys on the REAL status, a viewer who sees two adjacent `not_updated`
  history rows can infer they were different real statuses (one quota, one budget), but not which is which. This is
  within R3b's intent (one neutral state). Name it in the PR alongside the broader viewer shape the Planner Notes
  already flag.
