## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d3f8e6183da7d4c8d4f286e43b43f458ba1c623c`. The base was resolved live as `b16bfa1b3a74905eefc0208a01793efa047909c5` (origin/main merge-base).
Commits on the branch: `4f543009b` (item 1 test), `b92f6d54e` (item 2 refactor), `d3f8e6183` (item 3 fix).
Persisted evidence lives under `/home/matt/Development/helio/.concertino/runs/HEL-1340/evidence/eval-evidence/` (written below as `EV/`).

### Phase 1: Spec Review — FAIL

- AC1: PASS. I reproduced the mutation in a throwaway detached worktree at d3f8e6183. Replacing `{ ...pipelineStepToStep(persisted), renderKey: s.renderKey }` with `pipelineStepToStep(persisted)` in `handleReorderSteps` (usePipelineDetailPage.ts:1092) makes exactly `a non-head reorder keeps a created draft's card open` fail (`aria-expanded="false"`); the other 11 pass (`EV/hel1340-eval-mut1.log`). Restoring the line makes it green. The post-create steps-GET fixture follows probe.md (ai-1 head-spliced), as D2 requires.
- AC2: PASS. See Phase 2 for the hunk-by-hunk check. The page hook goes from 1598 to 1399 lines. Commit b92f6d54e touches no test file.
- AC3: the select itself is PASS. With only the item-3 production change reverted (both hook files back at b92f6d54e, tests kept), all three new tests fail with `Expected: notes / Received: — select a string field —` (`EV/hel1340-eval-mut2.log`). I also saw it live: the select shows `notes` while the create is held in flight, and again after the swap with the step's own `/analyze` held (`EV/lane-hel1340-2-in-flight.png`, `EV/lane-hel1340-3-post-swap-analyze-held.png`).
- **Two D4 test-plan items are not met (spec-divergence):**
  - (a) **The lane variant does not hold the exact anchor.** I applied a mutation that drops the fallback meta from the schema resolver but keeps `hasDraftFallbackMeta`: `pendingDraftMetaRef.current.get(stepId) ?? draftFallbackMetaRef.current.get(stepId)` became `pendingDraftMetaRef.current.get(stepId)` (usePipelineDetailPage.ts:555). All 12 tests still pass (`EV/hel1340-eval-mut3.log`). In that test the draft sits next to its anchor in the array, so the trunk array walk also lands on `anchor-1` and returns `notes`. The test tells "anchor" apart from "root source", but not from "trunk neighbour", which is the distinction D4 asks for ("shows the anchor's field, not a trunk neighbour's"). D4(b), "never degrades to the array walk", therefore has no test behind it.
  - (b) **In scenario 2 the assertion runs before the post-swap `/analyze` is even dispatched.** I instrumented a copy of the test. When it asserts, `analyzePipelineMock` has been called 1 time, the same as before the resolve. The held post-swap call arrives only afterwards, on the 300 ms debounce (`EVALPROBE before= 1 atAssert= 1 after= 2`, `EV/hel1340-eval-probe-held.log`). So the hold is real but does no work at the moment of the assertion. D4 says "holds the post-swap analyzePipeline unresolved while asserting". The test passes because of timing, not because of the hold. The fix does in fact hold through the in-flight analyze: my instrumented copy asserted after the call and stayed green.
- C1 (item 5 untouched): honoured. HEL-1294's `markCreating`/`isCreating` moved verbatim.
- C2: honoured (see Phase 2).
- C3: honoured. probe-evidence.md records the root-cause probe and red→green for both items, and I reproduced both.
- C4: honoured. Three commits in D1 order.
- C5: honoured. No changes to ci.yml, playwright.config.ts or .gitignore.
- C6: honoured. No resync added and no backend file changed.
- No scope creep. The spec delta and tasks.md match what was implemented.
- `.npm-cache-hel1340/` is untracked: `git ls-files` has no hits and no commit touches it. Left in place as instructed.

### Phase 2: Code Review — FAIL

**Gates (my own run, in WORKTREE_PATH at d3f8e6183, nice -n 19, Jest `--maxWorkers=2`):**

