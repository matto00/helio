## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, the full current `design.md`, `tasks.md`, and all four spec deltas
  (`patch-set-undo`, `patch-set-apply`, `patch-set-preview`, `mcp-patch-set-tools`) fresh from the
  worktree, plus round 1's and round 2's `skeptic-design-{1,2}.md` (treated as claims to re-verify,
  not fact).

**Re-verification target 1 — D4a's panel `config` decomposition (round 2 CR1 fix).**

- Read `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` in full
  (`backend/src/main/scala/com/helio/domain/panels/{MetricPanel,ChartPanel,TablePanel}.scala`) and
  `PanelServiceHelpers.withMaterializedMetric` (`PanelServiceHelpers.scala:276-299`). Confirmed:
  `metricDeprecated` exists on all three configs and is genuinely never read by any `*Config.Patch`
  case class (`MetricPanelConfig.Patch` has 6 fields — `dataTypeId/fieldMapping/aggregation/label/
  unit/metricId` — no `metricDeprecated`; same for `ChartPanelConfig.Patch`/`TablePanelConfig.Patch`)
  — design.md's "server-materialized and never decoded from a patch at all" claim for
  `metricDeprecated` holds.
- **But the four "metric-materialized effective fields" design.md strips alongside it
  (`dataTypeId`/`fieldMapping`/`aggregation`/`unit`) are NOT in that same category — they ARE real,
  patch-decodable, independently-settable raw fields.** `MetricPanelConfig.Patch` (`MetricPanel.scala:
  78-88`) has `dataTypeId: Option[Option[DataTypeId]]`, `fieldMapping: Option[Option[JsObject]]`,
  `aggregation: Option[Option[JsObject]]`, `unit: Option[Option[String]]` as real, decoded, applied
  fields (`MetricPanelConfig.Patch.decode`, `MetricPanel.applyPatch`, `MetricPanel.scala:171-180`) —
  a plain `PATCH /api/panels/:id` with `config: {dataTypeId: "..."}\` and no `metricId` key sets a raw
  override while leaving `metricId` untouched. `PanelServiceHelpers.withMaterializedMetric`
  (`PanelServiceHelpers.scala:276-293`) confirms the override semantics: `effectiveDataTypeId = if
  (mp.config.dataTypeId.value.nonEmpty) mp.config.dataTypeId else metric.dataTypeId` (identically for
  `fieldMapping`/`aggregation`/`unit`) — i.e. **when the raw field is present it IS the effective
  value**, verbatim; the two are the same JSON key, indistinguishable once materialized.
- Design.md's own justification for stripping these four fields (`design.md:100-102`): "This mirrors
  exactly what the Patch decoder itself already does (ignore these fields)." **This is factually false
  for 4 of the 5 fields being stripped** — only `metricDeprecated` is genuinely ignored by the Patch
  decoder; `dataTypeId`/`fieldMapping`/`aggregation`/`unit` are real, settable, patch-decodable fields.
  The false premise is the tell for a real soundness gap, not just an imprecise citation.
- **Concrete false-negative scenario this produces:** a `MetricPanel` bound to `metricId=X` with raw
  `dataTypeId` empty at apply time (`effectiveDataTypeId` = metric X's `dataTypeId`, say `DT1`) is
  edited by an undo-target patch-set edit, journaled with `resultingState.config.dataTypeId = DT1`
  (materialized, per round 1/2's confirmed capture path — `PatchSetApplyForward.scala:28-30` →
  `panelService.update` → `resolveSingleBinding`). Later, a **different, unrelated** edit (a manual
  PATCH, or a separate agent session) sets a raw override `config: {dataTypeId: "DT2"}` on the SAME
  panel, with `metricId` still `X` (this is a supported, real, independent operation — no coupling
  rule forces `metricId` to change when the raw trio changes; confirmed no such validation in
  `PanelService.scala`'s `metricId`-related code, lines 76-155/497-521). At undo time, D4a's fix
  strips `dataTypeId`/`fieldMapping`/`aggregation`/`unit` from BOTH sides whenever `metricId` is set —
  which it is, unchanged, on both sides here — so the conflict check has **nothing left to compare**
  for this field and the genuine, real edit (`DT1` → `DT2`) is silently invisible. Undo proceeds,
  overwriting the caller's `DT2` back to the pre-apply value with **no conflict reported** — the exact
  "confidently wrong instead of visibly rejected" failure class D4b explicitly rejects
  restore-with-warning over (`design.md:104-107`), reintroduced here for a real, in-scope subset of
  MetricPanel edits. Note this is a *regression relative to a naive (pre-fix) field-scoped compare*:
  before stripping, `DT1` vs `DT2` would have been correctly caught as a conflict — the round-3 fix
  is what removes that catch.
- This is a genuinely narrower gap than round 1/2's (only affects `MetricPanel` — `ChartPanel`/
  `TablePanel` never materialize these four fields, confirmed via `withMaterializedMetric`'s `cp`/`tp`
  branches only setting `metricDeprecated`; and only when `metricId` is unchanged across apply→undo
  while a raw override on the same four fields changes), but it is real, not hypothetical, and
  violates `specs/patch-set-undo/spec.md`'s binding Requirement 2 text ("restricted to the fields that
  edit's own restore would touch" — these four fields ARE such fields for a MetricPanel — "any
  mismatch SHALL refuse the entire undo") for that subset.
- Also confirmed: `specs/patch-set-undo/spec.md`'s only "unrelated field ... not a conflict" scenario
  (lines 35-39) is pipeline-specific; no scenario documents the metric-panel `metricDeprecated`/
  effective-field exclusion the design's own D4a prose claims to have added — the same "corroborating
  tell" round 2 flagged for the whole-blob bug still applies to this narrower, still-live gap.

**Re-verification target 2 — Phase-2 spec/design reconciliation (round 2 CR2 fix).**

- `specs/patch-set-undo/spec.md`'s Requirement 1 (lines 3-8) now reads: "...restore every edit ... or
  restore none of them, for every condition detectable before any restore begins (a conflict, or a
  structurally-unrecoverable delete edit) — see the separate requirement below for the narrower
  guarantee that applies only to a genuine, undetectable-in-advance restore failure." This explicitly
  scopes the atomicity guarantee and points to the new Requirement 4.
- Requirement 4, "An unforeseeable restore failure SHALL report an honest partial outcome" (lines
  53-65), matches design.md D4's Phase-2 carve-out verbatim in spirit: stop the walk, report
  not-yet-attempted edits as `notAttempted`, never compensate what Phase 2 already restored. tasks.md
  5.3's "a Phase-2 runtime failure reports remaining edits `notAttempted` without un-restoring what
  Phase 2 already completed" now has a spec requirement + scenario to point to.
- **Confirmed genuinely reconciled** — no residual contradiction between Requirement 1's (now
  qualified) text and Requirement 4's carve-out. This fix holds.

**Fresh whole-design pass (per this round's brief, not limited to the 3 named fix points).**

- D1/D2/D3: re-confirmed V79 is still the correct next-unclaimed Flyway version (`ls backend/.../db/
  migration` tops out at `V78__refinement_conversations.sql`); `EditOutcome`
  (`PatchSetApplyProtocol.scala:33-39`, doc comment lines 6-13/17-27) confirmed to carry exactly
  `index/status/newId/priorState/resultingState` — matches D1's claim that `targetKind`/`op` must be
  threaded through separately by `PatchSetApplyService` (still true, `EditOutcome` has neither). D3's
  new SQL-shape addition ("a single atomic `DELETE ... NOT IN (SELECT top-N)`, mirroring
  `PipelineRunRepository.deleteOldRunsInternal`") matches that repository's real shape from round 2's
  citation — accurate, addresses round 2's non-blocking suggestion.
- Spot-checked the five non-panel kinds' response shapes for hidden dynamic sub-fields (unaffected by
  this round's changes, but re-verified independently rather than trusting round 2's citations
  outright): `DataTypeResponse` (`DataTypeProtocol.scala:11-21`) carries `version`/`tag` beyond the
  restored `name/fields/computedFields` set, but D4a's comparison is explicitly scoped to only the
  restored fields, so these are correctly excluded by construction, not by omission. `DashboardResponse`
  (`DashboardProtocol.scala:26-33`) has no fields beyond `name`/`appearance`/`layout`/`meta`/`ownerId`,
  and `meta`/`ownerId` aren't restored fields either — clean. No new gap found here.
- Checked `ResolvedAction`'s sealed-trait cases (`PatchSetApplyTypes.scala:34-57`) to confirm which
  kinds support a `create` op for undo purposes: `PipelineStepUpdate`/`PipelineStepDelete` only — no
  `PipelineStepCreate` case exists (consistent with `PatchSetApplyRollback.scala`'s "(no create —
  design.md D1)" comments for both `dataType` and `pipelineStep`). This makes tasks.md 5.3's phrase
  "panel/pipelineStep delete/create edits" read as testing a `pipelineStep`-create-edit-undo scenario
  that cannot exist in the model — a minor wording imprecision (see non-blocking notes), not a design
  contradiction, since the intent (test panel create+delete undo, pipelineStep delete undo) is
  inferable from context.
- Checked whether D4/D5's Phase-2 walk explicitly names the delete-call-on-undo-of-a-`create`-edit
  mechanism (mirroring `PatchSetApplyRollback`'s `PanelCreate`/`DashboardCreate`/etc. cases, which
  compensate via `.delete(...)` using `forwardOutcome.newId`). Design.md's Phase-2 text
  ("restoring each via the SAME per-kind service method rollback already uses (`panelService.update`,
  `dashboardService.update`, ...)") only gives `update`-method examples before trailing off with
  "...". Given the design's constant, explicit "mirrors `PatchSetApplyRollback`" framing throughout
  D4/D5 and D1's own capture of `newId` per edit (needed for exactly this), this is inferable but not
  spelled out — a minor completeness gap, not a contradiction (see non-blocking notes).
- No other new gaps found in D2, D6, or the frontend/MCP surfaces this round — D6's `duration: 0` fix
  (round 1) and the delete-edit Phase-1-blocker fix (round 1→2) both remain intact and unchanged by
  this round's edits.

### Verdict: REFUTE

### Change Requests

1. **(Blocking — real spec violation, narrow scope) D4a's fix for the metric-bound-panel false-positive
   (round 2 CR1) over-corrects: stripping `MetricPanel`'s four metric-materialized effective fields
   (`dataTypeId`/`fieldMapping`/`aggregation`/`unit`) from the conflict check whenever `metricId` is
   set silently masks a real, independently-introduced conflict on those SAME fields when a raw
   override is set (or changed) on a `metricId`-bound panel between apply and undo — a supported,
   real operation (see evidence above). This violates `specs/patch-set-undo/spec.md`'s binding
   Requirement 2 ("restricted to the fields that edit's own restore would touch ... any mismatch
   SHALL refuse the entire undo") for that subset, and reintroduces the exact silent-overwrite failure
   class D4b explicitly rejected restore-with-warning over. Design.md's own justification for the
   strip ("mirrors exactly what the Patch decoder itself already does (ignore these fields)") is
   factually wrong for these four fields — only `metricDeprecated` is genuinely patch-ignored; the
   other four are real, independently-settable, patch-decodable raw fields whose materialized value
   equals the raw value whenever the raw value is present. The root cause is structural: `resultingState`
   is captured via a *materialized* read (`resolveSingleBinding`), so a raw override and a
   metric-derived value are byte-identical/indistinguishable once written to the journal — there is no
   data currently captured that lets the conflict check tell them apart.
   **Required revision — pick one, document the choice and its trade-off explicitly in design.md
   (mirroring D4b's rigor), and add/adjust the matching spec.md scenario:**
   - (a) *Accept the gap as a documented v1 limitation.* Add it to design.md's Risks/Trade-offs
     alongside the other three already-acknowledged risks (recreate-under-new-id, reimplemented-
     inverse-builder regression, retention-floor exhaustion), correct the false "mirrors the Patch
     decoder" justification, and add a spec.md scenario/carve-out stating explicitly that a raw-field
     edit on a metric-bound `MetricPanel`, made independently since the original apply, is not
     detected as a conflict when `metricId` is unchanged — so this is a *named* exception, not a
     silent one, consistent with how the Phase-2 carve-out (CR2, round 2) was handled. **or**
   - (b) *Fix it properly*: have `PatchSetApplyForward`/`PatchSetApplyService` additionally capture an
     UNmaterialized (bare, pre-`resolveSingleBinding`) `config` snapshot for `panel` `resultingState`
     entries (mirroring how `priorState` is already captured via the bare `ctx.panelRepo.
     findByIdInternal` path per round 1/2's confirmed citation), so the conflict check can compare
     raw-vs-raw for these four fields — genuinely distinguishing a raw override from metric-derived
     noise instead of stripping both. This is a real (if bounded) scope addition to D1/D2 beyond
     "reuse what the apply path already produces," so it needs an explicit design.md decision, not an
     implicit assumption.
   Either path is materially smaller in scope than rounds 1-2's findings — this does not require
   revisiting the overall two-phase mechanism, only D4a's specific field-exclusion mechanics and a
   matching spec update.

### Non-blocking notes

- tasks.md 5.3's phrase "for update edits (all six kinds) and for panel/pipelineStep delete/create
  edits" reads as covering a `pipelineStep`-create-edit-undo test case, but no `create` op exists for
  `pipelineStep` in the patch-set edit model (`ResolvedAction` has only `PipelineStepUpdate`/
  `PipelineStepDelete`, `PatchSetApplyTypes.scala:56-57`; `PatchSetApplyRollback.scala`'s own comment
  confirms "no create — design.md D1"). Worth rewording to "panel create/delete edits and pipelineStep
  delete edits" so the executor doesn't attempt to test a non-existent edit type.
- D4/D5's Phase-2 restore-walk prose ("restoring each via the SAME per-kind service method rollback
  already uses (`panelService.update`, `dashboardService.update`, ...)") gives only `update`-method
  examples; the delete-call used to undo a `create` edit (mirroring `PatchSetApplyRollback`'s
  `PanelCreate`/`DashboardCreate`/etc. compensation via `.delete(newId)`) is inferable from the
  design's repeated "mirrors `PatchSetApplyRollback`" framing and D1's capture of `newId`, but isn't
  spelled out explicitly. Worth one clarifying clause so this isn't left to inference.
- No new spec.md scenario documents the metric-bound-panel `metricDeprecated` exclusion itself (only
  the pipeline `lastRunStatus`/`lastRunAt`/`lastRunRowCount` exclusion has a scenario) — once CR1 above
  is resolved, the chosen behavior for the panel case should get its own scenario too, for the same
  reason the pipeline case did.
