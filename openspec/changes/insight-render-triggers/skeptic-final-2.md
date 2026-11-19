## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `cdf32a4befb857fc85ddf83361c2277737fa60cc`. I resolved the base live with `resolve-review-base.sh` (exit 0): `56b4ae1ffa590fe40065da983cb6234094cb5520`. The diff is 102 files, +5447/-182.

No evaluator pass ran on `cdf32a4be`; evaluation-2 and skeptic-final-1 both reviewed `0240a79ff`. Everything below I re-derived myself.

### What I verified (with evidence)

1. **Run safety (C16, D1): holds.**
   - `PipelineRunSucceededWrites.scala` returns the `publishTerminalAfter` future (`published`) unchanged.
   - The trigger runs from `published.foreach { Future.delegate(...).failed.foreach(log.warn) }`. So a failed chain, a skipped publish, or a throwing or hung trigger cannot alter the run's result or event timing.
   - `renderForRun` recovers with `NonFatal`.
   - The scheduler starts `tickPass` with `Future.delegate(...).recover` and leaves it out of the awaited `zip`.
2. **Cost safety: holds.** I read `InsightRenderService.scala` in full.
   - **Guard order:** model resolve → keyless no-model `failed` row (no charge) → digest (`latestOk.inputDigest`) → hourly throttle (automatic triggers only) → pack size → `quotaGate.checkAndIncrement(pipeline.ownerId, model.weight)` → send.
   - **Quota:** free tier and an unknown user are denied, so they get `skipped_quota` and no send. Owner tier is not counted. Beta is charged through `incrementIfUnderCap(owner, limit, weight)`.
   - **Retry:** the validator retry is inside `renderer.send` and is charged once.
   - **Timeout:** a 30 s Promise race; a late result writes no row. `inFlight` is released only when the send completes.
   - **4096 cap:** `ClaudeInsightClientSpec` pins it on the wire request (it passed in my run).
   - **Catch-up cannot loop:** I traced `InsightSchedule.catchUpDue`. The catch-up's own row is stamped after the run plus the 10-minute grace, and `lastModelCall` bounds sends to one per hour.
   - **Daily fires once:** `dailyDue` ends once any attempt is stamped after the 06:00 UTC cut, and coalescing stamps `created_at`.
   - **Manual and pin refresh** are bounded by the dedicated limiter, the digest and the quota.
3. **R3/R3b: holds.**
   - `InsightAccess.isPrivileged = access != Viewer`, and `ResourceAccess` has only Owner, Editor and Viewer.
   - `OutputInsightRecord.forViewer` strips model, token counts, cost, runId and inputDigest, and maps `skipped_quota`/`skipped_budget` to `not_updated`. It is applied to `render`, `lastAttempt` and every history item.
   - Refresh returns 403 for a viewer and 404 for a stranger, an unknown id or a non-insight Output.
   - `OutputInsightRoleAndRefreshRoutesSpec` passed in my run.
4. **Tick pass: sound.**
   - It runs once per aligned 15-minute bucket and keeps one pass in flight per process.
   - Across instances, a `pg_try_advisory_lock` is taken on a pinned session with no transaction, and released by `cleanUp(unlock, keepFailure = true)`.
   - Each pass is capped at 10 model calls, and a failure never reaches the tick.
5. **Backend specs re-run, including `InsightDigestAndScheduleSpec`, which the prior review missed.**
   - Command: `sbt -J-Xmx3g testOnly com.helio.domain.insights.InsightDigestAndScheduleSpec` plus `InsightRenderServiceSpec`, `OutputInsightRoleAndRefreshRoutesSpec`, `PipelineSchedulerServiceInsightPassSpec`, `ClaudeInsightClientSpec`, `AiPipelineQuotaGateSpec`, `InsightModelConfigWriteSpec`, `OutputInsightReadServiceShapeSpec`, `InsightConfigSpec`, `ExistenceNotLeakedRoutesSpec`, `InsightPreflightSpec`, `OutputInsightRoutesSpec` and `InsightRendererSpec`.
   - Result: `Tests: succeeded 191, failed 0` / `All tests passed`.
   - `InsightDigestAndScheduleSpec` ran 7 tests: timestamp-free digest, flat-state equivalence, window collapse, digest sensitivity, daily at 06:00 once per UTC day, catch-up rule, and no catch-up for a pre-insight run.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/skeptic2-sbt.out`
   - I did not re-run `testFull`. The only commit after evaluation-2's green `testFull` (9981/0) changes no backend code.
6. **Frontend gates:**
   - jest `features/panels/insight|outputEditor|features/ask`: 42 suites, 564 tests, all pass.
   - `tsc --noEmit`: clean.
   - eslint `--max-warnings=0` on the changed directories: clean.
   - prettier on the changed files: clean.
7. **e2e:** `hel1743-insight-refresh`, `hel1744-insight-panel` and `hel1746-ask-ui`, Playwright with 2 workers.
   - Setup: lane servers from `start-servers.sh`, lane DB `helio_hel1743`, `ANTHROPIC_API_KEY` empty. The backend logged `insight renders disabled`.
   - Result: **20 passed (1.8m)**. The teardown deleted 28 recorded users.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/skeptic2-e2e.txt`
   - **Disclosure:** my first attempt omitted `DATABASE_URL` from the Playwright process environment. The e2e psql helper (`e2e/support/db.cjs`) then fell back to its default connection. Its guarded seed and cleanup matched 0 rows there (`changed 0 row(s)`, `0 of 20 ... nothing deleted`), so nothing outside the lane DB was modified. I deleted the 20 lane-DB users from that run by exact id with `deleteRecordedUsers`/`buildUserDeleteSql`, then re-ran with the lane DB set.
