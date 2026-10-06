## Context

All four items live in `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` (1598 lines at b16bfa1b3).
Draft state: `pendingDraftMetaRef` (:166), `creatingDraftIdsRef` (:175), `draftCreateErrors` (:179); HEL-1294's
`creatingStepIds`/`markCreating` (:184). Create paths: `handleInsertStep` (:759), `handleAddStep` (:816),
`handleAddLaneStep` (:831), and the deferred draft create inside `handleStepConfigChange` (:1081-1159). Draft schema
fallback: `getDraftFallbackSchema` (:557) used by `getAnalyzeColumns`/`getAnalyzeSchema` only while
`pendingDraftMetaRef` holds the id (:573, :585). `syncStepsFromServer` (:731) carries `renderKey` by real id.
Existing suites: `PipelineDetailPage.draftCreate.test.tsx` (HEL-1321), `PipelineDetailPage.creatingStep.test.tsx`
(HEL-1294), `PipelineDetailPage.test.tsx`, `PipelineDetailPage.reorderGuard.test.tsx`.

## Goals / Non-Goals

**Goals:** pin the reorder carry; move create/draft logic into its own hook with zero behaviour change; fix item 3.

**Non-Goals:** item 5 (HEL-1294 stable-key migration, needs owner ruling); item 4 and the backend placement defect
(moved to HEL-1345, see D5); further splits of the page hook; backend.

## Decisions

**D1 — Commit order (three commits, in this order).**
1. Item 1 test only (against unmodified production code).
2. Item 2 refactor only: production code moves, no test file touched, no behaviour change.
3. Item 3: red test + fix.
Pre-commit runs Jest, so a red test cannot be committed alone. Red-first evidence for items 1 and 3 is recorded in
`probe-evidence.md` in the change dir (command, failing assertion, then the green run), not as a red commit. Doing the
refactor before the fixes means the fixes land in the new hook and the refactor diff is reviewable on its own.

**D2 — Item 1 test.** Port HEL-1321 evaluation-2.md's probe into `PipelineDetailPage.draftCreate.test.tsx` (a new `it`,
plus `reorderPipelineSteps` added to that file's existing `jest.mock` factory; that is the item-1 change, made in commit
1). Drop the probe's `console.log`s; use `within`. Mutation proof: remove `renderKey: s.renderKey` at :1290 → the new
test is red; restore → green. (skeptic-design-1 CR2) The steps-GET mock is server-realistic from the start:
`mockResolvedValueOnce(<initial list>)`, then `mockResolvedValue(<post-create list>)` where the post-create list includes
`ai-1` and its placement is taken from the HEL-1345 probe's real output (`probe.md`), never hand-invented. Today's
server head-splices the created step (probe.md case 1), so the post-create list puts `ai-1` at the head of the trunk.
Any later resync, including the one HEL-1345 will add, therefore cannot make `ai-1` vanish from this test. HEL-1345's
backend fix will change that placement, and that lane updates this fixture with a stated reason.