| Gate | Result |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| root Jest | 38 suites / 371 tests pass |
| frontend Jest | 439 suites / 4585 tests pass |
| `npm --prefix frontend run build` | 0 (only the usual chunk-size warning) |

**Item 2 (b92f6d54e) is behaviour-preserving: PASS.**
- I compared the moved code with the original after stripping indentation.
  - Block :172-193 → new hook :52-73: identical.
  - `handleInsertStep` / `handleAddStep` / `handleAddLaneStep` (orig :747-905 → new :84-262): identical apart from the deps arrays.
  - The draft-create half of `handleStepConfigChange` (orig :1089-1153 → `createDraftIfComplete` :266-328): identical. Statement order is kept: `setSteps`, then the error clear (same updater, now `clearDraftCreateError`), then the meta/guard/create sequence.
- **Callback identity:** each deps array gains only `stepsRef` (useRef :159), `setSteps` / `setStepsInitialized` (useState setters :150/:179) and `pendingDraftMetaRef` (useRef :167). All are identity-stable. `handleStepConfigChange` deps go from `[id]` to `[clearDraftCreateError ([]), createDraftIfComplete ([id, stable...])]`, which changes exactly when `id` changes, as before.
- **Effects:** `git show b92f6d54e | grep useEffect` has no hits. The page hook declares 8 `useEffect(`, in the same order, before and after. The relocated declarations are only useRef/useState/useCallback, and their only readers were inside the moved handlers and the return object.
- No test file is in the commit. The HEL-1294 (`creatingStep`) and HEL-1321 (`draftCreate`) suites pass unmodified at b92f6d54e: 3 consecutive runs of those two plus `PipelineDetailPage.test.tsx` all gave 143/143. A full `src/features/pipelines/` run gave 1064/1064.
- One earlier cold-cache full-directory run at b92f6d54e had one failure: `PipelineDetailPage.test.tsx › insert-at-position (HEL-410)`, `Unable to find role="option" name /Cast type/`, with the suite taking 32.6 s. That failure is in the picker, before any moved handler runs. It did not reproduce in the 4 runs that followed, and the HEAD gate run was green. I treat it as a load flake, not a regression.

**Item 3 (d3f8e6183): root cause confirmed, but the fix causes a regression.**
- Root cause: `pendingDraftMetaRef` is deleted when the create is sent, so `getAnalyzeSchema` returns `EMPTY_ANALYZE_SCHEMA`. This is probe-confirmed in probe-evidence.md and I reproduced the red run.
- Minimal and correct, apart from the regression below:
  - The separate `draftFallbackMetaRef` leaves the exactly-once guard and `stepsFingerprint` untouched, as D4 requires.
  - The re-key happens before `setSteps` in `.then`. Removing it fails 2 tests (scratch log `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1340-eval-mut4.log`, not persisted).
  - Failure deletes the fallback entry and restores the pending meta.
  - Adding `draftFallbackMetaRef` as an input matches D4(a).
  - The new cleanup `useEffect` (usePipelineDetailPage.ts:569-575) only mutates a ref and sets no state, so its position cannot reorder state updates. It is optional under D4(c) ("may be deleted lazily") but harmless and bounded. I accept it.
- **Regression (live-observed and RTL-confirmed):**
  - StepCard hides `StepSchemaDiffChips` only for temp-id drafts (StepCard.tsx:366-376). The reason is HEL-1109 evaluation-1 CR1: comparing a fallback input schema against an empty output schema "falsely report[s] every field as dropped".
  - The new fallback now covers the persisted id after the swap. `isDraft` is false there, `getAnalyzeSchema` returns the fallback input, and `getAnalyzeOutputSchema` returns `[]`. So the card shows red `− notes` `− id` "dropped" chips until the step's own analyze lands.
  - At b92f6d54e the same window shows no chips (`EV/hel1340-eval-chips-b92f6d54e.log`: `removed chips = []`). At d3f8e6183 it shows them (`EV/hel1340-eval-chips-d3f8e6183.log`: `["− notes"]`). Live screenshot: `EV/lane-hel1340-3-post-swap-analyze-held.png`.
  - In the happy path the chips go once analyze lands (`EV/lane-hel1340-bp-1440.png` then shows `+ summary`). If the post-swap analyze is slow or fails, they stay.
  - This brings back exactly the false-diff defect the CR1 guard exists to prevent.
