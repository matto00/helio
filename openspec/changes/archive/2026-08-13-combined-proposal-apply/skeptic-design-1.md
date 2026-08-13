## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **`PipelineProposalService.scala` rollback composition/ordering.** Read the full file
   (`backend/src/main/scala/com/helio/services/PipelineProposalService.scala`). Confirmed
   `pipelineService.delete`, `dataTypeService.delete`, `dataSourceService.delete` all exist with the
   signatures the design assumes (`Future[Either[ServiceError, Unit]]`, matching the existing
   `rollbackAll`/`rollbackSourceOnly` discard-the-Either pattern the new `rollback` would mirror), and
   `dataTypeRepo.findBySourceId(id: DataSourceId, ownerId: UserId): Future[Vector[DataType]]`
   (`backend/.../infrastructure/DataTypeRepository.scala:65`) matches the claimed call. Re-derived the
   FK-cascade reasoning from the actual migrations rather than trusting the design doc's restatement:
   `V22__pipelines.sql` (`source_data_source_id ... ON DELETE CASCADE`, `output_data_type_id ...
   ON DELETE CASCADE`), `V23__pipeline_steps.sql` / `V24__pipeline_runs.sql` (both cascade off
   `pipelines.id`), `V4__data_sources_and_types.sql` (`data_types.source_id ... ON DELETE SET NULL`).
   Cross-checked `DataTypeService.delete`'s `checkSourceLink` (rejects deleting a DataType while its
   source still exists) and `existsBoundToAnyOwnedPanel` (rejects deleting a DataType while any panel
   is bound to it) — confirmed `DashboardProposalService.apply` is genuinely atomic on failure
   (`createAll` deletes the whole dashboard, cascading panels, the moment any panel create fails; a
   `preValidateBindings` rejection creates nothing at all), so by the time the new `rollback` runs, no
   panel is ever bound to the pipeline's output DataType — `dataTypeService.delete(outputDataTypeId)`
   can't hit the panel-conflict guard. The claimed order (pipeline → output type → read companions →
   source → companions) is safe: pipeline/output-type deletes don't touch source-linked companion rows,
   so reading `findBySourceId` any time before the source delete (not necessarily first) is correct as
   claimed. **This part of the design holds up.**

2. **`DashboardProposalService.scala` + `ProposalPanelSupport.scala` — zero changes, sentinel
   compatibility.** Read both files in full. Confirmed `ProposalPanelSupport.bindingCandidate` is
   `panel.dataTypeId.orElse(nonFlatConfigDataTypeId(panel))`, where `nonFlatConfigDataTypeId` returns
   `None` outright for any panel type in `DataPanelKinds` (`metric, chart, table, collection,
   timeline`) — i.e. `config.dataTypeId` is consulted **only** for non-`DataPanelKinds` panels. Also
   confirmed `ProposalPanelSupport.validatePanel` independently requires the **flat** `dataTypeId` to
   be non-empty for any `DataPanelKinds` panel, before `bindingCandidate` is ever reached. The "zero
   changes to either file" claim is accurate — the substitution is a pure in-memory transform that runs
   entirely inside the new `CombinedProposalService`, before either existing service sees the proposal.
   However, see Change Request 1 below: the design's own D2 structural pre-check does **not** actually
   mirror this kind-aware precedence, even though D3 explicitly claims it does.

3. **`DashboardProtocol.scala`'s `DuplicateDashboardResponse`.** Confirmed
   `final case class DuplicateDashboardResponse(dashboard: DashboardResponse, panels:
   Vector[PanelResponse])` with `jsonFormat2` registered in `DashboardProtocol` — exactly the shape D5
   claims, genuinely reusable verbatim.

4. **Route mount plan.** `grep -rn "pathPrefix(\"proposals\")"` across `backend/src/main/scala` and
   `openspec/` turned up nothing pre-existing — the prefix is genuinely free. Read the full route
   `concat(...)` block in `ApiRoutes.scala` (lines 248–395): every sibling route class mounts under its
   own fixed literal top-level segment (`"dashboards"`, `"pipelines"`, `"panels"`, etc.); the
   `PipelineIdSegment`/`DashboardIdSegment` unconstrained-`Segment` matchers the design cites (HEL-656)
   are nested **inside** their own literal prefix (`pathPrefix("pipelines" / PipelineIdSegment)`,
   confirmed in `PipelineRunStatusRoutes.scala`/`PipelineRoutes.scala`), so they can never fire before a
   distinct top-level `"proposals"` prefix is checked. D6's "zero route-mount-order risk" claim holds.

5. **D2/tasks.md 4.2 "dangling ref" structural check — implementability.** Read `ProposalPanel`'s real
   shape and hand-written `proposalPanelFormat` in `DashboardProposalProtocol.scala`: `config:
   Option[JsObject]` is a raw passthrough object, and `panel.toJson.toString.contains(sentinel)` is a
   valid, mechanically implementable substring scan given that shape. But re-deriving the actual
   algorithm this produces surfaced two concrete correctness gaps — see Change Requests 1 and 2.

### Verdict: REFUTE

The composition/ordering/route-mount claims (items 1–4 above) all check out against ground truth. The
one substantive problem is in the "dangling ref" structural pre-check (D2 / tasks.md 4.2), which is the
mechanism implementing the ticket's own explicit AC #4 ("an unresolved/dangling ref is a 400 that
creates nothing"). As literally specified, it has two gaps that no currently-planned test (7.2–7.7)
would catch.

