## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `89ab0c24f4a3dbcbd5db6fd1f80bd2f17ad51887`. The base was resolved live with `resolve-review-base.sh` and the script exited 0: `f4540f25d38d854746e93cce9c0efe90c5b01a3b`.
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1483/evidence/skeptic-final-2/`.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/pipeline-switch-stale-steps/HEL-1483`.

**Diff read.** I read the full `git diff f4540f25d...HEAD` for these source files:
- `pipelinesSlice.ts`
- `usePipelineDetailPage.ts`
- `usePipelinePageLoad.ts`
- `usePipelineRootAndToggleActions.ts`
- `PipelineDetailPage.tsx`
- `PipelineDetailFooter.tsx`

I also read `PipelineDetailPage.switch.test.tsx`, all 17 tests.

**C1 holds.** `PipelineDetailPage` reads `useParams().id` and renders `<PipelineDetailPageContent key={id} />`. `AppRoutes.tsx` is untouched, and the switch test renders the real `<Route path="/pipelines/:id" element={<PipelineDetailPage />} />`.

**C2 holds.** I reasoned it through as a state machine and confirmed it live.
- `currentPipelineRequestedId` scopes status and error to the requested id.
- Another id's status reads as "idle" on the page. That means:
  - A's failed or loading latch never blocks B: the main load effect fires on mount because `lastFetchedIdRef` is per mount.
  - A's error never shows on B.
- Status can't get stuck at "loading". The fulfilled/rejected guard drops only stale responses, and the latest request always settles its own status.

**Round-1 defect is closed in the running app.** On A I added a source, holding `POST /roots` for 3.5 s with an XHR shim. I switched to B via the sidebar 200 ms later and sampled the page every 20 ms for 9 s.
- Sequence: A (3 cards), then the page skeleton at 251 ms, then B (1 card, "SKF2 Beta") at 355 ms. It never changed after that.
- The request log shows only B's five page-open GETs after the switch. There was no late `GET /api/pipelines/A`.
- The root add itself succeeded: A had 2 roots afterwards, so the continuation did run and correctly skipped the refetch.
- On round-1's HEAD this same sequence left B as a permanent skeleton.

**Loops, stale data and the convergence refetch.** I traced the refetch at `usePipelinePageLoad.ts:82-90`.
- It fires only when the page's status reads "idle" after this mount has already requested. That means another id is the latest request, or the slice was reset.
- Its own dispatch sets `currentPipelineRequestedId = id`, so it cannot fire again without a new foreign request. It cannot loop.
- No production code dispatches `fetchPipelineById` for a foreign id any more. `grep` shows only the page's own load, its convergence refetch, its Retry, and the two mount-guarded root continuations. So the refetch is a backstop.
- `ownPipeline` is only ever assigned when the singleton holds this page's id, so it can never hold A's data.
- `ownRequestFailed` hands back to the error view when the page's own request fails.

**Hidden 404/403: none.** In the running app:
- `/pipelines/0000…` showed "Couldn't load this pipeline".
- Sidebar to B then rendered B (1 card), with no A error.
- Back to `0000…` showed the not-found error again, so it was not hidden.

**No dropped edit beyond the documented non-goal; no cross-pipeline write.** On A I changed the row limit to 9 inside the debounce window, then switched to B via the sidebar 100 ms later.
- After the switch, the request log held only B's five GETs.
- No request carried any of A's step ids or A's pipeline id. The cross-pipeline-request check found nothing.
- The pending A edit is dropped. That is the documented design non-goal and matches leaving A for any other page.

**AC2: every route lands on the right steps** (live, dark theme unless noted).

| Route | Result |
|---|---|
| Sidebar A→B | Skeleton, then 1 card and "SKF2 Beta". A's 3 cards never showed on B. |
| Back | A, 3 cards, "SKF2 Alpha" |
| Forward | B, 1 card |
| Palette Recents → Alpha | 3 cards, "3 steps" |
| Palette search "SKF2 Beta" + Enter | 1 card, "1 step" |

- Each switch issued exactly 5 page-open GETs (pipeline, steps, analyze, schedule, outputs), with no duplicate pipeline fetch from the convergence refetch.
- The only console errors were the known `/schedule` 404s.
- Base behaviour, from existing evidence:
  - `probe-base-state-log.txt` shows `steps:3, persisted:1` on B.
  - `probe-base-sidebar-edit.txt` shows B's page sending a PATCH to A's step.
  - `red-switch-test-on-base.txt` shows `Tests: 8 failed, 1 passed`.

