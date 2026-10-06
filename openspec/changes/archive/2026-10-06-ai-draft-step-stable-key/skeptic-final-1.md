## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `3e74e04c9fdda9c9c03eb4909106981ff1d18d23` (commits 2a86a6cbb + 3e74e04c9). The base was resolved live with `resolve-review-base.sh` (exit 0): `90f8a949c4ad25cf7789d90de22d20aa78e850a8`. The spawn-cwd guard returned `READY`.

### What I verified (with evidence)

**AC1 — deterministic probe.** The new `PipelineDetailPage.draftCreate.test.tsx` holds the create POST on a deferred promise (`deferredCreate`), which is correct because the draft path issues no post-create GET. I ran this file against the **base** production code: `git archive 90f8a949c frontend`, plus only the new test file, with node_modules symlinked, in my scratchpad. Result: `Tests: 7 failed, 1 passed, 8 total`. The one that passed is the negative guard "does not issue a flush PATCH when nothing was edited in flight". Each of the seven failures is a real red for the behaviour it names.

**AC2 — a general fix for the draft path, with a safety argument.**
- `renderKey` is set only in the draft swap (`usePipelineDetailPage.ts`, `.then` of the draft create, `renderKey: s.renderKey ?? s.id`).
- The key carries through the three other in-place reconciles that rebuild a Step from a server response:
  - `syncStepsFromServer`: a map built from `stepsRef.current`, matched by real id.
  - `handleReorderSteps` (L1291).
  - `handleToggleStepEnabled` (L1375).
- I grepped every `pipelineStepToStep`/`setSteps(` site. The others are:
  - L307: the initial load, so a fresh pipeline.
  - L1038: a shape-apply append of new steps.
  - The rest are filters or spreads (`{...s, ...}`), which keep `renderKey`.
- None of those drop a live renderKey.
- Render sites (grep of `key=`): step Fragments and tail-chain steps use `stepRenderKey`, and child lanes use `laneRenderKey`. These are at `PipelineRiverView.tsx:354,425` and `LaneColumn.tsx:152,203,249`. `root.id` and the gap keys are unchanged, which is correct: a root lane's key is not a step id.
- Identity is unchanged: `lane.id`, `laneOfStepId` and every callback still use `step.id`.
- **Stale ids in the preserved subtree.**
  - In `useStepCardState.ts`, `persist`/`emitOrPersist` read `step.id` from the render closure, and `persist` returns before scheduling any timer for a temp id. So no debounce closure can capture the temp id.
  - `prevConfig` (L151) is derived state. The swap keeps `config: s.config` by reference, so it does not reset.
  - Live, a post-swap state was read back from the DB (see below). The RTL test "an edit after the swap PATCHes the persisted id" asserts `updatePipelineStep("ai-1", …)` and exactly one create.
- **Not on the wire.**
  - `createPipelineStep` and `updatePipelineStep` take scalar arguments. `reorderPipelineSteps` sends ids only.
  - No non-UI module serializes a `Step`. The only importers of `Step` are the state, utils and hook files, and none of them call the service.
  - Live request bodies (below) contain no `renderKey`.

**Mutation checks.** These were run on a HEAD copy in my scratchpad; the worktree was not touched. Each fix component is guarded by its own red test:
- M1, removing the resync carry: 1 failed, "a later full resync keeps the created draft's card open".
- M2, removing the D2b provisional position: 1 failed, "keeps a lane-add draft on a childless anchor expanded and as its own lane head".
- M3, removing the enable-toggle carry: 1 failed, "an enable toggle on a created draft keeps its card open".

**AC3 — the RTL test is red without the fix.** Proven above: 7 red on base, 8/8 green on HEAD.

