## Context

See proposal.md for motivation. Current: `PipelineDetailPage.tsx` (788 lines) + `StepCard.tsx`
(640 lines) render trunk-only river, debounced `/analyze`, SSE dry/live run, a single
`PipelinePreviewModal` for rows. Binding UI lives in `features/panels/ui/editors/BindingEditor.tsx`
(551 lines) + 7 sibling files (aggregation/table/chart display fields, bound-or-literal /
metric-binding hooks, MetricPicker). Backend already exposes capabilities-at-node, per-Output
preview, Output CRUD, and both breaking wire shapes (`expand` → `{steps, outputs?}`; step DELETE
→ 200-with-body) — verified present on P1.3/P1.4 (cc4cf679/e8bb4396).

## Goals / Non-Goals

**Goals:**
- Trunk + tail rendering with an Outputs rail per trunk step, live thumbnails from the last
  dry/live run frame.
- Output side sheet reusing panel renderers (ECharts/DataGrid/metric/timeline/collection) as the
  live-preview surface, backed by capabilities-at-node.
- Single-call new-pipeline flow (existing/paste/upload/connector/text) landing on the page.
- Fold `features/panels/ui/editors/*` into the Output editor; delete what's unused.
- Fix HEL-676/878/681/629 in the rebuilt surfaces; split page/card past 400 lines (HEL-682).

**Non-Goals:**
- Dashboard-side Output picker / panel sheet (P1.6).
- Parallel lanes / branching UI beyond the tail (Phase 2, `frontend-pipelines-page` unaffected).
- Backend route changes — this ticket consumes P1.3/P1.4 routes as-is, **with one explicit,
  human-granted, scoped waiver** (see "Non-goal waiver" below).

### Non-goal waiver: minimal backend branch-attach primitive (Cycle 6→7 escalation)

Cycle 6 discovered, via a live Playwright probe against the real backend (not assumption), that
Decision 5's own stated "Add as tail" mechanism (`POST /pipelines/:id/steps` with `parentStepId`
set) does not actually create a tail branch: `PipelineService.persistNewStep` routes BOTH the
`position`-based and the explicit-`parentStepId` creation branches through
`PipelineStepRepository.spliceInsertAtInternal`, which unconditionally reparents the anchor's
EXISTING children onto the new step (a trunk-insert-deeper primitive, not branch-attach). There
was no live code path anywhere that created a genuine `position >= 1` sibling. This blocks
tail-CREATION entirely — not a frontend gap, a verified backend one — and contradicts this
non-goal as originally written.

Cycle 6 escalated (see `execution-progress.md`'s `Verdict: ESCALATION` block) rather than either
guessing at a backend fix outside this ticket's stated authority, or shipping a "+ tail" button
that silently reparented/corrupted pipeline structure on every use. **The human ruled option
(b): scope this ticket's non-goal aside and build the minimal backend change needed, as part of
this delivery**, rather than deferring to a separate backend ticket.

**Exact scope of the waiver** (deliberately narrow — this is NOT a general backend-changes
green light for the rest of this ticket):
- A new repository primitive, `PipelineStepRepository.attachTailInternal`, distinct from
  `spliceInsertAtInternal`: attaches a new step as a genuine NEW `position >= 1` sibling of the
  anchor's existing children, WITHOUT reparenting any of them. Implemented as a thin, explicitly
  named wrapper around the pre-existing sibling-scoped append idiom (`insertInternalAction`) —
  no new SQL shape, no schema change.
- `CreatePipelineStepRequest` gains one new optional field, `attachAsTail: Option[Boolean] =
  None`, read only when `parentStepId` is also present; absent/false preserves the EXACT
  pre-existing splice behavior for every other caller (default-preserving, not a breaking wire
  change).
- `PipelineService.persistNewStep`'s `parentStepId`-branch picks `attachTailInternal` vs.
  `spliceInsertAtInternal` based on that one flag.
- `spliceInsertAtInternal`'s existing trunk-insert (reparenting) behavior is preserved EXACTLY —
  it is load-bearing for every pipeline already in the DB — and is covered by an explicit
  regression-guard spec (`PipelineStepRepositorySpliceSpec`, HEL-908 section), independently
  mutation-proven alongside the new primitive's own mutation-proven spec.
- Everything else non-goal'd above (parallel lanes, dashboard-side picker, any other route/schema
  change) remains out of scope; this waiver covers exactly the one primitive needed to make
  Decision 5's tail-creation mechanism actually work.