### Change Requests

1. **D2's "blessed position" check must be kind-aware, mirroring `bindingCandidate` exactly (not just
   restated as doing so).** D3 explicitly claims `resolveOutputRefs` "mirrors
   `ProposalPanelSupport.bindingCandidate`'s exact precedence (flat `dataTypeId` first, else
   `config.dataTypeId`)" — but `bindingCandidate` only falls through to `config.dataTypeId` for panel
   types **outside** `DashboardProposalService.DataPanelKinds` (`metric, chart, table, collection,
   timeline` never consult `config.dataTypeId` — confirmed at
   `ProposalPanelSupport.scala:150-158`). D2's structural pre-check (tasks.md 4.2), as written, treats
   `dataTypeId` **and** `config.dataTypeId` as universally blessed for every panel type, with no
   kind-awareness at all.
   Concrete failure: a `chart` panel with `dataTypeId: None` and `config: {"dataTypeId":
   "$pipelineOutput"}` passes 4.2's check (sentinel is in a "blessed" position) and is *not* rejected
   before the pipeline is applied. But `bindingCandidate`/`validatePanel` never look at `config.dataTypeId`
   for a chart panel — `validatePanel` requires the **flat** `dataTypeId` to be non-empty, which stays
   `None` since 4.3's substitution (mirroring the same kind-aware precedence) would also only fall
   through to `config.dataTypeId` for non-`DataPanelKinds` types. The proposal only fails once
   `DashboardProposalService.apply`'s `validateStructure` rejects it — **after** `pipelineProposalService
   .apply` has already created the source/pipeline/steps/run, which then gets rolled back. This
   contradicts spec.md's own Requirement 3 text verbatim ("reject ... before the pipeline proposal is
   ever applied") and produces a confusing error (a generic "chart panel requires a dataTypeId" from the
   dashboard phase, not a "panel 'X': dangling reference to $pipelineOutput" 400 naming the actual
   problem, as AC #4 promises). Fix: make 4.2's "blessed position" computation literally reuse (or
   structurally mirror, panel-type-conditioned) `bindingCandidate`'s logic, not a kind-unaware "either
   slot is fine" check.

2. **D2's presence/absence check must account for multiple occurrences of the sentinel within one
   panel, not just "does it appear at all."** The literal algorithm described ("if the sentinel appears
   anywhere in that panel's JSON serialization (`panel.toJson.toString.contains(...)`) but not in the
   flat `dataTypeId` or `config.dataTypeId` position") reads as two independent boolean checks:
   `appearsAnywhere` and `appearsInBlessedSlot`. If a panel legitimately carries the sentinel in
   `dataTypeId` **and** separately (illegitimately) duplicates the literal string
   `"$pipelineOutput"` in, say, `fieldMapping`, then `appearsAnywhere = true` and `appearsInBlessedSlot =
   true`, so `appearsAnywhere && !appearsInBlessedSlot` evaluates `false` — the dangling occurrence in
   `fieldMapping` is silently masked by the legitimate one in `dataTypeId`, and it is never resolved
   (4.3 only touches the blessed slots) nor rejected. This is a real, if narrow, gap against the ticket's
   own stated guarantee ("any panel where the sentinel appears anywhere ... other than its blessed
   positions" is rejected, per spec.md Requirement 3). Fix: describe an occurrence-exhaustive check —
   e.g. count all occurrences of the sentinel in the panel's serialized JSON and compare against the
   count actually consumed by the blessed slot(s), or strip the blessed slot's value out of the
   serialized string before re-scanning for the sentinel — not a single presence/absence test.

   For both 1 and 2: add explicit task-7.x test scenarios exercising these two cases (sentinel in
   `config.dataTypeId` on a `DataPanelKinds` panel; sentinel duplicated across a blessed and unblessed
   slot on the same panel) so a fix is actually verified rather than merely described.

### Non-blocking notes

- Tasks.md 4.4's literal snippet `panels.map(PanelResponse.fromDomain)` will not compile as written:
  `PanelResponse.fromDomain(panel: Panel, dataAsOf: Option[String] = None)` takes a defaulted second
  parameter, and Scala does not eta-expand that into a bare `Panel => PanelResponse` value — every
  existing call site in this codebase (`DashboardRoutes.scala:62`, `DashboardContentsRoutes.scala:36`,
  `PanelRoutes.scala:33/45`, `DashboardSnapshotRoutes.scala:39`, `DashboardProposalRoutes.scala:36`)
  instead wraps it in an explicit lambda, `panels.map(p => PanelResponse.fromDomain(p))`. Trivial fix,
  but worth correcting in tasks.md so the executor doesn't have to rediscover the codebase's own
  established pattern.
- Tasks.md 6.4 attributes `panelSchema`/the `dashboardName` shape to `write.ts`; both actually live in
  `proposal.ts` (`export const panelSchema` at `proposal.ts:64`; `dashboardName: z.string().min(1)` is
  inlined twice inside `proposal.ts`'s `propose_dashboard`/`apply_proposal` tools, not a named export at
  all — `write.ts` merely re-imports `panelSchema` from `proposal.ts` for its own use). Not a soundness
  issue (the shapes exist and are reusable), just a misattributed source file that will send the
  executor to the wrong place first.
