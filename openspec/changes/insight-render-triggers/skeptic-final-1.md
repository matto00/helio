## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `0240a79ffade1573258e2e9c566311dac61d2cb8`. Base from `resolve-review-base.sh` (exit 0): `56b4ae1ffa590fe40065da983cb6234094cb5520`. 100 files, +5205/-173.

### What I verified (with evidence)

1. **The run is never delayed or failed by a render (C16, D1): holds.** `PipelineRunSucceededWrites.scala` returns `published` (the `publishTerminalAfter` future) unchanged. The trigger runs from `published.foreach`, wrapped in `Future.delegate(...).failed.foreach(log.warn)`. A failed chain or a skipped publish (RunNoLongerOpen) never reaches it. A throwing or never-completing trigger cannot change the returned future. `renderForRun` also recovers with `NonFatal`. The scheduler starts `tickPass` with `Future.delegate(...).recover` and does not await it (it is not in the `zip`).
2. **Cost safety: holds.**
   - Guard order in `InsightRenderService.proceed` is digest, then throttle (automatic triggers only), then pack size, then `quotaGate.checkAndIncrement(pipeline.ownerId, model.weight)`, then the send.
   - `modelAvailable=false` writes a no-model `failed` row before the quota guard.
   - The weight is forwarded to `incrementIfUnderCap`. Owner tier returns `Right` without counting. Free tier and an unknown user are denied.
   - The single validator retry sits inside `renderer.send` and is not charged again.
   - No path loops model calls:
     - `InsightRendered` listeners are empty in prod, and a listener cannot trigger a render.
     - I traced `catchUpDue`: after a failed catch-up there is at most one extra hourly send, after which `newestAttempt` passes `last_run_at + grace`.
     - Daily fires once per UTC day, because any attempt stamped after the cut ends it.
     - Manual and pin refresh are bounded by the route limiter (6 per window per instance), the digest skip and the quota.
   - The 4096 cap is `ClaudeInsightClient.MaxOutputTokens = 4096` and `InsightLimits.maxOutputTokens = 4096`. `ClaudeInsightClientSpec` pins it on the wire request.
3. **R3 and R3b on both GET routes: verified live** on the lane backend (keyless, lane DB, throwaway owner, editor and viewer):
   - Owner and editor get `model`, `inputTokens`, `outputTokens`, `costMicros`, `inputDigest` and `runId`, the real `skipped_quota` status, and `canRefresh: true`.
   - The viewer gets none of the cost fields, sees `not_updated` for the `skipped_quota` history item, and gets `canRefresh: false`.
   - Refresh returned 202 for the owner and the editor, and 403 for the viewer.
   - `PublicDashboardRoutes` is untouched by the diff (not in `git diff --stat`).
   - `InsightAccess` adds an app-level `requireAccess("pipeline")` on top of the RLS-scoped `findById`. This is strictly tighter, which matters because RLS is bypassed in dev and CI.
4. **The tick pass: sound.**
   - The `withSystemPinnedSession` advisory lock is taken and released on one pinned connection with no transaction, and `cleanUp(unlock, keepFailure = true)` releases it.
   - Candidates are re-selected under the lock.
   - Within a process, `passBusy` and the bucket CAS (compare-and-set) allow one pass per bucket.
   - Pool impact: one privileged connection is held for the pass, bounded at 10 model calls of up to 30 s each. Design D5 accepts this.
   - ER1 holds: `catchUpDue` reads `last_run_at` regardless of run status, with the 10-minute grace (mutation-recorded in cycle 3).
5. **Docs: present and accurate.** CLAUDE.md now has the refresh endpoint row, the role-shaped `/insight` description, the `INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW` env row and the `HELIO_BETA_MODEL_WEIGHTS` insight-render clause. I read the worktree's CLAUDE.md.
6. **Tests: re-run.**
   - Backend: `sbt -J-Xmx3g testOnly` over `InsightRenderServiceSpec`, `OutputInsightRoleAndRefreshRoutesSpec`, `PipelineSchedulerServiceInsightPassSpec`, `ClaudeInsightClientSpec` and `AiPipelineQuotaGateSpec` gave `Tests: succeeded 69, failed 0` / `All tests passed`. `InsightDigestAndScheduleSpec` lives in `com.helio.domain.insights`, which I mis-addressed, so it did not run in my invocation.
   - Frontend: jest did not narrow and ran the full suite: `Test Suites: 824 passed`, `Tests: 9963 passed`.
