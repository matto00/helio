## Context

See proposal.md (Why). Relevant code on main (90f8a949c):

- `usePipelineDetailPage.ts` `handleStepConfigChange` (~L1056-1105): once a draft's config is complete it POSTs
  `createPipelineStep(...)`, then swaps in place: `s.id === stepId ? { ...pipelineStepToStep(persisted), config:
  s.config } : s`. No `syncStepsFromServer` follows. `creatingDraftIdsRef` blocks a second create.
- `syncStepsFromServer` (~L730) replaces the whole list with `freshSteps.map(pipelineStepToStep)`.
- Card keys: `PipelineRiverView.tsx` `<Fragment key={step.id}>` (~L354), `LaneColumn.tsx` (~L203, ~L249). Lane keys:
  `key={childLane.id}` (`PipelineRiverView.tsx` ~L425, `LaneColumn.tsx` ~L152), `key={root.id}` (~L502). A lane's id is
  its head step's id (`stepTree.ts` `lanes.push({ id: startStep.id, ... })`), so a draft that heads a lane (added via
  `handleAddLaneStep`) also re-keys its whole lane on the swap.
- `StepCard.tsx` L180 `const [expanded, setExpanded] = useState(false)`; HEL-1294's `isCreating` disables the toggle.
- `useStepCardState.ts` L282 skips the debounced PATCH when `isTempStepId(step.id)`.

## Goals / Non-Goals

Goals: the draft card survives its own create unremounted; an in-flight edit reaches the server; HEL-1294 untouched.
Non-goals: see proposal.md Non-goals.

## Decisions

**D1 — Probe first, deterministically, in RTL.** The draft path has no post-create GET, so the HEL-1294 technique
("delay the steps GET") is replaced by holding the create POST on a manually-resolved deferred promise. Render the page
with an AI draft, open it, complete its config (create fires), then resolve the POST and assert the card is still
expanded. Second probe: edit the config while the POST is held, resolve, advance the debounce, and assert a PATCH with
the edited config was (not) sent. Both probes must be recorded red on unmodified main before any fix (paste output into
the change's evidence). If the PATCH probe is green on main, drop D3 and its spec scenario rather than "fixing" it.
Use the existing harness in `PipelineDetailPage.creatingStep.test.tsx` as the model.

**D2 — Stable render key, scoped to the draft path.** Add an optional client-only `renderKey?: string` to `Step`. The
draft swap sets `renderKey: s.renderKey ?? s.id` (the temp id). Render sites key by `step.renderKey ?? step.id`; lane
render keys use the lane head step's `renderKey ?? lane.id`. Lane/step *identity* (`lane.id`, `laneOfStepId`, every
lookup, every prop/callback id) stays the real `step.id` — only the React `key` changes. `syncStepsFromServer` carries
`renderKey` forward from the previous list for any fresh step whose id matches a previous step that had one.

Why it is safe:
- Uniqueness: temp ids come from a monotonic module counter (`makeStep`, `step-N`) and server ids are UUIDs; `isTempStepId`
  already relies on these never colliding. A renderKey is the temp id of exactly one step, so siblings never share a key.
