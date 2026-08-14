## Why

A conversational refinement should be reviewable before it mutates anything — the mutation analogue
of `ProposalReview`, which previews a proposed dashboard before Accept. HEL-406 defined the atomic
apply path but no preview; a caller currently has no way to see a patch set's before/after or its
downstream impact without actually applying it.

## What Changes

- New `PatchSetPreviewService.preview(patchSet, user)`: reuses HEL-406's `PatchSetApplyResolvers.
  resolveAll` for pre-validation VERBATIM (same package, same `private[services]` entry point — zero
  duplicated ACL/shape logic), then computes each edit's projected after-state PURELY IN MEMORY, no
  repository writes anywhere. `before` is `ResolvedEdit.priorStateJson` — HEL-406's own D4a field,
  reused as-is, zero new code for that half of the diff. A real (not simulated-then-rolled-back)
  write-then-rollback is not available here for the same structural reason HEL-406's design.md D3
  already established: every repository call opens+commits its own transaction independently, so
  there is no shared session an outer preview transaction could roll back across multiple service
  calls.
- `after` projection reuses each kind's own PURE sub-computations wherever one already exists
  (`PanelServiceHelpers.resolvePatch`, `PanelAppearance.applyPatchJson`, `PanelConfigCodec.
  applyConfigPatch`, `DashboardServiceValidation.validateDashboardUpdateRequest`,
  `PipelineStepConfigCodec.decode`) — never re-deriving logic those functions already own. Where no
  pure function exists standalone (e.g. Dashboard/DataSource/DataType/Pipeline's simple field-copy
  updates), a small new pure `.copy(...)` mirrors the exact field composition
  `PatchSetApplyRollback`'s existing "full-overwrite inverse" builders already read from source —
  cross-checked against the same real update methods, not re-derived independently.
- Impact hints: a small, explicit rule set per (kind, op), each grounded in a real, already-confirmed
  cascade/staleness fact (dataSource delete → cascades to pipelines; dataType delete → panels
  unbound; pipeline/pipelineStep edit → output rows stale until re-run; dashboard delete → cascades
  to N panels).
- New `POST /api/patch-sets/preview` route — read-only, no writes.
- New `PatchSetReview.tsx` frontend component (reusing `ProposalReview`'s `Modal`/`TextField`/
  `InlineError` patterns, per `DESIGN.md`), fed by a new `patchSetsSlice` (`previewPatchSet`/
  `applyPatchSet` thunks, mirroring `dashboardsSlice.applyProposal`'s exact shape) — Accept calls the
  EXISTING HEL-406 apply endpoint; nothing is written until Accept. A new `PatchSetReviewPage.tsx`
  route container at `/patch-sets/review` (round-4 REFUTE fix — corrected from a false "component
  only" precedent claim): `ProposalReview.tsx`/`ProposalReviewPage.tsx` actually shipped in the SAME
  commit with a wired route from day one, fed by a fixture/demo proposal specifically so the
  component was reachable before any real caller existed — `PatchSetReviewPage.tsx` mirrors that
  exact pattern with a synthesized demo `PatchSet` (a single title-only panel-update edit built from
  real workspace data).

## Non-Goals

- NL authoring of the patch set (sibling ticket) — `PatchSetReviewPage.tsx`'s entry point uses a
  fixture/demo patch set, matching `ProposalReviewPage.tsx`'s own real precedent for the identical
  bootstrapping problem (no real producer existing yet); a future ticket wires a real
  NL-authored-patch-set caller the same way `AuthoringChatDrawer` later became a second caller of
  the pre-existing `/proposals/review` route.
- A bespoke, fully bidirectional per-kind visual diff UI — the review surface renders each edit's
  kind/op/impact plus its raw before/after JSON, not a hand-crafted field-by-field diff widget per
  resource kind (six kinds × per-field diffs is real, separate UI scope).
- Preview support for any (kind, op) combination `PatchSetApplyResolvers.resolveAll` itself already
  rejects at pre-validation (`dataType`/`pipelineStep` creates, a populated `patch` on `delete`,
  `ifExists` on a dashboard create) — preview inherits the exact same restricted matrix for free by
  reusing the same pre-validation call, not a new scoping decision.
- Undo (sibling ticket) — this previews the forward apply only.

## Capabilities

### New Capabilities
- `patch-set-preview`: the read-only diff/impact preview, consuming `patch-set-contract` (HEL-403)
  and reusing `patch-set-apply`'s pre-validation (HEL-406).

## Impact

- `backend/src/main/scala/com/helio/services/PatchSetPreviewService.scala` (new).
- `backend/src/main/scala/com/helio/services/PatchSetPreviewProjection.scala` (new — the pure
  after-state computation, split into its own file from the start, learning from HEL-406/HEL-668's
  file-size lesson).
- `backend/src/main/scala/com/helio/services/PatchSetPreviewImpact.scala` (new — impact-hint rules).
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` (modified — new
  `existsBoundToType` method, design.md D4's RLS-scoped detection query for the dataType-delete
  cross-owner-shared-panel hint, round-2 REFUTE fix).
- `backend/src/main/scala/com/helio/api/protocols/PatchSetPreviewProtocol.scala` (new).
- `backend/src/main/scala/com/helio/api/routes/PatchSetRoutes.scala` (modified — add the preview
  route alongside the existing apply route) + `ApiRoutes.scala`/`JsonProtocols.scala` wiring.
- `schemas/patch-set-preview-response.schema.json` (new).
- `frontend/src/features/patchSets/{services/patchSetService.ts,state/patchSetsSlice.ts,
  types/patchSet.ts,ui/PatchSetReview.tsx,ui/PatchSetReview.css,ui/PatchSetReviewPage.tsx}` (new
  feature folder, mirrors `dashboards`' own structure).
- `frontend/src/app/App.tsx` (modified — add the `/patch-sets/review` route, mirroring
  `/proposals/review`'s existing registration, round-4 REFUTE fix).
- `backend/src/test/scala/com/helio/services/PatchSetPreviewServiceSpec.scala`,
  `backend/src/test/scala/com/helio/api/routes/PatchSetPreviewRoutesSpec.scala` (new).
- `frontend/src/features/patchSets/ui/PatchSetReview.test.tsx`,
  `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx`,
  `frontend/src/features/patchSets/state/patchSetsSlice.test.ts` (new).
- No changes to any existing PATCH/DELETE endpoint, `PatchSetProtocol.scala`, or
  `PatchSetApplyService`/`Resolvers`/`Forward`/`Rollback.scala` (HEL-406) — pure consumer of that
  ticket's existing, unmodified surface.