### Non-goal waiver #2: trunk-to-trunk reorder relink (Cycle 8→9 escalation)

Cycle 8 confirmed, via a live curl probe against the real backend, that `PUT
/pipelines/:id/steps/order` is a silent no-op for trunk-to-trunk reorder post-HEL-904:
`PipelineStepRepository.reorderInternal` groups `orderedIds` by each id's EXISTING
`parentStepId` and renumbers `position` only WITHIN that group. A pure trunk has every step
under a different parent (the previous trunk step), so every group is a singleton and
renumbering within it is a no-op by construction — trunk-to-trunk reorder requires relinking
the `parentStepId` chain itself, a materially different operation `reorderInternal` was never
built to do. Cycle 8 escalated rather than guess at the undecided tail-movement semantics this
would require.

**The human ruled: the tail FOLLOWS ITS TRUNK STEP.** A tail belongs to the node it hangs off
(identified by that node's own id), not to the positional slot the node happens to occupy in
the trunk. When a trunk node moves, its entire tail subtree travels with it; the node that now
occupies its old slot does not inherit that tail. This resolves the semantics gap Cycle 8
correctly refused to guess at, and is a second, narrowly-scoped waiver of the same
"no backend route changes" non-goal, granted by the same authority as waiver #1 above — covering
exactly one new repository primitive (`reorderTrunkInternal`, see Decision 15) plus its wiring
into `PipelineService.reorderSteps`/`PUT /pipelines/:id/steps/order`. Nothing else non-goal'd
above is in scope.

Implementation consequence of "tail follows its trunk step": because a tail's own
`parentStepId` already points at its trunk node's **id** (not at a position/slot), and ids never
change across a reorder, a tail requires **zero writes** during a trunk reorder — it is already
correctly attached to the node whose id it references, wherever that node now sits. The only
rows a trunk reorder needs to touch are the trunk nodes' own `parentStepId` (repointed to the
node now preceding them) and `position` (always `0`, since a trunk node is always the
position-0/trunk-continuation child of its parent by definition).

## Decisions

1. **Tails as a recursive `TrunkStepCard` + `TailChain` pair**, not a generalized tree renderer.
   The wire has no nested `children` — `PipelineStepProtocol` exposes a flat `parentStepId:
   Option[String]` per step (verified) — so grouping is done client-side in a
   `buildStepTree(steps)` selector (lives in the pipelines slice, not a component): group the flat
   list by `parentStepId`, then walk from the root: the **trunk** is the chain formed by
   following, at each node, its position-0 child only; a **tail** is any child reached through a
   position ≥ 1 edge, plus that child's own descendants (all of which, per the Phase-1 invariant,
   have no further position ≥ 1 children of their own). `PipelineRiverView` maps the trunk array
   the selector returns; each trunk step renders zero-or-one `TailChain` fed by the same
   selector's per-step tail-descendants list. Alternative (full tree component) rejected —
   over-general for a Phase-1 invariant the editor itself enforces by refusing a second branch.
2. **Outputs rail chips read from a per-node `outputsByStepId` selector**, built once from
   `GET /api/pipelines/:id/outputs` (fetched on page load alongside the pipeline detail/steps
   fetch, NOT embedded in `PipelineSummaryResponse` — verified: that response carries no
   `outputs`/`steps` fields). This same list is the source for the header's "Outputs (N)" count
   and the gallery tab count. Live thumbnail data comes from the same per-Output preview frame the
   sheet uses (`POST /api/pipelines/:id/preview` with `outputId`) — the rail and the sheet share
   one preview-cache hook (`usePipelinePreviewCache`) keyed by `outputId`, single source of truth
   for HEL-878's stale-chip class of bugs.