- Other checklist items:
  - CONTRIBUTING [mechanical]: no inline FQNs, imports are at the top of the file, no `any`.
  - The new hook is 347 lines, over the ~250-line soft budget (informational only).
  - The `draftFallbackMetaRef` element type repeats the inline `{ index?; parentStepId?; attachAsTail?; rootId? }` literal instead of the exported `PendingDraftMeta` (DRY nit, see suggestions).
  - DESIGN.md: no styling or markup changes, so N/A.
  - No dead code and no TODO/FIXME left.

### Phase 3: UI Review — FAIL

Servers were started with `start-servers.sh` on 6772/9679 and `assert-phase.sh servers` returned PASS. I used my own headless Playwright run (1 worker, nice 19) with `isolateLivePage` and dedicated `@example.test` users. I never used matt@helio.dev.

- Happy path (lane draft): the select shows `notes` before the create, while the create is held, after the swap with `/analyze` held (held count 1), and once settled (`EV/hel1340-eval-e2e-lane.log`). Trunk append in flight: `notes` (`EV/hel1340-eval-e2e4.log`).
- **Fail:** after the swap, the false "every field dropped" diff chips appear (`EV/lane-hel1340-3-post-swap-analyze-held.png`). This is CR1 below.
- Unhappy path: a forced 500 on create shows the inline error, and the select still shows `notes` (`EV/lane-hel1340-4-create-failed.png`). No blank screen.
- Console: there were no `pageerror` exceptions. The `Failed to load resource` lines were 401 (before login), 404 (no-schedule GET, expected), and the 500 I forced.
- Breakpoints 1440 / 1100 / 768 / 375: horizontal overflow is 0 at every width, and nothing breaks (`EV/lane-hel1340-bp-*.png`).
- Keyboard: the input-field combobox has an accessible name and takes focus.
- **Pre-existing issue, not caused by this branch, out of scope under C6:**
  - A trunk **append** of an AI draft to a pipeline that already has steps makes the created step **vanish from the editor** after the swap, until the page is reloaded.
  - The server head-splices it to `position 0` and reparents the existing rename under it (`EV/hel1340-eval-e2e4.log`, server listing). The local swap then gives two same-root steps at position 0.
  - The same RTL probe at base `b16bfa1b3` and at `d3f8e6183` gives `ai cards after swap = 0` in both (`EV/hel1340-eval-vanish2-*.log`). Live: `EV/hel1340-3a-post-swap-debug.png`, `EV/hel1340-3b-after-reload.png`.
  - This belongs to HEL-1345 (the backend `rootId` head-splice plus item 4). It should be noted there explicitly, because the symptom is worse than "siblings stay stale": the new step itself disappears.

Shared dev DB rows I created, all deleted by exact id (verified afterwards with count = 0):
- users `23cf4601-0e56-4453-a533-c5b4f19efb1f`, `c3bf6b63-32d7-4003-bf0f-d9eddf2e7fb7`, `60082097-fcea-4f60-8e7b-6eaad1a991ef`, `6dc5b6a1-4905-4158-a5c4-87fe74781016`, `4d3eb41b-c690-4dee-a134-ed5540d5a83b`
- pipelines `1f05df46-0f5b-422a-8217-aa3ec8e9d6f2`, `417b0870-5cd1-4ad1-ba09-061bddd2584b`, `4ef87383-a18c-4f64-bdb6-c96e2c5a8685`, `5cc2cb63-1518-4172-bc59-b8e8485e1a90`, `b77e74d7-03f6-4b3b-8d3d-83600acd0c05`, plus their steps (including `f66c2d14-9c75-417c-8fab-855089495ff3` and `1c98b130-e5b3-4a47-9520-715710245269`)
- data sources `5cc43b77-5cc9-4048-9ee6-ed22c39800a3`, `9e9db9fe-81b4-4c3f-97df-0fbadcd3592a`, `3de33ec2-0679-4449-862f-3c2aa42abae0`, `56b8bf83-1374-4160-9ec9-98dd738d591f`, `a3ae24a1-74e6-4768-a2bb-ea81b126429b`

