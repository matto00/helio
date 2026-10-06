## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `318e117ceefe0882f5e1e5a435e270195f1ad1ae`. I resolved the base live with `resolve-review-base.sh` (main/origin): `b16bfa1b3a74905eefc0208a01793efa047909c5`.
The branch has four commits on that base: 4f543009b (item 1), b92f6d54e (item 2), d3f8e6183 (item 3), and 318e117ce (item 3 follow-up).
Durable evidence is under `/home/matt/Development/helio/.concertino/runs/HEL-1340/evidence/.concertino/sk-evidence-tmp/`, written `SK/` below.
Every mutation below was run in a throwaway detached worktree. That worktree is removed, and WORKTREE_PATH was never modified.

### What I verified (with evidence)

**AC1 (reorder renderKey carry): MET.**
- The test `a non-head reorder keeps a created draft's card open` lands in 4f543009b on its own, against unmodified production code.
- Its post-create steps-GET fixture head-splices `ai-1`, as D2 and probe.md require.
- Mutation M1: I replaced `{ ...pipelineStepToStep(persisted), renderKey: s.renderKey }` with `pipelineStepToStep(persisted)` in `handleReorderSteps` (usePipelineDetailPage.ts:1089). Result: 1 failed / 11 passed, and the failing test is exactly that one (`SK/hel1340-skeptic-m1-reordercarry.log`). With the code restored, 12/12 pass.

**AC2 (refactor b92f6d54e is behaviour-preserving and reviewable on its own): MET.**
- `git show --stat b92f6d54e` lists only usePipelineDetailPage.ts, usePipelineStepCreation.ts (new) and tasks.md. `git diff 4f543009b b92f6d54e -- '*.test.*'` is empty.
- At b92f6d54e alone (detached worktree):
  - full frontend Jest (`--maxWorkers=2`, nice 19): 439 suites / 4582 tests passed, exit 0 (`SK/hel1340-skeptic-b92-full.log`)
  - `tsc --noEmit`: 0
  - eslint on hooks/: 0
- I read the moved code hunk by hunk.
  - `handleInsertStep`, `handleAddStep`, `handleAddLaneStep` and the draft-create half of `handleStepConfigChange` are verbatim. Their deps arrays gain only identity-stable refs and setters.
  - `handleStepConfigChange` keeps its statement order: `setSteps`, then error-clear, then the create sequence.
- The relocated `useRef`/`useState`/`useCallback` have no readers between their old line (:175-195) and the new call site. I grepped at b16bfa1b3: the readers are only :781-905, :1089-1151, :1561 and :1590.
- The commit adds no `useEffect`.
- The page hook went from 1598 to 1369 lines at b92f6d54e (1397 at HEAD). The new hook is 339 lines (347 at HEAD).

**AC3 (in-flight select shows the chosen field): MET.**
- Red run: I reverted all item-3 production files to b92f6d54e and kept the HEAD tests. All 3 new tests fail with `Received: — select a string field —` (3 failed / 9 passed). At HEAD, 12/12 pass.
- Root cause: probe-evidence.md records the `getAnalyzeSchema` probe (`pendingMeta= false` after send). The code agrees: `pendingDraftMetaRef.current.delete(stepId)` at send.
- Mutations at HEAD:
  - M2: no fallback write at send (usePipelineStepCreation.ts:280). The in-flight test and the lane test go red.
  - M3: StepCard chip guard reverted to `!isDraft`. Scenario 2 goes red with `− notes`.
  - M4: exact-anchor fallback dropped (usePipelineDetailPage.ts:546). The lane test goes red.
  - M5: no re-key to the persisted id (usePipelineStepCreation.ts:298). Scenario 2 and the lane test go red.
  - Logs: `SK/hel1340-skeptic-m{2,3,4,5}-*.log`.
- Live check (servers via start-servers.sh on 6772/9679, `assert-phase servers` PASS, headless, 1 worker, nice 19, isolateLivePage, dedicated `@example.test` users), lane draft, light and dark themes (`SK/hel1340-skeptic-e2e-{light,dark}.log`):
  - in flight: select `notes`
  - post-swap with its own `/analyze` held (held=1): select `notes`, card inside `[aria-label=Lanes]`, removed chips `[]`, still expanded
  - settled: chips `["+ summary"]`
  - Screenshots: `SK/hel1340-sk-light-2-post-swap-held.png` and `SK/hel1340-sk-dark-2-post-swap-held.png`. Both themes match, and there is no visual change beyond the corrected select and the absent false chips. The diff adds no styling.
  - The only pageerror (localStorage on `about:blank`) came from my own `addInitScript` running on isolateLivePage's blank page. It is not app code.

**Gates at HEAD 318e117ce, re-run by me in WORKTREE_PATH:**

| Gate | Result |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| frontend Jest | 439 suites / 4585 tests, 0 |
| root Jest | 38 / 371, 0 |
| `npm --prefix frontend run build` | 0 |

No backend files changed, so backend-test does not apply.

**Constraints:**
- C1: HEL-1294's `markCreating`/`isCreating` moved verbatim and is untouched otherwise.
- C2: verified above.
- C3: red and green reproduced for items 1 and 3.
- C4: commits are in D1 order, plus one follow-up commit.
- C5: no change to ci.yml, playwright.config.ts or .gitignore.
- C6: no backend file, and no resync added to `createDraftIfComplete`.
- The H2 ruling is present in events.jsonl.