8. **Docs:** the worktree's CLAUDE.md has:
   - the refresh endpoint;
   - the role-shaped `/insight` description;
   - the `INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW` row;
   - the insight-render clause in `HELIO_BETA_MODEL_WEIGHTS`;
   - daily at 06:00 UTC;
   - the pin-refresh note on the ask endpoint.
9. **C12 evidence: adequate.**
   - Cycle 4's red run is recorded in `evidence/red-runs.md` (`9 failed, 15 passed` against the unchanged panel), together with its green.
   - Earlier cycles' order gaps are disclosed honestly and backed by reproduced mutations (evaluation-2).
   - None of it rests on mtime ordering.
10. **Fold-in UI, checked live at the default panel size in light and dark.** Setup: a throwaway beta owner on the lane DB, one seeded `ok` render plus a `skipped_quota` attempt, and the keyless refresh path.
    - Fixed:
      - The status note now directly follows the text and is fully in view in a default-sized panel (text 178–214, note 222–237, panel bottom 256).
      - The action is named "Update insight". The header icon remains the free "Refresh".
      - A 429 (7 clicks against the limit of 6) shows the inline `role="alert"` "Couldn't start an update. Try again shortly." in both themes.
      - The pending label is on the button.
      - The action is out of `role="status"`.
    - Defect: see CR1.

### Verdict: REFUTE

### Change Requests

1. **In both no-render states, the "Update insight" action now floats to the right of the centred state message instead of sitting under it.**
   - Affected states:
     - **failed, no render:** "The last update failed / No insight has been rendered yet." This one is a regression from `cdf32a4be`. Before it, the button sat inside the centred column.
     - **not yet rendered:** "Not yet rendered / This insight will appear after its first render."
   - Where: `frontend/src/features/panels/insight/InsightPanelBody.tsx`, the `notRendered` branch (about lines 177–186) and the `failed` branch (about lines 187–199).
   - Cause:
     - Both branches return a fragment: the `panel-content--state` status div, followed by a sibling `<div className="insight-panel insight-panel--action">`.
     - Their parent is the panel's `crossfade__layer`, which computes to `display: flex; flex-direction: row`.
     - So the message is centred in the left part of the card and the button is top-aligned at the right edge.
   - Measured on the "Fresh insight" card: status block 358–448, button 370–402 at the right edge. The same happens in light and dark.
   - Evidence:
     - `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/skeptic2-board-dark.png`
     - `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/skeptic2-board-light.png`
     - In both, see the middle and bottom cards.
   - Sibling pattern it diverges from: `PanelContent.tsx` "Not run yet" (about lines 191–211). That state stacks label, then detail, then the `ui-modal-btn--secondary` action in one centred column.
   - Fix:
     - Render both no-render branches as one centred column: a `panel-content panel-content--state` wrapper with **no** role, holding a `role="status"` element (label and detail) followed by the action, which includes the inline failed-start alert.
     - This keeps skeptic-final-1 CR2's rule (the control stays outside the live region) and restores the stacked layout.
     - Add a jest assertion that the action and the status share one column container, not sibling fragments. A DOM check that the button is not inside `[role=status]` is not enough.
     - Re-check both states visually at the default panel size, in both themes.
   - Note: the cycle-4 visual check in `red-runs.md` covered only the rendered quota state, which is why this was missed.

### Non-blocking notes

- **Rendered branch at the default size:**
  - With a two-sentence render the panel scrolls, and only a ~10 px sliver of the action's top border shows above the footer (`skeptic2-quota-light.png`).
  - When scrolled, it is fully reachable and fully visible (`skeptic2-quota-light-scrolled.png`).
  - This is acceptable scroll behaviour, now that the note takes priority. A fade or a little more bottom padding would make it read as intentional.
- **"Updating…" can appear twice:** with `state.kind === "rendering" && !render` while `refreshing`, the status label and the button label both read "Updating…".
- **`aria-busy`:** the button always carries `aria-busy="false"` when idle. This is harmless.
- **Harness hazard:** `e2e/support/db.cjs` silently falls back to the default dev connection when the Playwright process has no `DATABASE_URL`, even though the servers run on a lane DB. The guards made it a no-op here. Lane briefs should set `DATABASE_URL` for `npm run e2e`, not only for `start-servers.sh`.
- **Residue:**
  - My throwaway user (`6ac0dbd2-cdf2-4206-aaef-6c954e09064b`) was deleted by exact id through `buildUserDeleteSql` on `helio_hel1743`. Counts for the user, its pipelines and its insight rows are 0.
  - The 48 e2e users were deleted by the teardown (28) and by my exact-id cleanup (20).
  - Servers were stopped with `stop-servers.sh`.
  - No live model call was made, and no `.env` file was read.