Servers were stopped by exact PIDs 342197, 342182, 341809, 340871, 340821, and the ports are free. The throwaway worktree `/home/matt/Development/helio/.claude/worktrees/eval-scratch-HEL-1340-c1` was removed by exact path. `git worktree list` has no straggler.

### Overall: FAIL

### Change Requests

1. **Stop the item-3 fallback from producing false "dropped" diff chips on the persisted step after the swap** (usePipelineDetailPage.ts:577-596 together with StepCard.tsx:366-381).
   - The CR1 guard assumes "fallback schema ⇒ temp-id draft". Since d3f8e6183 that assumption is false.
   - Make the diff suppression follow "this step has no analyze entry of its own", not `isDraft`. For example, expose a `hasOwnAnalyzeEntry(stepId)` (that is, `analyzeByStepId.has(stepId)`) from the page hook, thread it to StepCard, and render `StepSchemaDiffChips` only when it is true. Or have the page hook hand StepCard a flag meaning "the schema is a fallback".
   - Do not mirror the fallback into the output side; CR1 rejected that.
   - Add a red-first RTL assertion to scenario 2: after the swap, with the post-swap analyze held, no `.pipeline-detail-page__step-card-diff-chip--removed` chip is rendered. It must be red at d3f8e6183 (my probe: `["− notes"]`) and green after the fix.
2. **Make the lane variant actually pin the exact-anchor resolution (D4(b))** (PipelineDetailPage.draftCreate.test.tsx, `a lane draft in flight resolves its field from its anchor…`).
   - Build a case where the anchor has no analyze entry but an earlier trunk step does. Example: steps `[p-0 (rename, pos 0), anchor-1 (rename, pos 1)]`. Analyze returns an entry for `p-0` only, with output `notes`. The root source exposes only `other`. Add the lane on `anchor-1` and choose `other`.
   - The exact-anchor path then resolves to the root source and keeps showing `other`. The array walk would hit `p-0` and show the placeholder.
   - Required proof: green at the fix, and red under the mutation `pendingDraftMetaRef.current.get(stepId) ?? draftFallbackMetaRef.current.get(stepId)` → `pendingDraftMetaRef.current.get(stepId)` (usePipelineDetailPage.ts:555). Record that red run in probe-evidence.md.
3. **Make scenario 2 assert while the post-swap `/analyze` is actually in flight** (`keeps the chosen input field shown after the create, before its own analyze lands`).
   - Record `analyzePipelineMock.mock.calls.length` before `create.resolve`. After the draft notice disappears, `await waitFor(() => expect(analyzePipelineMock.mock.calls.length).toBeGreaterThan(before))`, then assert the select (and the CR1 chip check).
   - As written, the assertion runs before the debounced call is issued (`before=1 atAssert=1 after=2`).

### Non-blocking Suggestions

- Type `draftFallbackMetaRef` (and `pendingDraftMetaRef`) with the exported `PendingDraftMeta` from usePipelineStepCreation.ts instead of repeating the inline object type (usePipelineDetailPage.ts:166-184).
- Add the pre-existing "AI step vanishes after a trunk append until reload" symptom (evidence above) to HEL-1345's scope. That fix is what makes the D2 reorder fixture's head-splice placement go away.
- The new cleanup effect could, in principle, see a stale committed `steps` (without the persisted id yet) if a passive-effect flush lands between the `.then` re-key and the swap commit. The worst case is the pre-fix placeholder until analyze lands, so it fails safe. Lazy deletion with no effect (D4(c)) would remove that edge case entirely, if you prefer it.
- usePipelineStepCreation.ts is 347 lines, over the ~250-line soft budget. Mention it in the PR description per CONTRIBUTING.