**CR1 blind-spot hunt (the driver's third point). One found, below.**
- `hasOwnAnalyze` reaches StepCard at 3 production sites: PipelineRiverView.tsx:377, LaneColumn.tsx:222 and LaneColumn.tsx:274.
- **Code is correct at all three.** I verified this by reading and, for the lane site, live.
- **Only the trunk site is guarded by any test.**
  - M7: forcing PipelineRiverView.tsx:377 to `hasOwnAnalyze={true}` fails scenario 2.
  - M6: forcing both LaneColumn sites to `hasOwnAnalyze={true}` leaves the whole `src/features/pipelines` suite green, 1067/1067 (`SK/hel1340-skeptic-m6-lanesites-true.log`).
- The reason is the test fixture. In the RTL "lane draft" test, the draft never renders through `LaneColumn` at all. I probed pre-swap (`inLane=false groups=0`) and post-swap (`aiInLaneGroup=false laneGroups=0`, `SK/hel1340-skeptic-lanechip-m7.log`).
  - The fixture's trunk steps carry no `rootId`, so `buildLaneGraph` treats them as unassigned and sweeps everything, the draft included, into the primary lane.
  - That test does pin D4(b), exact-anchor resolution through the meta. It does not exercise lane rendering.
  - In the real app the lane draft does render inside `[aria-label=Lanes]` (my live probe, `inLaneGroup=true`).
- The prop is optional, with `?? true` / `= true` defaults that fail open. So neither tsc nor any test would notice if the lane threading were dropped, and lane drafts are exactly the D4 lane-variant path.
- This is a regression fix (cycle-1 evaluator CR1) whose guard covers 1 of the 3 sites it has to protect. Per the red-first discipline this run is bound by, the guard has to be failable by mutation at every site it claims.

**Gate defect check:** no report I read discloses unsound evidence mtimes. My evidence is content-based: test names, assertion text and counts. It does not depend on ordering.

### Verdict: REFUTE

### Change Requests

1. **Pin the CR1 chip suppression on the lane render path.** Files: `frontend/src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx`; the sites to guard are LaneColumn.tsx:222 and :274.
   - Add (or extend) an RTL test in which the created lane draft actually renders inside a `[aria-label="Lanes"]` group, both before and after the swap. Give the fixture's trunk steps `rootId: "root-1"` (and the real parent chain) so `buildLaneGraph` builds a real child lane, as the live app does.
   - Hold the post-swap `analyzePipeline` unresolved, the same way scenario 2 does: wait for the call count to rise.
   - Then assert three things:
     - the card is inside the Lanes group
     - the select shows the chosen field
     - no `.pipeline-detail-page__step-card-diff-chip--removed` is rendered
   - Required proof, recorded in probe-evidence.md: green at the fix, and red when both `hasOwnAnalyze={hasOwnAnalyzeEntry?.(step.id) ?? true}` sites in LaneColumn.tsx are replaced with `hasOwnAnalyze={true}`. Today that mutation is green across all 1067 pipelines tests.
   - Optional, and not a substitute for the test: make `hasOwnAnalyzeEntry` required on `PipelineRiverView`/`RootColumn`/`LaneColumn`, so a future render site that forgets it fails tsc instead of failing open.
   - Also correct the lane test's comment or name if it keeps the unassigned-root fixture. Today it reads as a lane-rendering test, and it is not one.

### Non-blocking notes

- Possible flush race in the cleanup effect (usePipelineDetailPage.ts:560-566), which the evaluator also noted.
  - If a pending passive-effect flush runs, with the pre-swap `steps`, between the `.then` re-key and the swap commit, it deletes the persisted-id fallback.
  - The failure is safe: it falls back to the pre-fix placeholder until analyze lands, and false chips stay suppressed by `hasOwnAnalyze`.
  - Lazy deletion (D4(c)) would remove the race.
- probe-evidence.md cites the CR2 mutation site as `:555`. It is `:546` at HEAD.
- usePipelineStepCreation.ts is 347 lines, over the ~250 soft budget. Note it in the PR body.
- Pre-existing, for HEL-1345, as the evaluator found: a trunk-append AI draft vanishes after the swap until reload, because of the backend head-splice.

### Housekeeping

- Shared dev DB, everything I created, all deleted by exact id and re-counted at 0:
  - users `aaa1f647-d77b-49fc-8ffe-bd24978806f2` and `e9eb5a39-fa0d-45dd-87d6-1ffed9d0b80c`
  - pipelines `37050de2-feba-4a71-89a1-bb3b76cdcecd` and `38010ba7-4c93-43fc-89ea-fea5f11ce5ff`
  - steps `e0edf359-c958-44e7-9d47-d97c26a63d67`, `acf5b107-3eae-4adf-895f-682d2f9802a8`, `1fd82f30-4500-4f20-aa41-7d2549a96dcb` and `5a7686d3-6ae3-44d1-bcce-efba8da87ee3`
  - sources `85abc12d-6917-40a7-a7b0-f2e76b49d9ef` and `bef4f729-c05e-403d-afa0-04ca70f0b0db`
- Servers stopped by exact PIDs 416282, 416267, 416088, 415959 and 415917. Ports 6772 and 9679 are free.
- The scratch worktree `/home/matt/Development/helio/.claude/worktrees/skeptic-scratch-HEL-1340` was removed by exact path.
