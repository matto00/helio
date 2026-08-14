## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Scope/diff re-established independently.** `git diff origin/main...HEAD --stat` inside
  `WORKTREE_PATH`: 32 files, 4129 insertions, matches `evaluation-1.md`'s claimed scope exactly
  (`d309b380` main vs `9c9aa73c` origin/main vs `6f4dc23d` HEAD). Read every non-planning source
  file in the diff (`PatchSetApplyTypes/Resolvers/Forward/Rollback/Service.scala`,
  `PatchSetApplyProtocol.scala`, `PatchSetProtocol.scala`'s D6 change, `PatchSetRoutes.scala`,
  `ApiRoutes.scala`/`JsonProtocols.scala` wiring) in full, not sampled.

- **Design-gate decisions cross-checked against real source, not re-trusted from design.md's own
  prose.** Read `PanelService.scala`, `DashboardService.scala`, `PipelineService.scala`,
  `PipelineRepository.scala` directly and confirmed the resolvers mirror each kind's real ACL rule
  byte-for-byte: `PanelService.authorizeEditorOnDashboard` ==
  `PatchSetApplyResolvers.authorizeEditorOnDashboard`; `DashboardService.update` (sharing-aware
  `findById` + `accessChecker`, editor-or-owner) vs `.delete` (owner-only, no `accessChecker`) are
  correctly split into `resolveDashboardUpdate`/`resolveDashboardDelete` with genuinely different
  logic; `PipelineService.updateStep`/`deleteStep`'s `findByIdShared` + `requireEditorAccess`
  (`findGrantRole == "editor"`) pattern is reproduced exactly in
  `authorizeEditorOrOwnerOnPipeline`; `PipelineRepository.create`'s
  `dataSourceRepo.findByIdOwned(sourceDataSourceId, ...)` (line 210) is mirrored in
  `resolvePipelineCreate`. D2a's embedded-reference checks (`rejectCompanionBinding`/
  `rejectUnresolvableMetric`, Join/Union/Lookup pre-flight `DataSource` ACL) are line-for-line
  copies of `PanelService.scala:483-524` / `PipelineService.scala:568-597`. This confirms
  `evaluation-1.md`'s Phase 1 claims are accurate, not overclaimed.

- **`sbt test` re-run fresh, targeted at this ticket's own specs**:
  `PatchSetApplyServiceSpec`/`PatchSetProtocolSpec`/`PatchSetRoutesSpec` — **40/40 passed**,
  reproducing the evaluator's claim for this slice. (Did not re-run the full 2648-test suite; no
  reason to doubt the evaluator's full-suite figure given this slice reproduces cleanly and the
  diff touches no other test file.)

- **A concrete, reproduced defect in the rollback path's central correctness guarantee** (see
  Change Request 1 below) — found by reading `PatchSetApplyRollback.scala`'s panel-update
  compensation against `PanelConfigCodec.scala`/`ChartPanel.scala`/`MetricPanel.scala`/
  `TablePanel.scala`, then **reproduced independently via `sbt console`** (a read-only probe script
  in the scratchpad dir, never touching the repo) rather than asserted from reading alone.

### Change Requests

