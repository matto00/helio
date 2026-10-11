## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `ba07d0e8b809cd5f8464888c8ca460512914598c`. The base `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39` was resolved live with `resolve-review-base.sh`, and the script exited 0.
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/skeptic-final-1/`.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/pipeline-switch-stale-steps/HEL-1483`.
- **Diff read in full.** I read `git diff bc8ccac45...HEAD` for every non-test source file:
  - `PipelineDetailPage.tsx` now has a keyed inner component.
  - `usePipelineDetailPage.ts` has the id-scoped selectors and the `stepsFetch` seed gate.
  - `usePipelinePageLoad.ts` has the `onStepsSettled` callback.
  - `pipelinesSlice.ts` has `currentPipelineRequestedId`, `runPipelineId`, the `updatePipeline` guard and the `clearRunState` additions.
  - `PipelineDetailFooter.tsx` makes the step count nullable.
- **C1.** `AppRoutes.tsx` is unchanged. The key lives inside the exported `PipelineDetailPage`. `PipelineDetailPage.switch.test.tsx:140` renders `<Route path="/pipelines/:id" element={<PipelineDetailPage />} />`, which is the real element. C1 is honoured.
- **Root cause recorded before the fix (AC1).**
  - `evidence/probe-base-state-log.txt` shows `stepsInitialized:true, steps:3, persisted:1` on B.
  - `probe-base-sidebar-edit.txt` shows that on base, B's page sent `PATCH /api/pipeline-steps/e7e2633e…`, which is step a0 of pipeline A. That is a real cross-pipeline write.
  - `red-switch-test-on-base.txt` ends with `Tests: 8 failed, 1 passed, 9 total`.
  - Caveat: the base palette probe (`probe-base-palette.txt`) never left A, so it shows nothing about the palette on base. The sidebar and back/forward probes do reproduce.
- **Gates, re-run fresh by me in the worktree:**
  - `npx jest src/features/pipelines`: 108 suites, 1616 tests passed.
  - `npm run typecheck`: exit 0.
  - `npm run lint` (`--max-warnings=0`): clean.
  - `npm run format:check`: "All matched files use Prettier code style!".
  - I did not re-run the full jest suite. The evaluator pasted the full-suite output in `evaluation-2.md`, and the changed code is confined to `features/pipelines`, which I re-ran.
- **The 23 tests moved to `render*Settled`.** The helper adds one `await act(async () => {})` before the existing interactions. The state before the fetch settles is now covered separately by the switch suite: the "steps loading skeleton … while B's steps fetch is pending" test, plus `mutation-no-steps-skeleton.txt`. No assertion was dropped. I accept the evaluator's reading here.
- **Running app.** I started servers on 6915/9822 with `start-servers.sh` and got `PASS servers`.
  - Throwaway user `hel1483-skeptic-1791714083048@example.com`.
  - Created: A `f65436f5-28c5-40ae-a072-cc1e87106fcc` (3 steps), B `3a38edc9-c673-42f7-941d-327e19164683` (1 step), sources `5028d598-7bed-4126-a024-f8201cdb0aff` and `d9bc68f4-eabc-47cc-8490-1b4dc4db9126`.
  - All four were deleted by exact id afterwards (204 x4).
  - My servers were stopped by exact PID: vite 3764851, npm 3764825, java 3764294, sbt launcher 3763985 and 3763943.
- **Happy paths, all correct:**
  - Sidebar B→A: sampled every 25 ms, the page went from the skeleton straight to A's 3 cards and "3 steps", never B's cards.
  - Back went to B (1 card, "1 step"). Forward went to A (3 cards).
  - Palette recents A→B showed B's single card (`B-via-recents-dark.png`).
  - Light theme with `/steps` held for 5 s: the steps skeleton renders correctly, with no "No steps yet" and no count (`A-steps-pending-light.png`).
  - Console: the only errors were the `/schedule` 404s, which also appear on base.
