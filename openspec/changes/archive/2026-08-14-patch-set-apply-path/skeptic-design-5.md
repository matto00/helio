## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

**1. Re-verified the round-4 fix (the specific ask): tasks.md 7.9 / specs/patch-set-apply/spec.md's
dataTypeId+metricId scenario text against `PanelService.scala:476-524`.**

Read `PanelService.scala` in full (worktree copy). Confirmed:
- `rejectCompanionBinding` (`PanelService.scala:483-495`): `dataTypeRepo.findByIdOwned(dataTypeId, user)`
  — `Some(dt) if dt.sourceId.isDefined` → reject ("Panels can only bind to pipeline-output data
  types"); every other case (`None` = foreign-owned or nonexistent, or `Some(dt)` with `sourceId`
  empty = pipeline-output) → `Right(())`, passes through unchanged.
- `rejectUnresolvableMetric` (`PanelService.scala:508-524`): `metricRepo.findByIdOwned(metricId, user)`
  — `None` (foreign-owned or nonexistent) → actively rejected ("metricId does not resolve to a
  metric you own"); `Some(metric)` then re-checks the bound DataType's `sourceId.isEmpty`.

tasks.md 7.9's corrected bullets ("a dataTypeId the caller OWNS but that is a companion
(non-pipeline-output) type is rejected... a foreign-owned or nonexistent dataTypeId is NOT rejected...
passes through unchanged" / "a metricId the caller does NOT own (or that doesn't resolve) is
rejected... unlike dataTypeId, rejectUnresolvableMetric DOES actively reject a foreign/nonexistent
reference") and specs/patch-set-apply/spec.md's two matching scenarios (lines 49-61) now match this
source exactly. The round-4 fix is correct.

**2. Broad pass over design.md/tasks.md/both spec deltas for the same defect category (mirrored-check
text vs. real behavior) elsewhere in the artifact set** — cross-checked every "mirrors X" claim
against the actual source it cites:
- `PanelService.create`'s `dashboardId` ACL (`PanelService.scala:176`, `accessChecker.requireAccess`,
  Viewer→403 else proceed) — matches D2a bullet 1 / task 3.2 bullet 1 exactly.
- `PipelineRepository.create`'s `sourceDataSourceId` ACL (`PipelineRepository.scala:212`,
  `dataSourceRepo.findByIdOwned`) — matches D2a bullet 2 / task 3.2 bullet 2 exactly.
- `PipelineService.addStep`/`updateStep`'s Join/Union/Lookup pre-flight ACL
  (`PipelineService.scala:448-484` / `568-597`, `dataSourceRepo.findByIdOwned` on
  `rightDataSourceId`/`otherDataSourceId`/`referenceDataSourceId`) — matches D2a bullet 4 / task 3.2
  bullet 4 / task 7.9's third bullet exactly.
- `DashboardService.update` (sharing-aware, editor-or-owner, `DashboardService.scala:123-145`) vs.
  `DashboardService.delete` (owner-only, no `accessChecker` call at all, `:86-97`) — matches D2's
  dashboard update/delete split exactly, including task 7.4's and spec.md's editor-grantee
  update-accepted / delete-rejected scenario pair.
- `PanelService.update`/`delete` and `PipelineService.updateStep`/`deleteStep` — confirmed identical
  ACL rule between update and delete for both kinds, as claimed.
- `DataTypeService.scala` — confirmed only `update`(:69)/`delete`(:127), no `create` method.
- `DataSourceService.scala` — confirmed exactly 8 `create*` methods; `SourceService.scala` — confirmed
  `createSql`(:43)/`createRest`(:64) live on the separate class as claimed.
- `PipelineStepRepository.scala:44`'s own doc comment ("Owner-scoped findById via the parent-pipeline
  JOIN") — matches Context's characterization verbatim.
- `DashboardRoutes.scala`'s post-create comment ("`created = false` means... nothing was created") —
  matches D3a/Context's citation.
- Cascade-delete migrations (`V2__cascade_delete.sql` dashboards→panels, `V22__pipelines.sql`
  data_sources→pipelines, `V23__pipeline_steps.sql`/`V24__pipeline_runs.sql` pipelines→steps/runs) —
  confirmed, backs D1's "unrecoverable" (cascades) rationale for dashboard/dataSource/pipeline.
