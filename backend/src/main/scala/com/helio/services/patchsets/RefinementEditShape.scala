package com.helio.services.patchsets

/** Hand-maintained `PatchSet`/`Edit` shape description + worked JSON examples for `RefinementPrompt`
 *  (design.md D2a — "the ticket's central technical bet"). Split into its own file (not inlined into
 *  `RefinementPrompt`) purely to keep both files under CONTRIBUTING's ~250-line soft budget — this
 *  file carries zero orchestration logic, only the static prompt text.
 *
 *  WHY this is load-bearing, not incidental (design.md D2a): `PatchSetProtocol.editFormat` collapses
 *  a discriminated union onto ONE shared `"patch"` wire key, dispatched by the sibling `target.kind`
 *  into one of six `Update*Request` shapes — materially harder for an LLM to produce reliably than
 *  `DashboardProposal`'s flat `jsonFormat2` shape (`DashboardAuthoringPrompt.ProposalShapeDescription`).
 *  Every worked example below is a REAL, valid `Edit` — verified against `PatchSetProtocol.editFormat`'s
 *  reader and each target kind's actual `Update*Request`/panel-config `Patch.decode` (`PanelProtocol`,
 *  `DashboardProtocol`, `DataSourceProtocol`, `DataTypeProtocol`, `PipelineProtocol`,
 *  `PipelineStepProtocol`, `domain.panels.*PanelConfig.Patch`) — not paraphrased shapes. */
object RefinementEditShape {

  private val Skeleton: String =
    """{
      |  "summary": "string, optional — a short human-readable description of this patch set",
      |  "edits": [
      |    {
      |      "target": { "kind": "panel | dashboard | dataSource | dataType | pipeline | pipelineStep", "id": "string — REQUIRED for update/delete (a REAL id from the state below); OMIT for create" },
      |      "op": "update | delete | create",
      |      "patch": "object — REQUIRED for update/create; MUST be absent entirely for delete. Shape depends on (target.kind, op) — see the worked examples below."
      |    }
      |  ]
      |}""".stripMargin

  // pipelineStep worked examples (skeptic-final-1.md finding, D2a's pipelineStep gap) — three of
  // the ~17 step kinds, each its own `private[services]` val for the same `RefinementEditShapeSpec`
  // regression-guard reason the panel examples are: "rename" (the original, simplest example) plus
  // "aggregate"/"groupby" — TWO similarly-named but STRUCTURALLY DIFFERENT step kinds
  // (`AggregateConfig`/`GroupByConfig`, `backend/.../domain/steps/{AggregateStep,GroupByStep}.scala`)
  // whose decoders silently DROP an unrecognized key instead of raising (confirmed: `AggregateConfig.
  // decode`'s `items.flatMap(it => Try(it.convertTo[...]).toOption)` — a shape-mismatched item
  // vanishes, never an error `PatchSetPreviewService.preview` could catch). A plausible-looking but
  // wrong key set here silently empties the step's real behavior even though `preview`/apply both
  // return success.
  private[services] val RenameStepExample: String =
    """{ "target": { "kind": "pipelineStep", "id": "step_def" }, "op": "update", "patch": { "config": { "renames": { "old_column_name": "new_column_name" } } } }"""

  private[services] val AggregateStepExample: String =
    """{
      |  "target": { "kind": "pipelineStep", "id": "step_ghi" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "groupBy": [ { "name": "region", "type": "string" } ],
      |      "aggregations": [ { "alias": "total_amount", "fn": "avg", "field": "amount" } ]
      |    }
      |  }
      |}""".stripMargin

  private[services] val GroupByStepExample: String =
    """{
      |  "target": { "kind": "pipelineStep", "id": "step_jkl" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "groupBy": [ "region" ],
      |      "aggColumn": "amount",
      |      "aggFunction": "avg"
      |    }
      |  }
      |}""".stripMargin

  /** One worked `Edit` per `target.kind`, `op: "update"` — the `"patch"` key's shape reuses each
   *  domain's real `Update*Request` verbatim (never a shape invented for this prompt). */
  private val UpdateExamples: String =
    "dashboard (patch reuses UpdateDashboardRequest — name/appearance/layout, all optional):\n" +
      "{ \"target\": { \"kind\": \"dashboard\", \"id\": \"dash_123\" }, \"op\": \"update\", \"patch\": { \"name\": \"Q3 Revenue Overview\" } }\n\n" +
      "dataSource (patch reuses UpdateDataSourceRequest — name only):\n" +
      "{ \"target\": { \"kind\": \"dataSource\", \"id\": \"src_456\" }, \"op\": \"update\", \"patch\": { \"name\": \"Stripe export\" } }\n\n" +
      "dataType (patch reuses UpdateDataTypeRequest — name/fields/computedFields, all optional):\n" +
      "{ \"target\": { \"kind\": \"dataType\", \"id\": \"type_789\" }, \"op\": \"update\", \"patch\": { \"name\": \"Customer Orders\" } }\n\n" +
      "pipeline (patch reuses UpdatePipelineRequest — name only, required):\n" +
      "{ \"target\": { \"kind\": \"pipeline\", \"id\": \"pipe_abc\" }, \"op\": \"update\", \"patch\": { \"name\": \"Daily revenue rollup\" } }\n\n" +
      "pipelineStep (patch reuses UpdatePipelineStepRequest — type?/config?/position?; config's OWN shape\n" +
      "MUST match the step's EXISTING kind exactly and carry over every existing field, changing only\n" +
      "what the message asks — see the Rules section below, not just these examples; never change a\n" +
      "step's kind unless the message explicitly asks to replace its operation):\n\n" +
      "rename:\n" + RenameStepExample +
      "\n\naggregate (groupBy is a list of {name,type} objects; aggregations is a list of\n" +
      "{alias,fn,field} objects — fn is one of sum|avg|min|max|count):\n" + AggregateStepExample +
      "\n\ngroupby (a DIFFERENT, single-aggregation shape from aggregate — groupBy is a list of PLAIN\n" +
      "STRINGS, not objects; aggColumn/aggFunction are single top-level fields, not a list):\n" + GroupByStepExample