**AC4 — HEL-1294 behaviour is unchanged.**
- `git diff --stat 90f8a949c...HEAD -- …/PipelineDetailPage.creatingStep.test.tsx` is empty, so the file is unmodified.
- `handleAddLaneStep` changes only the `requiresCompleteConfigForCreate` branch. The non-AI branch still uses the plain `makeStep` result (constraint C1).
- Create-immediately steps never carry a renderKey: their temp id is never in the post-resync list, so nothing is carried over.
- The one edit to an existing test, `PipelineDetailPage.test.tsx` L694-700, removes a re-expand click. That click was there only to work around the old AI-draft collapse, which is exactly the behaviour this ticket fixes. It is not a HEL-1294 test.

**Gates, run by me.**
- `jest src/features/pipelines` (2 workers, nice 19): `Test Suites: 80 passed; Tests: 1063 passed`. This includes creatingStep and draftCreate.
- `tsc --noEmit`: exit 0.
- `eslint --max-warnings=0 src/features/pipelines`: exit 0.
- `prettier --check` on the changed frontend files: clean.

**Live run** (servers on 6753/9660, `assert-phase.sh servers` returned PASS).
- Setup: standalone headless Chromium. I logged in, went to `about:blank`, then navigated to the evaluator's probe pipeline `c286faa5-…`. The draft create POST was delayed 2.5 s by route interception.
- Steps: I added a lane-add AI draft on the childless leaf `e5489963`, opened it, completed its config, and then edited the instruction while the POST was held.
- Network:
  - The POST body had `instruction: "Summarize"` and `attachAsTail: true`, and no `renderKey` or `position`.
  - The server returned id `0f15d733-…` with position 1.
  - Then `PATCH /api/pipeline-steps/0f15d733-…` was sent with `"Summarize (skeptic in-flight edit)"`.
- The card stayed `aria-expanded=true` after the create, and the editor still showed the edited value.
- An API read-back of the steps shows the row's config is `instruction: "Summarize (skeptic in-flight edit)"`, so the persisted step matches the editor.
- My lane-element identity check was vacuous: the selector matched nothing, so null === null. I do not rely on it. Lane stability rests on the RTL lane test, which compares DOM node identity and is red under M2, and on the screenshots below.

**UI judgment** (DESIGN.md). The diff has no CSS, token or markup changes. Only React keys and state reconciles changed. Screenshots:
- `light-2-in-flight.png` (ref `/home/matt/Development/helio/.concertino/runs/HEL-1321/evidence/.skeptic-evidence/light-2-in-flight.png`): the draft is rendered as the head of its own child lane under its anchor, with a dashed lane rail, before the create resolves.
- `light-3-after-create.png` (ref `…/light-3-after-create.png`): same lane, same position, still expanded, "Draft" badge gone, output chip `skeptic_summary` shown.
- `dark-created-lane.png` (ref `…/dark-created-lane.png`): parity holds in dark mode; nothing in this diff affects theming.
- `light-1-draft-added.png` (ref `…/light-1-draft-added.png`).
- Console errors: two 401s from the pre-login session probe and one 404 from the pipeline schedule GET ("No schedule set"). All are pre-existing and none are related to this change.

**Gate-chain note.** None of the reports I read rely on mtime-ordering claims, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- During the in-flight window, the draft's INPUT FIELD select shows "— select a string field —" even though the POSTed config has `inputField: "a"` (`light-2-in-flight.png`). After the create it shows `a`. This comes from the draft having no analyzed input schema yet, which is pre-existing behaviour not touched by this diff. It could be a small follow-up.
- `handleReorderSteps` carries `renderKey` with no dedicated test. The evaluator documented that a reorder test is confounded by a pre-existing trunk-head collapse. The carry is one line, symmetric with the tested enable-toggle carry, and safe.
- Dev-DB rows I created, all under `matt@helio.dev` on pipeline `c286faa5-8ecb-4b36-8526-d01d1dad3dd4`: step `0f15d733-4b05-4ea7-8fc8-ce79dff5eb94` (generatetext, child of `e5489963-4d12-4b5e-967c-2d39745c6dcc`), plus login sessions. Nothing was deleted.