7. **C12 evidence: adequate.**
   - `evidence/red-runs.md` records the red stages.
   - `evidence/mutations.md` records a mutation per guard: digest, throttle, quota, weight, hook placement, role shape, R3b, coalescing, ER1, ER2 and GREATEST.
   - Superseded or unreproducible entries are disclosed as such and re-recorded in cycle 3, including the corrected hook-placement mutation.
   - I did not re-run the mutations myself. That rests on the evaluator's reproduction plus the disclosed corrections.
   - None of this evidence depends on mtime ordering.
8. **Live check (C15).** `evidence/live-check.md`: two Haiku renders, each approved separately. Model asserted before the call and from the response. Total spend about $0.0015. I made no live call: `ANTHROPIC_API_KEY` was empty and the backend logged `insight renders disabled`.
9. **UI fold-in: inspected live in both themes.** This is where the defects are (below).

### Verdict: REFUTE

### Change Requests

1. **The new Refresh button hides the panel's status note in a default-sized insight panel.**
   - Where: `frontend/src/features/panels/insight/InsightPanelBody.tsx` renders `{refreshButton}` between the markdown and the `insight-panel__note`.
   - Measured on the default panel (`POST /api/panels` with no layout, the same size a pin produces): `.insight-panel` is clientHeight 90 against scrollHeight 123, panel bottom 256 px, note top 262 px. The note sits entirely below the visible area.
   - Reproduced for both the `failed` note ("The last update failed. Showing the previous insight.") and the `quota` note ("Not updated: the daily AI limit was reached."), in dark and light.
   - Before this change the note directly followed the text and was visible. Now the one piece of state the owner needs (why the text is stale) is hidden behind an inner scroll, while the button that caused it is visible.
   - Fix: render the note directly under the markdown and put the action after it, or move the action out of the body. Add a test that pins DOM order (note before the action).
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/skeptic-owner-dark.png` and `.../skeptic-owner-light.png`. In both, the note is in the DOM but not visible.
2. **Two adjacent controls are both labelled "Refresh" but do different things, one of which spends AI quota.**
   - The card header's icon button (`aria-label="Refresh Regional insight"`, wired to `insightChrome.refetch`) re-reads the stored insight for free.
   - The body's text button "Refresh" starts a model render charged to the pipeline owner's weighted daily quota.
   - A sighted user sees a refresh icon and a "Refresh" button on the same card. A screen-reader user hears "Refresh" twice.
   - DESIGN.md §0.5 ("plain-language copy… say or do something") and §8 (accessible names) are not met when the label does not tell users that one of these acts costs quota.
   - Fix: rename the body action to say what it does, for example "Regenerate insight", or "Update insight" with that as its accessible name. Keep the header control as the re-read. Update `e2e/hel1743-insight-refresh.spec.ts` (`getByRole("button", { name: "Refresh", exact: true })`) and the jest tests to match.
   - Also take the button out of the `role="status"` live region in the `failed` (no render) branch. It is currently a child of `<div ... role="status">`, so the live region's announced content includes a control.
3. **A failed refresh POST is swallowed silently.**
   - Where: `useInsightRefresh.ts`'s `catch {}`.
   - On 429 (the dedicated limiter, 6 per window), 403 or a network error, the button just re-enables with no message. DESIGN.md §7 says "never swallow a failed fetch".
   - Fix: surface a short inline note or toast, for example "Couldn't start an update. Try again shortly.", and add a jest case for the 429 path.
4. **(Polish, fix with 1.)** While refresh is pending, "Updating…" is inserted above the disabled button, and the button is clipped in half at the panel's bottom edge.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/skeptic-owner-pending.png`.
   - Fix: once the order and placement from CR1 are fixed, keep the pending state from pushing content out of the panel.

### Non-blocking notes

- `latestFor` has no ACL. It is documented as internal-only, which is fine for the HEL-919 seam.
- In the tick pass, every render in one pass is stamped with the pass's `now`. This is harmless.
- My viewer-role visual check could not load the dashboard ("Dashboard not found" despite a 201 dashboard grant). That looks like a dashboard-sharing listing issue unrelated to this diff. The viewer API shape was verified directly (item 3), and `deriveInsightState` maps `not_updated` to the neutral note.
- Residue: my three throwaway users were deleted by exact id through `buildUserDeleteSql` on `helio_hel1743`; pipeline, dashboard, source and insight rows cascaded, and counts are 0. Servers were stopped with `stop-servers.sh`.