1. **`PatchSetApplyRollback.fullPanelInverse`'s panel-update rollback does NOT actually restore a
   panel's `config` `Option` sub-fields whenever the prior value was `None` and the forward-applied
   edit set it to `Some(...)` — the edit is reported `"rolledBack"` while the panel silently keeps
   the un-rolled-back value.** This directly contradicts ticket.md AC1 ("a failure rolls back every
   already-applied edit … verified by test asserting original states restored") and design.md D3's
   explicit claim ("reapply it as a full-overwrite inverse `Update*Request` (every field populated,
   not just the ones the forward edit changed)").

   **Root cause** (`PatchSetApplyRollback.scala:239-245`):
   ```scala
   private def fullPanelInverse(prior: Panel): UpdatePanelRequest =
     UpdatePanelRequest(
       title      = Some(prior.title),
       appearance = Some(fullPanelAppearancePatch(prior.appearance)),
       `type`     = None,
       config     = Some(PanelConfigCodec.encodeConfig(prior))   // <-- bug
     )
   ```
   `PanelConfigCodec.encodeConfig(prior)` (`PanelConfigCodec.scala:24`) calls `.toJson` on the
   typed config (e.g. `ChartPanelConfig`, `MetricPanelConfig`, `TablePanelConfig`), all of which use
   plain `jsonFormatN` (not `NullOptions`). Per spray-json's `ProductFormats.productElement2Field`
   (`spray-json_2.13-1.3.6`), a case-class field whose writer is an `OptionFormat` and whose value is
   `None` is **omitted from the JSON object entirely** — not written as `null`. On the receiving
   side, `PanelConfigCodec.applyConfigPatch` → each subtype's `*Config.Patch.decode` (e.g.
   `ChartPanelConfig.Patch.decode`, `ChartPanel.scala:259-303`) treats an **absent** key as "leave
   unchanged" (merges onto the panel's CURRENT, post-forward-edit state — not a blank object). So
   any `Option` config field that was `None` in the captured prior state (the common case — e.g. no
   `aggregation`/`chartOptions`/`annotation`/`metricId`/`label`/`unit`/`density`/`columnOrder` bound
   yet) but was set to `Some(...)` by the very forward edit being rolled back is **left unchanged by
   the "rollback."**

   This exact failure mode (spray-json omitting `None` on write, colliding with absent-means-
   unchanged patch semantics) is one the author was explicitly aware of and fixed for
   `PanelAppearance.chart` two lines above (`fullPanelAppearancePatch`,
   `PatchSetApplyRollback.scala:227-237`, with an inline comment: *"Explicit `chart: null` (not an
   omitted key) … absent key means unchanged, which would fail to clear a chart the forward edit
   added"*) — but the identical fix was never applied to `config`.

   **Independently reproduced** (not asserted from reading alone) via `sbt console` against the
   actual compiled classes (script never modified any repo file):
   ```
   val priorConfig = MetricPanelConfig(DataTypeId("dt-1"), JsObject("f"->JsString("x")), aggregation=None, ...)
   val encoded = PanelConfigCodec.encodeConfig(priorPanel)
   // => {"dataTypeId":"dt-1","fieldMapping":{"f":"x"}}   -- "aggregation" key is GONE, not null

   // Simulate "current" state = post-forward-edit, aggregation now Some(...):
   val currentPanel = priorPanel.copy(config = priorConfig.copy(aggregation = Some(JsObject("op"->JsString("sum")))))
   val result = PanelConfigCodec.applyConfigPatch(currentPanel, encoded)
   // => Right(MetricPanelConfig(..., aggregation = Some({"op":"sum"}), ...))
   //    aggregation is UNCHANGED -- rollback did NOT restore it to None.
   ```
   This confirms the panel would be reported `"rolledBack"` in `PatchSetApplyResponse` while its
   actual DB state still carries the forward edit's mutation — the exact silent-non-restoration
   failure mode AC1 requires the ticket to prevent.

   This is not a narrow edge case: it recurs for every `Option`-typed config field across panel
   subtypes I checked (`MetricPanelConfig.{aggregation,label,unit,metricId,metricDeprecated}`,
   `ChartPanelConfig.{aggregation,chartOptions,annotation,metricId,metricDeprecated}`,
   `TablePanelConfig.{density,columnOrder,metricId,metricDeprecated}`) — i.e. the common shape of
   "bind this panel to a data type / add an aggregation / set a metric" edits inside a patch set
   that later needs to roll back.

   **Why the existing tests didn't catch it**: `PatchSetApplyServiceSpec.scala`'s only panel-update
   rollback coverage is test 7.3 (`"roll back every already-applied edit on a mid-set failure"`),
   which only exercises `UpdatePanelRequest(Some("Changed title"), None, None, None)` — title only,
   `config = None`. No test in the file (grepped for `aggregation`/`chartOptions`/`fieldMapping`/
   `metricId`/`config =` in a panel-update context) exercises a `config` field transitioning
   None→Some under an edit that then gets rolled back — precisely the case ticket.md's own Tests
   section names as the bar ("assert every touched resource is back to its original state").

   **Requested fix**: apply the same treatment already used for `appearance.chart` to `config` —
   either build the "full-overwrite inverse" config JSON manually so every `Option` field is written
   explicitly (`Some(x) -> value`, `None -> JsNull`) instead of routing through the default
   `.toJson`, or mix `NullOptions` into the relevant config formats for this write path. Add a
   regression test: seed a panel with an unset optional config field (e.g. no `aggregation`), apply
   a patch set whose first edit sets it via the panel-update, whose second edit fails, and assert
   the rolled-back panel's `aggregation` (or equivalent) is genuinely back to unset/`None` after
   rollback — not just that `status == "rolledBack"`.

### Non-blocking notes

- `PatchSetApplyResolvers.scala` at 690 lines is well past CONTRIBUTING.md's soft budget; the
  evaluator already flagged this as a disclosed, accepted follow-up given regression risk this late
  in an 8-round-reviewed change. I agree this is reasonable to defer, but flag it should not be
  deferred indefinitely once Change Request 1 forces a re-touch of the sibling rollback file anyway.
- The `dataSource`/`pipeline` update rollbacks are genuinely name-only (`UpdateDataSourceRequest`/
  `UpdatePipelineRequest` each carry exactly one field), so they are not exposed to this same
  omitted-`Option`-field class of bug — confirmed by reading `DataSourceProtocol.scala:106` and the
  `PipelineUpdate` rollback's `UpdatePipelineRequest(name = prior.name)`. `dataType`'s inverse
  (`fullDataTypeInverse`) also isn't exposed — `DataFieldPayload`/`ComputedFieldPayload` have no
  `Option`-typed fields. `dashboard`'s inverse (`fullDashboardInverse`) constructs
  `DashboardAppearancePayload`/`DashboardLayoutPayload` directly with explicit `Some(...)` wrapping,
  not via `.toJson`, so it is also unaffected. This bug is isolated to the panel `config` rollback
  path specifically — but that is also the single richest, most commonly-exercised update surface
  of the six kinds this ticket supports.

### Verdict: REFUTE