**D3 — Item 2 hook boundary.** New `frontend/src/features/pipelines/hooks/usePipelineStepCreation.ts` owns
`creatingDraftIdsRef`, `draftCreateErrors`, `creatingStepIds`/`markCreating`, `handleInsertStep`, `handleAddStep`,
`handleAddLaneStep`, and the draft-create half of `handleStepConfigChange`. (skeptic-design-1 CR5, option b)
`pendingDraftMetaRef` stays CREATED in the page hook at its current line, because `stepsFingerprint` (:361-362) reads it
during render and feeds the effects at :392-474; the page hook passes the ref object in. The new hook is CALLED at the
point where the moved handlers used to start (just after `syncStepsFromServer`, :731), where `roots` and
`syncStepsFromServer` already exist. Inputs: `id`, `roots`, `stepsRef`, `setSteps`, `setStepsInitialized`,
`syncStepsFromServer`, `pushToast`, `pendingDraftMetaRef`. Returns: the handlers, `draftCreateErrors`, `creatingStepIds`,
and `createDraftIfComplete(stepId, config)` plus `clearDraftCreateError(stepId)`, which `handleStepConfigChange` (still
in the page hook, same return key) calls in the same statement order as today. Constraints:
- The page hook's returned object keeps every existing key; callbacks that were identity-stable stay identity-stable
  (`StepCard`'s `React.memo` relies on it).
- Statement order inside each moved handler is unchanged (state-update ordering is behaviour here).
- No `useEffect` changes its relative declaration order, and the new hook declares no effect. The moved
  `useRef`/`useState`/`useCallback` declarations (`creatingDraftIdsRef` :175, `draftCreateErrors` :179,
  `creatingStepIds`/`markCreating` :184-195) relocate to the call site after :731. This is safe because nothing between
  :175 and :731 reads them (skeptic-design-2 grep: their only readers are :781-905, :1089-1151, :1561 and :1590), and
  moving non-effect hook declarations does not change effect order.
- Refs stay refs, and render-time readers keep reading the same ref object.
- `syncStepsFromServer` stays in the page hook (remove/duplicate/root paths use it) and is passed in.
About 270-300 lines move. Stop condition: if the boundary needs more inputs than these, or any existing test needs
editing to pass, stop and report to the orchestrator. That triggers the escalation to split item 2 into its own ticket.

**D4 — Item 3 (executor must confirm the root cause by probe before fixing).** Hypothesis, confirmed by code reading at
design round 1: `handleStepConfigChange` deletes the draft's `pendingDraftMetaRef` entry when it sends the create
(:1103), so from then on the step has neither an analyze entry nor draft meta and `getAnalyzeSchema` returns
`EMPTY_ANALYZE_SCHEMA`. (skeptic-design-1 CR4) Fallback lifetime: the draft's anchor meta stays available to the schema
fallback from the moment the create is sent until an analyze entry exists for the step's CURRENT id. That means through
the in-flight window, across the swap (re-keyed from the temp id to the persisted id), and through the post-swap
debounced analyze. It is dropped once `analyzeByStepId` has the persisted id, or on create failure (where the meta is
restored to `pendingDraftMetaRef` as today). Mechanism: a separate fallback-meta map, consulted by
`getAnalyzeColumns`/`getAnalyzeSchema` after `analyzeByStepId` and after `pendingDraftMetaRef`. It is NOT
`pendingDraftMetaRef` itself, so the create-exactly-once guard and the `stepsFingerprint` filter are unchanged.
(skeptic-design-2 CR2)
- (a) The map is a page-hook ref created next to `pendingDraftMetaRef` (:166), because its readers (:557-588) are
  declared before the new hook's call site. It is passed into `usePipelineStepCreation` as an added input in commit 3.
  D3's input list governs commit 2 only.
- (b) `getDraftFallbackSchema` takes its `meta` from `pendingDraftMetaRef.current.get(stepId) ??
  <fallback map>.get(stepId)`, so an in-flight or post-swap LANE draft keeps exact-anchor resolution via
  `meta.parentStepId` and never degrades to the array walk.
- (c) Lifecycle. When the create is sent, the meta is written to the fallback map under the temp id. In the same `.then`,
  before `setSteps`, the swap re-keys it from the temp id to the persisted id. A failed create deletes it, and the meta is
  restored to `pendingDraftMetaRef` as today. Reads go to `analyzeByStepId` first, so the fallback stops applying once an
  analyze entry exists for the persisted id; the stale entry is then harmless and may be deleted lazily.
- Test plan adds a lane-draft variant: a lane draft created in flight shows the anchor's field, not a trunk neighbour's. Tests:
scenario 1 holds the create unresolved. Scenario 2 resolves the create but holds the post-swap `analyzePipeline`
unresolved while asserting, so the immediate-resolve mock cannot mask the window. Side observation to record, not to
fix: the in-flight temp id enters `stepsFingerprint`. Any change to what reaches `/analyze` is out of scope.

**D5 — Item 4 moved to HEL-1345 (owner ruling, 2026-10-06).** A route-test probe (`probe.md`) confirmed that a trunk
create carrying `rootId` ignores `position` and head-splices, for inserts and appends alike. Only the no-`rootId` arm
honours `position`. Item 4's frontend reconcile would faithfully show that wrong placement, so the owner moved AC4 and
item 4 to HEL-1345 together with the backend fix. skeptic-design-1 CR1 and CR3 (the reconcile hazards) travel with it:
the merge-preserving-local-steps rule and the explicit `renderKey` carry are handed to HEL-1345, not built here. This
ticket adds no resync and changes no create path's server interaction.

## Risks / Trade-offs

- [Refactor silently changes callback identity or effect order] → no test edits allowed in commit 2; evaluator diffs the
  moved code against the original hunk by hunk.
- [`handleInsertStep`'s existing create-immediately resync also drops local-only steps] → pre-existing and not changed
  here; handed to HEL-1345 (Linear comment 5a98b381, 2026-10-06) together with the item-4 reconcile hazards.
- [Shared dev DB residue from UI checks] → record exact ids; never under `matt@helio.dev`.

## Planner Notes

- Self-approved: hook name and file location (`hooks/`, alongside `usePipelineDetailPage.ts`).
- Item 4 scope: escalated twice on 2026-10-06. The probe confirmed the backend defect, and the owner ruled H2 (moved to HEL-1345).
- Item 2 assessed as moderate, not large: one cohesive concern, about 7 inputs, covered by four existing suites. Not
  escalated; D3 states the stop condition.