  // `target.kind: "panel"`, `op: "update"` — ONE worked example per `PanelBindingSpec.DataBindable`
  // kind (metric/chart/table/collection/timeline, all five — a subset would leave the model
  // grounded-but-blind for the missing kinds, design.md D2a). `patch.config`'s field names are each
  // kind's real `fieldMapping` slot names (`PanelBindingSpec`) and its own `*PanelConfig.Patch`
  // fields — never generic placeholders. Chart's `chartType` is NOT part of `config` — it lives on
  // the sibling `appearance.chart` field (shown in the chart example), which reuses this same
  // "patch" object's `appearance` key.
  //
  // Each example is its own `private[services]` val (rather than one inlined block) so
  // `RefinementEditShapeSpec` can parse+decode EACH one individually through the real
  // `PatchSetProtocol.editFormat` + matching `*PanelConfig.Patch.decode` — the exact regression
  // guard a hand-maintained prompt example needs (evaluation-1.md cycle-1 finding: the metric
  // example's `aggregation` was missing its required `value` key — decode-shape-valid, but
  // semantically wrong in a way nothing downstream, including `PatchSetPreviewService.preview`,
  // would ever catch).

  private[services] val MetricPanelExample: String =
    """{
      |  "target": { "kind": "panel", "id": "panel_111" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "dataTypeId": "type_789",
      |      "fieldMapping": { "value": "revenue", "label": "region" },
      |      "aggregation": { "value": "revenue", "agg": "sum" },
      |      "unit": "$"
      |    }
      |  }
      |}""".stripMargin

  private[services] val ChartPanelExample: String =
    """{
      |  "target": { "kind": "panel", "id": "panel_222" },
      |  "op": "update",
      |  "patch": {
      |    "title": "Revenue by Month",
      |    "config": {
      |      "dataTypeId": "type_789",
      |      "fieldMapping": { "xAxis": "month", "yAxis": "revenue" },
      |      "aggregation": { "groupBy": "month", "agg": "sum", "yField": "revenue" }
      |    },
      |    "appearance": { "chart": { "chartType": "bar" } }
      |  }
      |}""".stripMargin

  private[services] val TablePanelExample: String =
    """{
      |  "target": { "kind": "panel", "id": "panel_333" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "dataTypeId": "type_789",
      |      "fieldMapping": { "col1": "customer", "col2": "revenue" }
      |    }
      |  }
      |}""".stripMargin

  private[services] val CollectionPanelExample: String =
    """{
      |  "target": { "kind": "panel", "id": "panel_444" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "dataTypeId": "type_789",
      |      "fieldMapping": { "value": "revenue", "label": "customer" },
      |      "baseType": "metric",
      |      "layout": "grid"
      |    }
      |  }
      |}""".stripMargin

  private[services] val TimelinePanelExample: String =
    """{
      |  "target": { "kind": "panel", "id": "panel_555" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "dataTypeId": "type_789",
      |      "fieldMapping": { "time": "createdAt", "event": "description" },
      |      "timelineOptions": { "sort": "desc" }
      |    }
      |  }
      |}""".stripMargin

  private val PanelUpdateExamples: String =
    "metric (fieldMapping slots: value required, label/unit optional):\n" + MetricPanelExample +
      "\n\nchart (fieldMapping slots: xAxis/yAxis required, series/annotation optional; chartType is a\n" +
      "sibling appearance field, not inside config):\n" + ChartPanelExample +
      "\n\ntable (no fieldMapping slots — one arbitrary key per displayed column, value = column name):\n" + TablePanelExample +
      "\n\ncollection (fieldMapping slots same as metric; baseType/layout optional):\n" + CollectionPanelExample +
      "\n\ntimeline (fieldMapping slots: time/event, both required; timelineOptions.sort optional):\n" + TimelinePanelExample