3. **Output editor migration**: `BindingEditor.tsx` → `OutputEditorSheet.tsx` (kind + name +
   mapping shell); `ChartAggregationFields`/`ChartDisplayFields`/`TableDisplayFields` reused
   near-verbatim, re-pointed at capabilities-at-node instead of `DataTypePicker`;
   `MetricBindingFields`/`MetricPicker`/`useMetricBindingState` collapse into the metric-kind slot
   of the sheet (metric Outputs no longer reference a separate Metric entity — HEL-903 dropped
   `metrics`); `DataTypePicker.tsx` deleted (no `DataType` left to pick — HEL-936 share).
   `useBoundOrLiteralState`/`BoundOrLiteralField` kept as-is (still the field-or-literal pattern,
   `panel-config-field-or-literal-pattern` unaffected). `CollectionEditor`/`TimelineEditor`/
   `MetricValueEditor`/`ChartAppearanceEditor`/`AppearanceEditor` kept, re-pointed at Output config.
   `DividerEditor`/`ImageEditor`/`TextContentEditor`/`MarkdownEditor` (content-panel editors) stay
   untouched — content panels remain dashboard-native, no Output.
4. **Markdown Output kind (binding spec decision 14)**: reuses `MarkdownEditor.tsx`'s template-editing UI,
   fed by capabilities-at-node fields as interpolation targets instead of a data-bound field list.
