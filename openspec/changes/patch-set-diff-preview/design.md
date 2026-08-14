## Context

HEL-406's `PatchSetApplyResolvers.resolveAll(patchSet.edits, user, context): Future[Either[ServiceError,
Vector[ResolvedEdit]]]` (`private[services]`) already does 100% of the pre-validation this ticket
needs — target ACL (per real per-op rule, not a same-named lookup), embedded cross-resource
references, and typed-patch decoding — and each `ResolvedEdit` already carries `priorStateJson:
Option[JsValue]` (D4a from HEL-406), the exact "before" half of this ticket's diff. Placing
`PatchSetPreviewService` in the SAME `com.helio.services` package makes `resolveAll`/`ResolvedEdit`/
`ResolvedAction` directly callable — zero duplicated pre-validation logic, verified by reading
`PatchSetApplyTypes.scala`/`PatchSetApplyService.scala` directly (not assumed).

`PatchSetApplyForward.scala` (HEL-406) applies each `ResolvedAction` via the REAL, WRITING service
method (`panelService.update`, etc.) — cannot be reused for a read-only preview. A real
write-then-roll-back-in-one-transaction is not available either: HEL-406's own design.md D3 already
established (and this design re-verifies) that `DbContext.withUserContext`/`withSystemContext`
(`DbContext.scala:50-64`) each independently open+commit their own transaction per call — every
mutating repository method (`panelRepo.updateTitle`/`updateAppearance`/`replace`,
`dashboardRepo.update`, etc.) commits immediately, so there is no shared session an OUTER preview
transaction could roll back across the several inner calls `PanelService.update`/
`DashboardService.update` etc. themselves make. Pure, in-memory-only projection is therefore not a
preference but the only structurally available option, exactly as it was for HEL-406's rollback.

Per-kind PURE (no-I/O) sub-computations already exist and are reused directly (verified against
source, not assumed):
- `PanelServiceHelpers.resolvePatch(request, existing): Either[String, ResolvedPanelPatch]` (public,
  `PanelServiceHelpers.scala:21`) and `PanelConfigCodec.applyConfigPatch(existing: Panel, json):
  Either[String, Panel]` (public, `PanelConfigCodec.scala:77`) — the latter returns the COMPLETE
  updated `Panel`, not just a config fragment. `PanelAppearance.applyPatchJson(json, existing):
  Either[String, PanelAppearance]` (public, `model.scala:387`).
- `PanelServiceHelpers.buildNewPanel(id, dashboardId, title, meta, appearance, ownerId, createConfig):
  Panel` and `.resolveCreateConfig`/`.resolveCreateAppearance` (`private[services]`,
  `PanelServiceHelpers.scala:68,109,130`) — a full, pure per-kind `Panel` constructor already used by
  the real create path; directly reusable for a create-preview's projected object, given a
  placeholder id (no real id can exist before an actual insert).
- `DashboardServiceValidation.validateDashboardUpdateRequest(request): Either[String, (Option[String],
  Option[DashboardAppearance], Option[DashboardLayout])]` (`private[services]`,
  `DashboardServiceValidation.scala:95`) — pure; `DashboardService.applyUpdate`'s own field
  composition is a plain, trivially-mirrored `.copy` (corrected per round-1 REFUTE non-blocking note:
  `existing.copy(name = nameOpt.getOrElse(existing.name), appearance = appearanceOpt.getOrElse(
  existing.appearance), layout = layoutOpt.getOrElse(existing.layout))` — the real
  `DashboardService.scala:147-184` composes ALL THREE fields, not just appearance/layout; the
  original draft of this doc omitted `name` from its own description of the mirror).
- `PipelineStepConfigCodec.decode(kind, raw): Try[Any]` (public, `PipelineStepConfigCodec.scala:75`)
  — pure; used identically to how `PatchSetApplyRollback.fullPipelineStepInverse` already decodes a
  step's config for its own inverse-request builder.
- DataSource/DataType/Pipeline(-rename) updates are single- or few-field `.copy`s on already-typed
  domain objects — no codec involved, mirrored directly from `PatchSetApplyRollback`'s existing
  `fullDataSourceInverse`-equivalent/`fullDataTypeInverse`/pipeline-rename logic (same file, already
  cross-checked against source once for HEL-406; re-read here, not re-derived independently).

## Goals / Non-Goals

**Goals:** a read-only `preview(patchSet, user)` sharing HEL-406's pre-validation verbatim; a
per-edit before/after diff computed purely in memory (zero repository writes anywhere in this
ticket); a small, explicitly-grounded impact-hint rule set; a frontend review component reusing
`ProposalReview`'s established patterns.

**Non-Goals:** see proposal.md. Additionally: no attempt to project an after-state for any (kind,
op) `PatchSetApplyResolvers.resolveAll` itself already rejects (inherited automatically, not a new
scoping decision); no synthetic "predicted id" that could be mistaken for a real one — a create
preview's `after.id` is an explicit sentinel string, never a plausible-looking UUID.

## Decisions

**D1 — Reuse `resolveAll` verbatim for ACL/shape; explicitly enumerate the content-check gap it
does NOT close (round-1 REFUTE finding 1 — corrected from an overclaimed "1:1 by construction").**
`PatchSetPreviewService.preview` calls `PatchSetApplyResolvers.resolveAll(patchSet.edits, user,
context)` exactly as `PatchSetApplyService.apply` does — same `PatchSetApplyContext` construction. A
`resolveAll` failure (ACL, target existence, patch shape) returns the SAME `Left(ServiceError)`
apply would return for the identical reason — genuine, structural parity for this tier.

`resolveAll` is narrower than the full set of checks each real per-kind service method performs,
though — it does target/ACL/shape resolution only, never the CONTENT-level business rules those
methods separately enforce after resolving. Four concrete gaps were found by tracing every reused
function's real caller, not assumed absent: panel-update's blank-title/cross-type-PATCH check
(`PanelServiceHelpers.resolvePatch`, `PanelServiceHelpers.scala:21-48`) and scatter+aggregation
conflict (`PanelService.validateScatterAggregationConflict`, `PanelService.scala:450`) — closed for
free below, since D3's projection ALREADY calls `resolvePatch` for panel updates and D1a makes its
failure propagate; pipeline-rename's blank-name check (`PipelineService.updateName`,
`PipelineService.scala:154-155`, `if (req.name.trim.isEmpty) ...BadRequest`) — a one-line pure
check, replicated directly (D1a); dataType-update's computed-field expression validation
(`DataTypeService.applyUpdate`, `DataTypeService.scala:79-108`, calling
`RequestValidation.MaxExpressionLength` (public) and `ExpressionEvaluator.validateTolerant` (public,
`ExpressionEvaluator.scala:347`)) — both pure, reused directly (D1a); dataType-delete's owned-panel
conflict (`DataTypeService.delete` → `dataTypeRepo.existsBoundToAnyOwnedPanel`,
`DataTypeService.scala:133-138`, rejects with `Conflict` when the DELETING user's own panels are
bound) — a genuine READ (not pure), reused directly as a REJECTION check, not merely an impact hint
(D4 corrected below); dataType-delete's source-link conflict (`DataTypeService.checkSourceLink`,
`DataTypeService.scala:159-171`, `private` — not reusable directly, but a simple two-line check
mirrored: `dt.sourceId.isDefined` + `dataSourceRepo.findByIdInternal` existence) — replicated (D1a).
Note on ordering (round-3 REFUTE non-blocking finding): the real `DataTypeService.delete` evaluates
`checkSourceLink` FIRST, `existsBoundToAnyOwnedPanel` SECOND (`DataTypeService.scala:127-141`) — the
opposite of the enumeration order above. This does not matter in practice: a DataType can never
simultaneously have `sourceId` defined (triggering the source-link check) AND a bound panel
(triggering the owned-panel check), since `rejectCompanionBinding`/`PatchSetApplyResolvers`'s own
companion-binding check already rejects any attempt to bind a panel to a `sourceId`-defined
DataType — the two conditions are structurally mutually exclusive, so preview's check order is free
to differ from `apply`'s without ever producing a different verdict.

**D1a — Content-check parity is achieved for every check enumerated above, not open-ended.** A
`Left`/rejection from any of these — whether from a genuinely-reused pure function (panel,
pipeline-rename, dataType-update) or a genuine extra READ (dataType-delete's two conflict checks)
— causes `preview` to return `Left(ServiceError)` for the WHOLE call, the same failure shape a
`resolveAll` rejection already produces (ticket.md AC2's "vice versa": a preview-clean patch set
applies cleanly, AND a patch set that would fail apply for one of these specific reasons is caught
by preview too). This is explicitly NOT a claim of exhaustive content-check parity for every
conceivable future service-side validation — see Risks.

**D2 — `before` is `ResolvedEdit.priorStateJson`, unchanged.** Zero new code for this half of the
diff — HEL-406's D4a already built exactly this field for exactly this purpose. `None` for a
`create` edit.

**D3 — `after` projection, per op.** Every `Left`/rejection any step below produces propagates per
D1a (whole-call failure), not a silently-dropped or per-edit-only outcome:
- `delete` → `None` (the resource will no longer exist), UNLESS the kind/op has its own D1a content
  check (dataType delete's two conflict checks) — a positive conflict there fails the WHOLE preview
  call before any `after` is computed for ANY edit, matching what `apply` would do (the conflicting
  edit would fail forward-apply and, per HEL-406, force a rollback of everything before it — preview
  catching it up front is strictly better than that).
- `update` → pure in-memory projection composing the reused functions from Context above (including
  the D1a content checks for panel/pipeline/dataType), then serialized via the SAME response
  `fromDomain` HEL-406's `resultingState` already uses (`PanelResponse`/`DashboardResponse`/
  `DataSourceResponse`/`DataTypeResponse`/`PipelineSummaryResponse`/`PipelineStepResponse`) — the
  "after" shape a preview shows is byte-identical in FORMAT to what a real apply's `resultingState`
  would show, differing only in that nothing was written to produce it. This explicitly EXCLUDES
  timestamp fields (`meta.lastUpdated`/`updatedAt`) — every real update path bumps these to the
  actual write's wall-clock moment, which a preview computed before Accept cannot know in advance;
  the projection leaves them at `prior`'s value rather than guessing, so a caller comparing
  `before`/`after` should not read a timestamp field as meaningfully changed (round-4 REFUTE
  non-blocking note — named explicitly here rather than left for a reader to discover the exclusion
  on their own).
- `create` → pure projection via each kind's own create-side builder (`buildNewPanel` for panel;
  trivial field-echo for dashboard/dataSource/pipeline, matching each `Create*Request`'s own limited
  field set). `after.id` is the literal sentinel string `"(pending)"` — a real id cannot exist before
  an actual insert; documented explicitly so a caller never mistakes it for one.

**D4 — Impact hints: a small, explicit, source-grounded rule set**, not an open-ended inference
engine — one rule per (kind, op) with a REAL cascade/staleness fact behind it, re-confirmed here
against source rather than recalled from a prior ticket's memory:
- `pipeline`/`pipelineStep` `update`/`delete` → *"Pipeline output rows will be stale until
  re-run."* (rows are written once at run time; no automatic re-run is triggered by any edit here).
- `pipeline` `delete` → *additionally* cascades to its steps/run history (`DELETE
  /api/pipelines/:id`'s documented cascade) — hint states this qualitatively; no per-edit step count
  is computed (would require an extra read this ticket's Scope doesn't ask for).
- `dataSource` `delete` → *"Cascades to any pipeline built on this source."*
- `dataType` `delete` → corrected per round-1 REFUTE finding 2 (the original "will be unbound" hint
  was backwards for the common case): D1a's `existsBoundToAnyOwnedPanel` check already REJECTS the
  whole preview (not merely hints) when the deleting user's own panels are bound — that is the
  common case, and it is a rejection, not an impact hint, per D3. The narrow remaining case where an
  impact hint is accurate: panels owned by a DIFFERENT user via a sharing grant are bound (D1a's
  owner-scoped check does not see these, so preview does NOT reject) — for that case ONLY, hint
  *"Panels shared by other users may be unbound (`panels.type_id` `ON DELETE SET NULL`,
  `V5__panel_type_binding.sql:1`) — not visible to this preview's ownership-scoped check."* No hint
  when no bound panel exists at all.

  **Detection mechanism (round-2 REFUTE finding — the corrected hint named no query that could
  actually distinguish "cross-owner-shared bound panel exists" from "no bound panel exists"; one
  is now specified).** New `PanelRepository.existsBoundToType(dataTypeId: DataTypeId, user:
  AuthenticatedUser): Future[Boolean]` — a plain `SELECT COUNT(*) FROM panels WHERE type_id = ...`
  run inside `ctx.withUserContext(user.id.value)` (the SAME app-pool, RLS-enforced pattern
  `existsBoundToAnyOwnedPanel` itself uses), with NO `owner_id` filter in the SQL — deliberately
  RLS-scoped, not privileged/`withSystemContext`. `panels_select`'s own RLS policy
  (`USING (helio_can_access_dashboard(dashboard_id))`, `V36__rls_sharing_aware_tables.sql:146-148`)
  already restricts the rows Postgres returns to panels on a dashboard the deleting user can
  access (owner or sharing grant) — so this single query, un-filtered in application code, already
  returns "panels bound to this type that this user can see," combining the D1a rejection check's
  already-known-`false` owned-panel case with a genuinely-different, RLS-visible cross-owner case
  in one call.

  **Why RLS-scoped, not privileged (the choice round 2 required be made and justified, not
  assumed):** a privileged/`withSystemContext` query (mirroring `checkSourceLink`'s
  `findByIdInternal`) would see every tenant's panels bound to the type, including ones the
  deleting user has zero relationship to — leaking that unrelated resource's existence via the hint
  text, which this codebase's own established convention treats as a real violation (e.g.
  `DashboardService.delete`'s own doc comment: *"No access (no grant) → 404 (no existence leak)"*).
  The RLS-scoped query is narrower — it only detects a cross-owner panel the deleting user ALSO has
  dashboard-ACL visibility into, not every cross-owner binding that could exist system-wide — but
  an impact HINT (informational, never a security gate; the real rejection already happened via
  D1a for the case that matters) under-reporting a binding the user cannot see anyway is a safe,
  honest limitation; a hint that could leak a stranger's private resource's existence is not.
  Documented explicitly as a real, accepted scope narrowing, not implied to be a complete census.

  **Test harness requirement (round-3 REFUTE finding).** `existsBoundToType`'s SQL carries NO
  `owner_id`/ACL predicate by design — its entire cross-owner-narrowing correctness depends on
  Postgres RLS actually being evaluated under `withUserContext`. This codebase's DOMINANT test
  pattern (`DbContext(db, db)`, both pools as the `postgres` superuser) silently bypasses RLS
  regardless of `FORCE ROW LEVEL SECURITY`, so a test written under that pattern would pass for the
  wrong reason — or worse, an implementer "fixing" a legitimately-failing assertion under the
  correct harness by adding an `owner_id` predicate to the SQL itself would silently collapse this
  method back into `existsBoundToAnyOwnedPanel`'s owner-only behavior, defeating the entire point of
  this decision without tripping any test. This codebase has already hit and documented this exact
  trap once, for a structurally identical raw-SQL-no-owner_id-predicate situation — see
  `WorkspaceTeardownServiceSpec.scala`'s own doc comment (cited directly, not re-derived) — this
  method's RLS-narrowing test MUST use that same real, non-superuser `helio_app_test` dual-pool
  harness (see tasks.md 6.5 for the specific requirement).
- `dashboard` `delete` → *"Cascades to N panel(s)."* — N via `panelRepo.findAllByDashboardId(id,
  Some(user), Page(0, 1)).map(_.total)` (`PanelRepository.scala:43-59`, already exists, used today
  by `PublicDashboardRoutes`; `.total` is computed via the SAME query's own COUNT alongside the
  slice, so a `page.limit = 1` call still returns the accurate total without over-fetching rows) —
  a genuine READ, not a write.
- `panel` `update` whose config patch changes `dataTypeId` → *"Panel will be bound to a different
  DataType."*
- Every other (kind, op) → no hint (an ordinary rename/content edit has no cascade/staleness
  consequence beyond the diff itself).

**D5 — Route + response shape.** `POST /api/patch-sets/preview` added to the EXISTING
`PatchSetRoutes.scala` (HEL-406) alongside `/apply` — same file, same `entity(as[PatchSet])` +
`ServiceResponse.run` shell style, no new route file. `PatchSetPreviewResponse{ edits:
[EditPreview{index, kind, op, before: Option[JsValue], after: Option[JsValue], impact:
Vector[String]}] }` — new types in `PatchSetPreviewProtocol.scala`, additive, mirrors
`PatchSetApplyProtocol`'s `EditOutcome` shape closely (same index-keyed-array convention) without
being the same type (preview has no `status`/`newId`; apply has no `before`/`after`/`impact`).

**D6 — Frontend: a real route + fixture/demo-driven page, mirroring the ACTUAL `ProposalReview.tsx`
precedent (round-4 REFUTE finding — corrected from a false citation).** The original draft of this
decision claimed `ProposalReview.tsx` shipped unwired before `ProposalReviewPage` gave it an entry
point — checked against `git log --diff-filter=A` and found FALSE: both files were added in the
SAME commit (`60980e4d`, HEL-224), with `/proposals/review` wired into `App.tsx` from day one, fed
by either router state OR a synthesized demo proposal ("a demo synthesized from the first
pipeline-output DataType... kept applyable") — specifically so the component was reachable and
manually/Playwright-verifiable before any real NL-authoring caller existed. `AuthoringChatDrawer`
(added over a month later) is a SECOND caller of that same pre-existing route, not its origin.

Corrected: `PatchSetReview.tsx` (the presentational component) is joined by a NEW
`PatchSetReviewPage.tsx` route container at `/patch-sets/review`, wired into `App.tsx` alongside
`/proposals/review`, mirroring `ProposalReviewPage.tsx`'s exact structure: reads
`location.state.patchSet` if present, else synthesizes a small, genuinely-applyable demo `PatchSet`
from real workspace data (the first dashboard's first panel, a single title-only `update` edit) —
the fixture path this ticket's own Non-Goal (NL authoring) leaves as the only available producer,
exactly the same bootstrapping problem `ProposalReviewPage` already solved for proposals. The page
calls `previewPatchSet` on mount, renders `PatchSetReview` with the result, and wires Accept to
`applyPatchSet` (HEL-406's existing endpoint — no backend change needed) / Reject to navigating
back. This keeps the review surface reachable and screenshot-verifiable at the final gate, matching
what the real precedent already established as the norm for this kind of review UI.

**D7 — No bespoke per-kind diff UI.** The review surface lists each edit's kind/op/impact plus its
raw `before`/`after` JSON (e.g. via a `<pre>`/formatted-JSON block per edit), not a hand-built
field-by-field diff widget per resource kind. A true per-kind visual diff (six kinds, each with its
own meaningful field set) is real, separate UI scope beyond what this ticket's own Scope text asks
for ("a patch-set review surface... showing per-resource before/after + impact" — satisfied by
showing the raw before/after, not requiring a bespoke visual diff per field).

## Risks / Trade-offs

- **Projection drift**: a future change to a real update/create path (e.g. a new panel config field)
  could silently diverge from this ticket's pure projection if the projection ever stops calling the
  SAME shared functions (`applyConfigPatch`, `buildNewPanel`, etc.) → mitigated structurally, not by
  process: every projection path in D3 is required to call the real shared function, never
  reimplement its logic — the same discipline `PatchSetApplyRollback`'s inverse-builders already
  follow for HEL-406.
- **No transaction-based double-check**: because a real write-then-rollback is structurally
  unavailable (Context), preview's accuracy depends entirely on the shared pure functions staying
  correct — accepted, same trade-off HEL-406's rollback already accepts for the identical reason.
- **`(pending)` id sentinel could theoretically collide** with a legitimate id string in `before`/
  `after` JSON comparison logic a future caller writes → mitigated by using a value (`"(pending)"`)
  that is not a valid UUID and cannot be produced by any real id-minting path.
- **Content-check parity (D1/D1a) is enumerated, not exhaustive** — round 1's fresh trace of every
  reused function's real caller found four concrete gaps, all now closed; a FUTURE addition to some
  real service method's own content validation (a new field-level rule this ticket has no way to
  anticipate) could, in principle, open a new narrow gap the same way — this ticket cannot prove the
  absence of a check nobody has written yet. Same standing-risk shape HEL-406's own D2/D2a ACL-
  replication risk already accepts for a different check category, for the identical reason (the
  alternative — re-deriving business logic instead of reusing it — would itself be the larger risk).
  Mitigated the same way HEL-406's was: name every check explicitly (D1 above) so a future reviewer
  auditing a NEW service-side validation knows exactly where its preview-side counterpart would need
  to be added, rather than discovering the gap silently.

## Planner Notes

Self-approved: no new external dependency, no breaking change, additive-only backend surface
(D5 adds a route to an existing file; no existing route/protocol modified) and a net-new,
unwired frontend component (D6, matching `ProposalReview.tsx`'s own precedent). Grounded every
reused-function claim against actual source before writing this document, applying the lesson
HEL-406's 8-round design gate + 2-round final gate already taught: an unverified claim about which
function does what, or whether two operations share a rule, is exactly what that process exists to
catch — better to verify once here than discover it round-by-round.

Round-1 REFUTE (see `skeptic-design-1.md`) found every individual reused-function claim accurate,
but the CONSEQUENCE of composing them — "preview and apply share failure behavior 1:1" — was
overclaimed: `resolveAll` alone doesn't cover four concrete content-level checks. Fixed above (D1/
D1a/D3/D4): each of the four gaps closed by name, the dataType-delete impact hint corrected to
match the real owner-scoped rejection behavior instead of asserting the opposite, and the
non-exhaustiveness of "enumerated content checks" named explicitly as a standing risk rather than
implied to be a complete proof.

Round-2 REFUTE (see `skeptic-design-2.md`) confirmed round 1's fixes hold up, then found one more
gap while doing exactly what its own brief asked (verify the corrected dataType-delete hint against
`DataTypeRepository`'s real query scoping): the corrected hint named no actual query that could
distinguish "cross-owner-shared bound panel" from "no bound panel," and none existed. Fixed above
(D4) by specifying a new, RLS-scoped `PanelRepository.existsBoundToType` method, with an explicit
justification for choosing RLS-scoping over a privileged query (the latter would leak an unrelated
tenant's private-resource existence via the hint text — this codebase's own established
no-existence-leak convention). `proposal.md`'s Impact list updated to include this new repository
method.

Round-3 REFUTE (see `skeptic-design-3.md`) exhausted this run's `SKEPTIC_DESIGN_ROUNDS` (3) budget
on a narrower, purely testing-methodology gap: the RLS-narrowing test for `existsBoundToType`
(round 2's own fix) named no test harness, and this codebase's dominant `DbContext(db, db)` pattern
silently bypasses RLS — a real, already-documented trap (`WorkspaceTeardownServiceSpec.scala`) for
a structurally identical query. Per this document's own escalation policy, budget exhaustion was
surfaced to the human as a `budget`-kind escalation; unlike HEL-406's round-3 escalation, this was
not a genuine architectural fork — the human agreed and directed `apply-fix-and-continue`. Fixed
above (D4) by specifying the required `helio_app_test` dual-pool harness explicitly, citing the
existing precedent directly (tasks.md 6.5). Also closed round 3's non-blocking check-ordering note
(D1) with a one-line mutual-exclusivity justification.

Round-4 REFUTE (see `skeptic-design-4.md`), the first post-escalation round run under the human's
explicit direction, confirmed rounds 1-3's fixes all hold up, then found a genuine, independently
significant defect on its own broad pass: D6's sole justification for shipping `PatchSetReview.tsx`
with NO route/page wiring cited a false precedent — `git log` shows `ProposalReview.tsx`/
`ProposalReviewPage.tsx` actually shipped in the SAME commit with a wired, fixture-fed route from
day one, not component-first. Fixed by reversing D6: a new `PatchSetReviewPage.tsx` + `/patch-sets/
review` route, mirroring the ACTUAL precedent's fixture/demo-driven bootstrapping pattern. Also
closed round 4's non-blocking timestamp-exclusion note (D3) with an explicit callout. No escalation
raised — this fix follows directly from the same human-approved "continue with full rigor" direction
already governing this round.