  // Panel-create worked examples — evaluation-2.md cycle-3 finding: the UPDATE examples' correct
  // `aggregation` shape does NOT reliably generalize to a CREATE context (a live A/B: one real
  // Claude call asked to create a metric panel with a sum aggregation reproduced cycle-1's exact
  // missing-`value` defect; a differently-worded call got it right). A worked CREATE example for
  // metric AND chart (the two DataBindable kinds whose `aggregation` has more than one required
  // key) closes that specific generalization gap; `RefinementPrompt.Instructions` ALSO states the
  // rule explicitly (never rely on an example alone to carry a hard requirement across op
  // contexts). Each is its own `private[services]` val for the same `RefinementEditShapeSpec`
  // regression-guard reason the panel-UPDATE examples above are.

  private[services] val MetricPanelCreateExample: String =
    """{
      |  "target": { "kind": "panel" },
      |  "op": "create",
      |  "patch": {
      |    "dashboardId": "dash_123",
      |    "title": "Total Revenue",
      |    "type": "metric",
      |    "config": {
      |      "dataTypeId": "type_789",
      |      "fieldMapping": { "value": "revenue" },
      |      "aggregation": { "value": "revenue", "agg": "sum" }
      |    }
      |  }
      |}""".stripMargin

  // NOTE: no `appearance` key here, unlike the chart UPDATE example — CreatePanelRequest.appearance
  // decodes strictly (jsonFormatN, whole-object), so a PARTIAL chart appearance like
  // {"chartType": "bar"} would fail to decode at create time (ChartAppearance requires
  // seriesColors/legend/tooltip/axisLabels too) — confirmed the exact same defect class the
  // aggregation fix above addresses (structurally-plausible JSON that fails downstream, here at
  // apply time rather than silently). An UPDATE edit's appearance is a raw JsValue with genuine
  // partial-merge semantics instead (PanelAppearance.applyPatchJson) — set chartType via a
  // SEPARATE follow-up "panel" update edit targeting this create's resulting panel id instead of
  // cramming it into the create itself.
  private[services] val ChartPanelCreateExample: String =
    """{
      |  "target": { "kind": "panel" },
      |  "op": "create",
      |  "patch": {
      |    "dashboardId": "dash_123",
      |    "title": "Revenue by Month",
      |    "type": "chart",
      |    "config": {
      |      "dataTypeId": "type_789",
      |      "fieldMapping": { "xAxis": "month", "yAxis": "revenue" },
      |      "aggregation": { "groupBy": "month", "agg": "sum", "yField": "revenue" }
      |    }
      |  }
      |}""".stripMargin

  private[services] val TablePanelCreateExample: String =
    """{
      |  "target": { "kind": "panel" },
      |  "op": "create",
      |  "patch": {
      |    "dashboardId": "dash_123",
      |    "title": "Top Customers",
      |    "type": "table",
      |    "config": { "dataTypeId": "type_789", "fieldMapping": { "col1": "customer", "col2": "revenue" } }
      |  }
      |}""".stripMargin

  private val CreateExample: String =
    "panel create (patch reuses CreatePanelRequest — dashboardId/type/config required, title/appearance\n" +
      "optional; target.id is OMITTED — the resource does not exist yet). A metric/chart panel's\n" +
      "aggregation MUST carry its full required key set even in a create edit — see the Rules section\n" +
      "below, not just these examples. If `appearance` is supplied at create time it must be the WHOLE\n" +
      "object (e.g. a chart's appearance needs seriesColors/legend/tooltip/axisLabels too, not just\n" +
      "chartType) — when only a partial tweak like chartType is wanted, omit appearance from the create\n" +
      "and add a SEPARATE follow-up \"panel\" update edit targeting the new panel instead:\n\n" +
      "metric create:\n" + MetricPanelCreateExample +
      "\n\nchart create:\n" + ChartPanelCreateExample +
      "\n\ntable create:\n" + TablePanelCreateExample +
      "\n\ncreate is ALSO supported for dashboard (patch: { \"name\": string }), dataSource (patch reuses\n" +
      "StaticDataSourceRequest — { \"name\", \"type\": \"static\", \"columns\": [...], \"rows\": [...] }, static\n" +
      "only), and pipeline (patch: { \"name\", \"sourceDataSourceId\", \"outputDataTypeName\" }) — the SAME\n" +
      "shape each one's own create endpoint accepts. create is NEVER supported for dataType or\n" +
      "pipelineStep (no direct create API for either) — never emit one of those."

  private val DeleteExample: String =
    """delete (any target.kind; "patch" is ABSENT entirely — never null, never {}):
      |{ "target": { "kind": "panel", "id": "panel_666" }, "op": "delete" }""".stripMargin

  val Description: String =
    Skeleton + "\n\nWorked update examples (one per target.kind):\n\n" + UpdateExamples +
      "\n\nWorked panel-update examples (one per bindable panel kind):\n\n" + PanelUpdateExamples +
      "\n\nWorked create examples:\n\n" + CreateExample +
      "\n\nWorked delete example:\n\n" + DeleteExample
}