- **Adversarial probe of the slice guards. This found a defect, reproduced twice by two different code paths.**
  - Path 1: on A, Add source (`POST /roots` held for 4 s by an XHR shim), then sidebar to B. B rendered correctly (1 card) until the unmounted A page's `handleAddRoot` continuation dispatched `GET /api/pipelines/A` at about 3.7 s. B's page then dropped to the full-page skeleton and stayed there. It was still blank more than 18 s later, with no further requests (`stuck-skeleton-B-after-late-A-refetch-dark.png`).
  - Path 2: on A, Remove source (`DELETE /roots/…` held for 3 s), then sidebar to B. Same result: B showed its card and name until A's late `GET /api/pipelines/A` plus `/steps`, then a blank page (footer name `undefined`, cards `[]`) for the rest of the 10 s window.

### Verdict: REFUTE

### Change Requests

1. **A late `fetchPipelineById(A)` dispatched after the switch leaves B's page permanently blank (AC3, C2, design D3.3/D5c).**
   - The trigger is a continuation of the unmounted A page, at `usePipelineRootAndToggleActions.ts:54` (`handleAddRoot`) and `:76` (`handleRemoveRoot`).
   - That dispatch sets `currentPipelineRequestedId = A`. From then on:
     - B's own `fetchPipelineById(B)` response is discarded as "stale" if it hasn't landed yet (`pipelinesSlice.ts` fulfilled/rejected guard).
     - A's response replaces `currentPipeline`.
     - The hook's `storedPipeline?.id === id` filter turns that into `currentPipeline = null`, and `ownsPipelineStatus = false` reads as `"idle"`.
     - `usePipelinePageLoad` never refetches, because `lastFetchedIdRef === id`.
   - Net effect: the `PipelineDetailSkeleton` shows forever, and only a full reload recovers.
   - On base the same race showed A's header on B. The fix turns wrong data into a dead page, and the late A request still changes what B's page shows, which is exactly what AC3 and D3.3 forbid. "Latest request wins" is the wrong ownership rule: a request issued by a page that no longer exists must not disown the current page's pipeline.
   - Fix it so the page's own pipeline is never lost to another id's request. Any one of these would do:
     - (a) Re-issue `fetchPipelineById(id)` when the page's pipeline is missing and nothing is in flight for this id, without looping.
     - (b) Hold the loaded pipeline per id, so B's response is never discarded because another id was requested later.
     - (c) Make the root add/remove continuations skip the refetch when their page has unmounted or the route id changed. (c) alone is fragile: any future late dispatch re-opens the hole.
   - Add a red-first jest test in `PipelineDetailPage.switch.test.tsx`: on A, start add-root with a deferred `addPipelineRoot`, switch to B, resolve the deferred, flush. Assert that B's name and steps render and that the page skeleton is gone. Show it red on HEAD `ba07d0e8b`. Cover `handleRemoveRoot` too, or show both share the fixed path.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/skeptic-final-1/stuck-skeleton-B-after-late-A-refetch-dark.png`. The request logs for both paths are in this report above.

### Non-blocking notes

- After the stuck state, a `goto` triggered a `beforeunload` prompt on B's page. Something reported unsaved state, presumably the A page's root-add/remove continuation. I did not investigate further; check it while fixing CR1.
- The steps skeleton's `aria-label="Loading steps"` sits on a plain `div` with no role, as the evaluator also noted. `role="status"` or `aria-busy` on the tabpanel would make it announced.
- "Run pipeline" and "Dry run" stay enabled while the steps skeleton is showing. This is harmless (the run is server-side), but consider disabling them while `stepsLoading`.
- The steps-skeleton markup duplicates `PipelineDetailSkeleton`'s river block. Consider a shared `PipelineRiverSkeleton`.
- Process: my first screenshot landed in the main checkout root because a relative filename resolves to the MCP workspace. I moved it into the evidence dir straight away. Nothing of mine remains in the main checkout's `.playwright-mcp/`; those files were moved to `skeptic-final-1/playwright-mcp/`.
- No mtime-ordering evidence is relied on anywhere in this report.