**Visual check, both themes.**
- `B-via-sidebar.png` (dark) shows B with 1 card and the footer "1 step".
- `B-steps-pending-light.png` (light) has `/steps` held for 8 s. The river skeleton ribbons sit in the same column and rhythm as the cards. There is no "No steps yet" and no step count; the footer reads "no output yet".
- `B-settled-light.png` shows the same view once loaded.
- Tokens and shared components are unchanged: it reuses the `Skeleton` shared component and the existing river classes. Light and dark match.

**Gates, fresh on HEAD.**
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run format:check`: "All matched files use Prettier code style!".
- `npx jest src/features/pipelines`: 112 suites, 1662 tests passed.
- Switch + slice tests: 91/91 passed.
- I did not re-run the full jest suite. The change is confined to `features/pipelines`, which I re-ran. `evaluation-5.md` reports a full-suite run of exit 0, 527 suites / 5694 tests.

**Mutation testing.** I used a throwaway detached worktree at HEAD and removed it afterwards with `git worktree remove`.
- **M1:** removed the convergence dispatch in `usePipelinePageLoad.ts:89`. Result: `Tests: 17 passed, 17 total` (`mut-no-convergence.txt`). Nothing guards the convergence refetch on its own; see the non-blocking notes.
- **M2:** removed the convergence dispatch and the unmount skip together (`mountedRef` forced true). Result: `Tests: 2 failed, 15 passed`. Both "B converges … refetches A late" tests fail (`mut-no-convergence-no-unmount-skip.txt`). Together the two defences are guarded.
- **`ownPipeline` keep, evaluator's run:** guarded on its own (`eval-5/mutation-no-ownPipeline-keep-skip.txt`, 1 failed). I read the test at `switch.test.tsx:491`; it does exercise the keep. It dispatches a foreign `fetchPipelineById("A")` while B is mid-edit and asserts no skeleton, no "Pipeline A", and that B's PATCH lands.
- **Earlier mutation evidence:** I checked the summaries, and each failed on its named test:
  - `mutation-no-stale-fetch-guard`
  - `mutation-no-run-guard`
  - `mutation-key-only-no-D2a`
  - `mutation-analyze-wrong-id`
  - `mutation-no-steps-skeleton`

**Merge of origin/main.** `git diff d924f0545 HEAD` over the branch's own frontend files is empty. Since the merge, origin/main has moved one commit (`5986340c5`, HEL-1301 e2e teardown), which touches none of the pipelines files.

**Teardown.**
- Throwaway user `hel1483-skf2-1791744159423@example.com` (id `f20776f7-e1fd-4357-9fd3-d13d4a969b7b`).
- The ids I created were recorded up front in `created-ids.json`.
- Deleted by exact id, 204 each:
  - pipelines `1b6d3330-bd59-460a-a6f7-2d13ff50c32e` and `f70f9c26-6ee8-4ca7-ae21-d4815f38c09c`
  - sources `0f0a8169-aa33-4cf6-92ed-dd1492c4c783` and `d055ad97-e02a-484a-942d-6cba0ba0b700`
- The user row remains, because there is no user-delete API.
- My servers were stopped by exact PID (vite 2263394, npm 2263379, java 2262966, sbt launcher 2262504, sbt 2262437), and both ports are free.
- My Playwright files were moved to `skeptic-final-2/playwright-mcp/`.

### Verdict: CONFIRM

All seven ACs trace to code and observed behaviour, C1 and C2 hold, and the round-1 defect is closed in the running app. I found no stale A data on B, no stuck or looping state, no hidden 404/403, and no cross-pipeline write. The only dropped edit is the documented non-goal.

### Non-blocking notes
- The convergence refetch (`usePipelinePageLoad.ts:82-90`) cannot be failed by any mutation on its own (M1 stays green). The unmount skip also cannot be failed on its own (`mutation-no-unmount-skip-still-green.txt`). Only the pair is guarded (M2).
  - The two "B converges when A's … continuation refetches A late" tests are mis-titled at HEAD. With the skip in place, A's continuation no longer refetches A, so they really pin "skip OR converge".
  - Suggested follow-up: in the foreign-fetch test at `switch.test.tsx:491`, add `expect(getPipelineById).toHaveBeenLastCalledWith("B")` after the foreign dispatch. That one line makes the backstop failable.
  - This is not blocking: no production path issues a foreign fetch today, and the user-visible behaviour is correct.
- Carried over from earlier reports:
  - The river-skeleton markup is duplicated between `PipelineDetailPage.tsx` and `PipelineDetailSkeleton.tsx`.
  - "Run pipeline" and "Dry run" stay enabled while the steps skeleton shows.
  - The switch suite produces many `act(...)` warnings.
- The PR body should state that a pending debounced step edit is dropped on a pipeline switch (design non-goal, same as leaving to any page).
- No mtime-ordering evidence is relied on.