5. **"Add as tail with aggregate"** issues two calls: `POST /api/pipelines/:id/steps` (verified
   path — NOT `POST /api/pipeline-steps`, which is `:id`-scoped PATCH/DELETE/duplicate only) with
   kind `aggregate` and `parentStepId` = chosen node (`CreatePipelineStepRequest.parentStepId`),
   then `POST /api/pipelines/:id/outputs` with `nodeStepId` = the new step's real id — no new
   backend endpoint; the sheet's confirm action sequences both and rolls back the step on
   Output-create failure (toast + retry, matching today's step-create error handling).
11. **Shape-expand tail parenting is done entirely client-side.** `POST
   /api/pipeline-shapes/:id/expand` takes `{params}` only — it has no `parentStepId` field and
   never learns which step the user chose (verified: `ExpandPipelineShapeRequest(params:
   JsObject)`). The response's own `steps[].parentStepId` values are synthetic intra-response
   `clientId`s (e.g. `"step-0"`), chaining entries to each other, not real step ids. The client
   therefore: (a) calls expand with params only; (b) creates the response's first step (no
   `clientId`-parent, i.e. the response's own root) via `POST /api/pipelines/:id/steps` with
   `parentStepId` = the chosen node's real id (from the picker) when instantiating against an
   existing step, or omitted when the pipeline has zero steps (seeds a trunk, not a tail); (c)
   creates each subsequent response step with `parentStepId` = the **real** id just returned for
   whichever response step its `clientId`-reference pointed to, maintaining a `clientId -> real
   id` map as it goes. Same client-side clientId-to-real-id resolution pattern the existing
   (unmodified) shape-instantiation flow already uses for trunk seeding — extended here to also
   cover the tail-attach-point case.
13. **HEL-731's `enum`/`fieldRef` param-widget metadata is dormant, not live, on the shipped
    backend — HEL-731 is NOT fully absorbed by this ticket.** `ShapeParamDescriptor`
    (`domain/shapes/ShapeParamDescriptor.scala:16-22`) has exactly five fields
    (`name, label, dataType, required, description`), serialized `jsonFormat5`; no `enum`/`fieldRef`
    field exists on the descriptor, the wire, or any of the five registered shapes. Adding it is a
    backend change this ticket's own non-goals rule out ("Backend route changes — this ticket
    consumes P1.3/P1.4 routes as-is"). `ShapeParamsFields` SHALL still be written to *honor*
    `enum`/`fieldRef` when present (forward-compatible, same posture as decision 12's dormant
    Outputs arm) so a future descriptor extension lights it up with no client change, but the two
    scenarios exercising it are fixture-only today. The binding spec (line 271) folds HEL-731 into
    this row as an AC; that folding is only partially honored — the widget-rendering half ships,
    the backend-descriptor half does not. A follow-up ticket for the `ShapeParamDescriptor`
    extension (retargeting the remainder of HEL-731) SHALL be filed at delivery time, named in the
    PR, so the gap is tracked rather than silently dropped.
    **skeptic-final-1 (round 1) CR2 verified this had NOT actually happened** -- only HEL-937 (the
    `PanelDetailModal`/`BindingEditor` migration blocker) was filed; this `ShapeParamDescriptor`
    extension was a distinct, still-unfiled follow-up. **Filed as HEL-939** by the orchestrator
    after this round's executor flagged it had no `mcp__linear__*` tool access.
14. **Shape-declared Outputs are dormant, not live, on the shipped backend.**
   `ExpandPipelineShapeResponse.outputs` is documented as `None` for every shape today — no
   registered `PipelineShape.expand` implementation declares outputs yet. The client SHALL still
   implement the outputs-creation arm (parse `outputs` as a `JsArray` of `{nodeStepId: clientId,
   kind, config}`-shaped entries per the wire shape's forward-compat intent, resolve `nodeStepId`
   through the same clientId map, `POST` each via `/api/pipelines/:id/outputs`), but this arm is
   untestable against a live shape today — the primary "shape expands to steps AND Outputs"
   scenario is fixture-only until a shape actually declares outputs. Record this explicitly rather
   than silently treating an absent-`outputs` response as the only real path; a follow-up ticket
   for a shape that declares Outputs is out of this ticket's scope.
6a. **Output-sheet live preview source differs for a saved vs. unsaved Output.**
    `PipelineRunService.previewOutputs` (via `POST /api/pipelines/:id/preview?outputId=`) resolves
    `outputId` through `outputRepo.findById` and returns node rows only — it requires a
    **persisted** Output and never applies that Output's config server-side. A brand-new Output
    being composed in the sheet before its first save has no `outputId` and cannot use this
    endpoint. The sheet therefore sources preview rows from `POST /api/pipelines/:id/preview?outputId=`
    once the Output has been saved at least once, and from `GET
    /api/pipelines/:id/steps/:stepId/preview` (the existing single-step preview tray endpoint) for
    an unsaved Output — in both cases the in-progress (possibly unsaved) config is applied
    **client-side** at render time over the returned node rows, since neither endpoint applies
    Output config server-side.
6. **Run-scoped state audit (HEL-878)**: enumerated in tasks.md; both the `dry-run` thunk's
   `.fulfilled`/`.rejected` reducers and the SSE `run:complete`/`run:error` handlers must clear
   the same field set — implemented as one `resetRunScopedState` reducer both paths call, not two
   parallel clearing branches (the bug's actual root cause per HEL-878).
7. **Out-of-order guard (HEL-681)**: request-id token per preview/analyze dispatch, stored in
   slice state; a response is applied only if its token matches the latest dispatched — same
   pattern already used elsewhere in `pipelinesSlice`, extended to the new per-Output preview calls.
8. **ECharts live-switch (HEL-629)**: candidate fix is a forced remount (`key={chartType}`) on
   kind/type change inside the Output sheet's live preview and the rail's thumbnail. Per
   `.concertino/laws/systematic-debugging.md` this is a hypothesis, not yet a probe-confirmed root
   cause — the executor SHALL reproduce the crash against the live app first (per HEL-629's own
   repro steps) and confirm the failure mode (an in-place series-type option diff echarts-for-react
   cannot reconcile) before applying the fix, recording the probe in the PR per HEL-629's AC.
9. **Placements** ("on N dashboards", placements-with-links list, delete-warning count) are read
   from `GET /api/outputs/:id/panels` (verified — exists at `OutputRoutes.scala:75`). The gallery
   fetches this per-card lazily on card mount/visibility rather than bulk up front (N Outputs would
   otherwise mean N calls at once on page load for a page whose primary payload is already the
   Outputs list + per-Output preview frames); the Output sheet always fetches it fresh on open,
   since placement count is safety-critical for the delete-warning path and must not be stale.
10. **New-pipeline single-call, corrected against the shipped contract**: `CreatePipelineRequest`
    requires a pre-existing `sourceDataSourceId` (verified — `PipelineProtocol.scala:36-42`,
    `schemas/pipelines/create-pipeline-request.schema.json`); there is no inline-source arm, unlike
    what the binding spec's decision 4 describes. Within this ticket's "no backend changes"
    non-goal, the new-pipeline flow therefore issues **two** calls for a brand-new source (create
    the source via the existing source-creation route, then one `POST /api/pipelines` carrying the
    resulting `sourceDataSourceId` plus `steps`/`outputs`) and **one** call when an existing source
    is picked. "Single-call" in the proposal/spec refers to the pipeline-plus-steps-plus-outputs
    half of the flow, which is genuinely one call — not source creation, which the shipped contract
    does not fold in. This divergence from the binding spec's literal wording is noted here rather
    than silently redefined; the inline-source arm (spec decision 4's full intent) is out of scope
    for this ticket and should be filed as a backend follow-up if wanted.

15. **`PUT /pipelines/:id/steps/order` request-shape contract for trunk reorder (HEL-908, Cycle 9,
    resolving the ambiguity Cycle 8/the human left to the executor).** The existing
    `ReorderPipelineStepsRequest.stepIds` field's doc comment ("exactly a permutation of the
    pipeline's current step ids") predates the trunk/tail data model and is ambiguous once both
    trunk and tail ids can exist in the same pipeline: does "permutation of current step ids"
    mean the whole pipeline's ids (trunk + every tail), or just the trunk? Chosen contract,
    picked as the narrowest defensible one and enforced by rejecting anything else rather than
    guessing at a most-likely intent: **`stepIds` must be exactly the pipeline's current TRUNK
    step ids** (as returned by `PipelineStepRepository.trunkOf`), **in the desired new trunk
    order, with no tail ids present and no trunk ids missing or duplicated.** A request violating
    this (any tail id present, any trunk id missing, any duplicate) is rejected with
    `422 UnprocessableEntity` and a message naming the specific violation, not silently accepted
    or silently no-op'd — "a rejected request the caller can see beats a success that did nothing"
    (the human's own framing for why this class of endpoint must fail closed). Rationale for
    trunk-only over "trunk ids plus each tail's own root, permuted together" or "a single flat
    order across trunk and every tail": (a) it is the smallest request shape that has a
    well-defined semantic under "tail follows its trunk step" — since a tail never moves
    independently of its trunk node (there is no product requirement for reordering a tail
    relative to its own trunk node, or for moving a tail root to a different trunk node), letting
    the caller submit tail ids at all would require defining behavior for inputs that mean
    nothing under the ruled semantics; (b) it matches the UI's own affordance exactly — the
    drag-reorder interaction (task 3.5/`PipelineRiverView`) only ever drags trunk cards, tails are
    rendered read-only/non-draggable (Decision 1) — so the request shape the frontend actually
    needs to send is trunk-ids-only, and a wider contract would be unused surface, not
    forward-compatibility. The backend method implementing this is
    `PipelineStepRepository.reorderTrunkInternal(pipelineId, orderedTrunkIds)`, called from
    `PipelineService.reorderSteps` after validating the new contract (replacing the prior
    whole-pipeline-permutation check), which is the one implementation `reorderInternal` above
    remains unchanged/untouched by (kept for defensiveness/tests, but has no live caller once
    `reorderSteps` is repointed at `reorderTrunkInternal`).

## Risks / Trade-offs

- [Large surface, single PR] → split by file ownership already fixed by the ticket (owns
  `editors/*` wholesale); land as one PR per ticket convention, keep commits logically grouped in
  history even though squashed at delivery.
- [Deleting `PipelinePreviewModal`/`ShapeInstantiateStep` breaks any lingering e2e reference] →
  AC requires grepping `e2e/` for both names plus `/registry` and rewriting/deleting those specs.
- [Capabilities-at-node payload shape drift vs. sheet's assumptions] → verify live against running
  backend during execution, not just the P1.3 spec doc, per the stale-build warning in the ticket.

## Planner Notes

- Self-approved: keeping `useBoundOrLiteralState`/`BoundOrLiteralField` and the four content-panel
  editors untouched rather than rewriting — they are not part of the Output-binding concept HEL-903
  retargets, and the ticket's own text says "delete what you do not reuse," implying reuse-in-place
  is expected where the underlying concept (field-or-literal, literal content panels) is unchanged.
- Self-approved: sequencing "add tail with aggregate" as two client calls rather than requesting a
  new combined backend endpoint — no such endpoint exists in the shipped P1.3/P1.4 surface and the
  ticket's Dependencies section states backend routes are already complete.

## Step-Mutating Handler Enumeration: the Method (not just the list) — CR9/CR10/CR11 postmortem

Three review cycles (evaluation-2.md CR9, evaluation-3.md CR10, evaluation-4.md CR11) each found
one more `usePipelineDetailPage.ts` handler with the identical defect: a step-mutating backend
route quietly reparents or deletes steps OTHER than the one the client thinks it acted on, and the
handler patched only its own local optimistic delta into `steps` instead of resyncing from the
server — so `buildStepTree` rendered a stale (in CR9/CR10, misplaced; in CR11, outright
nonexistent/phantom) tree until a hard reload.

This kept recurring **because the first enumeration was done on the wrong axis**, and the mistake
was never named out loud until evaluation-4.md's forced systematic pass. Recording the axis here
so the next handler that mutates pipeline steps is checked against the *method*, not against "is
it on this list of N" — the list is a byproduct, not the deliverable, and a new handler is by
definition never on an existing list.

### The wrong axis (what produced an incomplete list twice)

The original (Cycle 3) enumeration asked: **"does this handler's call create/insert a step?"**
That is the wrong question — it happens to catch `handleInsertStep`/`handleDuplicateStep` (both
route through the create/splice primitive), but it has nothing to do with the actual hazard, so it
silently excluded `handleRemoveStep` (a delete, not a create) until CR11 forced a second look.

### The correct axis (systematic, auditable, repeatable)

1. **Grep every step-mutating service call site**, repo-wide, not just the ones already suspected:

   ```
   grep -rn "createPipelineStep(\|deletePipelineStep(\|duplicatePipelineStep(\|reorderPipelineSteps(\|updatePipelineStep(\|updatePipelineStepEnabled(\|createOutput(" frontend/src
   ```

   (excluding the service function definitions themselves and their tests).

2. **For each call site, read the actual backend service/repository code path it hits** — not its
   name or its own local diff, the real `PipelineStepRepository`/`PipelineService` method body.

3. **Ask the real hazard question, not the wrong one**: *can this backend path mutate, reparent,
   or delete steps OTHER than the one explicitly targeted by the call?* "Does this call create a
   step" is irrelevant — deletes, reorders, and duplicates are exactly as hazardous as creates
   whenever their backend implementation touches sibling/child rows as a side effect.

4. **Cross-reference against how the frontend handler reconciles**: does it call
   `syncStepsFromServer()` (or otherwise fully reconcile against a server response covering every
   affected row, as `handleReorderSteps` does via `reorderTrunkInternal`'s full-row-set response),
   or does it only patch local state for the one step it believes it acted on? A handler answering
   "yes" to step 3 and "local patch only" to step 4 is defective, full stop — regardless of whether
   its backend call happens to be a create, a delete, a duplicate, or a reorder.

### The complete enumeration as of CR11 (result, not the method — kept for reference only)

| Handler | Mutates OTHER steps server-side? | Client reconciles? | Verdict |
|---|---|---|---|
| `handleInsertStep` (and `handleAddStep`, which delegates to it) | Yes — reparents anchor's children | `syncStepsFromServer()` | OK (CR9) |
| `handleAddTailStep` | No — genuine new sibling | `syncStepsFromServer()` (defensive) | OK (CR9) |
| `handleAddOutputViaAggregateTail` (+ its rollback delete) | No — rollback target is a just-created childless leaf | `syncStepsFromServer()` / local filter correct for a leaf | OK (CR9) |
| `handleInstantiateShape` | No | n/a | OK |
| `handleReorderSteps` | Yes — rewrites every trunk `parentStepId` | Reconciles via the full-row-set response (`reorderTrunkInternal` returns `executionOrder(finalRows)`, all rows including tails) | OK |
| `handleToggleStepEnabled` | No | Reconciles from response | OK |
| `handleDuplicateStep` | Yes — same reparenting primitive as insert | `syncStepsFromServer()` | OK (CR10) |
| `handleRemoveStep` | **Yes — reparents the head child onto the deleted step's parent AND cascade-deletes every other child's subtree (tails)** | Was local-filter-only | **Fixed this cycle (CR11) — now calls `syncStepsFromServer()`** |
| `updatePipelineStep(` call site (`useStepCardState.ts:211`, step config edits) | **Conditionally** — its backend path (`positionScopedUpdateAction`) renumbers every sibling in the anchor's group whenever `position` is present in the request | Not applicable today — the client only ever sends `{config}`, never `position`, from this call site | **Safe today, LATENT** — flagged by the Cycle-5 evaluator's own re-application of the grep in step 1: the original CR9-era pattern used `updatePipelineStepEnabled(`, which does not match `updatePipelineStep(` (the literal `(` makes them distinct tokens). If a future change starts sending `position` through this call site, it inherits the same defect class as CR9-CR11 with no test guarding it. |

A future handler that mutates pipeline steps must be checked against the four-step method above,
not against this table — the table is only ever complete as of the review cycle that produced it.