- Only the draft path sets it (plus D2b's provisional position, also draft-only), so create-immediately paths render with `key = step.id` exactly as today — their temp step
  is replaced by a resync step whose id was never in the previous list, so nothing is carried. HEL-1294 behaviour is
  byte-identical, and its existing test file must pass unmodified.
- `renderKey` is never sent to the server: verify no code path serializes a whole `Step` onto the wire (grep every
  `createPipelineStep`/`updatePipelineStep`/patch-set/export use of a Step); if one does, strip it there.
- Preserving the mount means the `StepCard` subtree now sees `step.id` change from temp to real **without remounting**.
  The executor MUST audit every hook in that subtree (`StepCard`, `useStepCardState`, config editors) for a step id
  captured once at mount (`useState(step.id)`, `useRef(step.id)`, effects with stale deps, localStorage keys, debounce
  closures) and confirm each reads the current id; record the audit result in the change. A stale temp id there would
  silently turn every later PATCH into a skipped temp-id PATCH — the exact bug in another form. The RTL test must assert
  that an edit made after the swap PATCHes the persisted id.

Alternatives: (a) in-flight tracking + disabled toggle, as HEL-1294 — rejected, the draft is already open when its create
fires, so it cannot prevent the collapse. (b) Lifting `expanded` into page state keyed by id — rejected, it must remap ids
anyway and loses non-lifted subtree state (open preview, field picker). (c) Applying renderKey to all temp-id paths —
rejected for this ticket by the "no change to HEL-1294 behaviour" AC; recorded as a possible follow-up.

**D2b — A lane-add draft renders where it will land (skeptic-design-1 Defect A).** `makeStep(opType, parentStepId)`
leaves `position` undefined, and `buildLaneGraph` (`stepTree.ts:174-176`) treats a sole position-less child as its
anchor's continuation, so a lane-add draft on a childless anchor (any leaf, including trunk-last) renders inside the
anchor's lane. The server's `attachTailInternalAction` (`PipelineStepRepository.scala:807-808`) always assigns a
position >= 1, so after the swap it heads a new child `LaneColumn`: a different parent element, so React remounts it
whatever its key. Fix: in `handleAddLaneStep`'s `requiresCompleteConfigForCreate` branch only, set a provisional
`position` on the temp draft = (max `position` among the anchor's current children, treating undefined as 0) + 1, which
is never 0. `buildLaneGraph` then makes the draft the head of its own lane from the first render, with lane id = temp id,
which D2's lane render key preserves across the swap. `makeStep` and the create-immediately branch are untouched
(HEL-1294 byte-identical). The provisional position is never sent (the draft create passes `attachAsTail`, not a
position); after the swap the server's position replaces it. If it differs, sibling lanes may reorder, which keyed
siblings handle without remounting.

**D3 — Flush an in-flight edit after the create (only if D1's PATCH probe is red).** In the create's `.then`, before
calling `setSteps`, look up the draft in `stepsRef.current` by the **temp `stepId`** (the ref is assigned during render,
so inside `.then` it still holds the pre-swap list; a lookup by `persisted.id` would silently find nothing). Compare its
`config` to the config object that was POSTed by **reference**: every edit replaces `config` with a new object
(`handleStepConfigChange` L1057), so reference inequality means an edit happened. If they differ, after the swap call
`updatePipelineStep(persisted.id, latestConfig)` once, from the `.then` itself, never inside a `setSteps` updater (no
side effects in updaters). On a rejected flush, set `draftCreateErrors[persisted.id]` to the extracted message; it renders
via the existing `InlineError` in `StepCard` (L391) for any step, and is cleared by the next edit of that step (the
existing clear in `handleStepConfigChange`, which now runs with the real id). An edit made after the swap goes through
the normal debounced PATCH.

## Risks / Trade-offs

- [Stale temp id inside a preserved StepCard subtree] → D2's mandatory audit + post-swap PATCH assertion in the test.
- [A local in-flight temp step from the totality fallback in `buildLaneGraph` keyed by renderKey] → only drafts that
  have been created carry renderKey; un-created drafts still key by their (temp) id as today.
- [renderKey leaks across pipelines] → it lives only in page-local `steps` state, rebuilt on pipeline change.

- [D3 flush PATCH and a later debounced card PATCH land out of order] → both are independent requests. The flush fires
  immediately and the card PATCH about 400ms later, so the window is small. Accepted; the latest edit normally wins.
- [Provisional lane position differs from the server's] → only lane order among siblings can shift on the swap; keys are
  stable, so nothing remounts.

## Planner Notes

- Self-approved: scope limited to the draft path (AC allows "same in-flight tracking or a general fix"); no owner question.
- Self-approved: D3 is in scope — the ticket's own description names the silently dropped edit as part of the bug.
- Out of scope, note only: the draft create's positional insert does not resync siblings (CR9-style reparent).