- `PatchSetProtocol.scala`'s current `Edit.read` (`:82-134`, worktree copy, pre-implementation) —
  confirmed the `delete` branch reads `patch` into a local val but never inspects it in the `op ==
  "delete"` match arm (falls through to the all-`None` case) — the silent-drop D6/task 1.1 is fixed
  against is real and still present pre-implementation, as claimed.

No further scenario/test-text-vs-real-behavior mismatches found in this pass.

**3. New finding — an explicit ticket AC and Scope item is unaddressed by the design.**
`ticket.md` Scope (line 28): "Emit the captured prior-state set so the undo ticket can consume it
(shared shape)." `ticket.md` AC (line 41, unchecked): "Prior-state capture is emitted in a shape the
undo ticket can consume." Cross-checked against design.md's D3/D4 and tasks.md 2.1/2.2/5.1:
- D4's response shape (design.md:169-171) is `PatchSetApplyResponse{ edits:
  [EditOutcome{index, status, newId: Option[String]}], failure: Option[String] }` — no field carries
  any captured prior-state data.
- Task 2.1 (tasks.md:10-13) defines the exact same three-field `EditOutcome` — confirms this isn't a
  design.md/tasks.md transcription slip; both artifacts agree on the same field-incomplete shape.
- D3's "capture the pre-mutation full state" (design.md:146) is described purely as an
  internal mechanism consumed by this SAME apply call's own rollback compensation on a mid-set
  failure — never as data returned to the caller.
- Grepped design.md/tasks.md for `undo`, `persist`, `store the`, `capture` — no decision anywhere
  addresses: what shape the emitted "prior-state set" takes, whether it rides in the synchronous
  `PatchSetApplyResponse` (on the `applied` success path, not just failure/rollback) or is persisted
  server-side for a later out-of-band undo call, or how a heterogeneous per-kind full-resource
  snapshot (`Panel`/`Dashboard`/etc.) would serialize into one shared response field.
- Not a documented cut either: proposal.md's Non-Goals list "Diff/impact preview and undo (sibling
  tickets)" but that's about NOT *executing* an undo — the Scope bullet is explicit that *emitting the
  shape the sibling undo ticket will consume* is squarely this ticket's own job, unlike round 1-4's
  now-resolved ACL/rollback gaps, this AC has no corresponding Decision, task, or response field at
  all — it simply never got designed.

### Verdict: REFUTE

### Change Requests

1. **design.md / tasks.md / specs/patch-set-apply/spec.md — add a design decision + task(s) for
   emitting the captured prior-state set (ticket.md Scope bullet 4 / unchecked AC).** Decide and
   document: (a) the field(s) `EditOutcome`/`PatchSetApplyResponse` need to carry each edit's
   pre-mutation full state (e.g. a `priorState: Option[JsValue]` alongside `index`/`status`/`newId`,
   present at minimum for every `applied`/`rolledBack`/`recreated` edit, not only on the internal
   rollback path); (b) whether this rides in the same synchronous apply response or is persisted for
   a separate later retrieval by the undo ticket — the ticket's own Scope bullet phrasing ("Emit...
   so the undo ticket can consume it") reads as the former, but the design must say so explicitly;
   (c) update D4's response shape, task 2.1's `EditOutcome` field list, task 2.2's schema, and add a
   spec.md scenario asserting the emitted shape (mirroring the existing `newId`-on-`recreated`
   scenario's pattern) — or, if the human/planner decides this is genuinely out of scope for v1,
   an explicit Non-Goal entry addressing this SPECIFIC Scope bullet/AC by name (not merely the
   existing "undo (sibling ticket)" Non-Goal, which is about not *executing* undo, not about not
   *emitting the data* undo will need) plus a ticket.md AC amendment — silent omission is not
   acceptable given this is a named, unchecked AC.

### Non-blocking notes

- None beyond the above — the ACL/rollback design (D1-D3a, D6) that rounds 1-4 hardened is now
  internally consistent and, everywhere I checked it against source, accurate.
