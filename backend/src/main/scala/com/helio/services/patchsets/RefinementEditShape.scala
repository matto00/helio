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
      |      "target": { "kind": "panel | dashboard | dataSource | pipeline | pipelineStep", "id": "string — REQUIRED for update/delete (a REAL id from the state below); OMIT for create" },
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

  // HEL-671: worked UPDATE examples for join/pivot/window/unpivot, added unconditionally (design.md
  // tasks 3.1/3.2) to extend the aggregate/groupby worked-example guarantee above, shipped per D1/3.1's
  // "unconditional" instruction regardless of live-trial outcome. `JoinConfig`/`PivotConfig`/
  // `UnpivotConfig`/`WindowConfig` (`backend/.../domain/steps/*.scala`) silently DEFAULT a
  // missing/wrong-typed top-level field to empty/`""` rather than raising (and `WindowConfig`'s
  // `orderBy` additionally drops a shape-mismatched ITEM via the same `flatMap(...).toOption` pattern
  // `AggregateConfig`/`GroupByConfig` use) — a plausible-looking but wrong key set here would silently
  // degrade the step's real behavior even though `preview`/apply both return success. This tolerance
  // is a TESTED FACT, not an inference: `RefinementEditShapeSpec`'s hand-constructed negative-control
  // tests decode a deliberately wrong-shape config per kind and assert the decoded value IS degraded,
  // and `PatchSetPreviewServiceSpec`'s join-specific test drives that same class of wrong-shape edit
  // through the real `PatchSetPreviewService.preview` and asserts it's accepted despite the degraded
  // decode (skeptic-final-1.md CR-1/CR-2). Separately, 11 live `POST /api/refinements` trials against
  // this worktree's own backend (`live-trials.md`) did NOT reproduce the model emitting a wrong-shape
  // edit for any of the four kinds — but per skeptic-final-1.md CR-3, that is only "these specific,
  // non-ablated prompts didn't trigger it," not proof the prompt rule below is load-bearing (no trial
  // ran with the rule/examples absent to distinguish the two).
  // HEL-911 (design.md Decisions 1/1a): `rightDataSourceId` (flat string) is replaced by
  // `secondaryInput`, a discriminated object -- `{"kind":"source","dataSourceId":...}` (shown
  // here) or `{"kind":"lane","stepId":...}` (rejoin another lane; out of scope for this worked
  // example, which stays a source-kind join per the file's pre-existing convention). The flat
  // field is no longer a valid config key at all -- present, it is a hard decode error.
  private[services] val JoinStepExample: String =
    """{
      |  "target": { "kind": "pipelineStep", "id": "step_mno" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "secondaryInput": { "kind": "source", "dataSourceId": "src_456" },
      |      "joinKey": "customerId",
      |      "joinType": "left"
      |    }
      |  }
      |}""".stripMargin

  private[services] val PivotStepExample: String =
    """{
      |  "target": { "kind": "pipelineStep", "id": "step_pqr" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "index": [ "region" ],
      |      "column": "quarter",
      |      "values": "revenue",
      |      "agg": "sum"
      |    }
      |  }
      |}""".stripMargin

  private[services] val UnpivotStepExample: String =
    """{
      |  "target": { "kind": "pipelineStep", "id": "step_stu" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "idVars": [ "region" ],
      |      "valueVars": [ "q1", "q2" ],
      |      "varName": "quarter",
      |      "valueName": "revenue"
      |    }
      |  }
      |}""".stripMargin

  private[services] val WindowStepExample: String =
    """{
      |  "target": { "kind": "pipelineStep", "id": "step_vwx" },
      |  "op": "update",
      |  "patch": {
      |    "config": {
      |      "partitionBy": [ "region" ],
      |      "orderBy": [ { "field": "revenue", "direction": "desc" } ],
      |      "function": "row_number",
      |      "field": null,
      |      "outputColumn": "rank",
      |      "offset": null
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
      "STRINGS, not objects; aggColumn/aggFunction are single top-level fields, not a list):\n" + GroupByStepExample +
      "\n\njoin (secondaryInput is a discriminated object -- {\"kind\":\"source\",\"dataSourceId\":...}\n" +
      "or {\"kind\":\"lane\",\"stepId\":...} -- never a flat rightDataSourceId string; joinKey/joinType\n" +
      "are single top-level STRING fields; joinType is one of inner|left):\n" + JoinStepExample +
      "\n\npivot (index is a list of PLAIN STRINGS, not a single string or a list of objects;\n" +
      "column/values/agg are single top-level string fields; agg is one of sum|count|avg|min|max|first):\n" + PivotStepExample +
      "\n\nunpivot (idVars/valueVars are BOTH lists of plain strings; varName/valueName are single\n" +
      "top-level string fields):\n" + UnpivotStepExample +
      "\n\nwindow (partitionBy is a list of plain strings; orderBy is a list of {field,direction} objects\n" +
      "— SortStep's own SortKey shape, never plain strings; function is one of\n" +
      "row_number|rank|dense_rank|running_sum|lag|lead; field/offset are optional and only required by\n" +
      "running_sum/lag/lead):\n" + WindowStepExample

  // `target.kind: "panel"`, `op: "update"` — HEL-907 task 1.6/1.8: retargeted onto the Outputs
  // model. A panel is now either an `output`-kind PLACEMENT (bound to a pre-existing Output via
  // `config.outputId` -- nothing else in `config`; fieldMapping/aggregation/chartType/baseType/
  // layout/timelineOptions all moved OFF the panel and onto the Output itself, editable only via
  // an `output`-kind edit, never a panel edit) or a content panel (`text`/`markdown`/`image`/
  // `divider`, no data binding at all). The five kind-specific bound-panel examples this replaced
  // (`metric`/`chart`/`table`/`collection`/`timeline`) described panel `type` values
  // `PanelType.fromString` has not accepted since HEL-904 -- every one of those five examples
  // would have been REJECTED by the real backend; the file's own regression test
  // (`RefinementEditShapeSpec`) never happened to cover them, which is how this survived
  // undetected until this task's re-verification found it.
  //
  // Each example is its own `private[services]` val so `RefinementEditShapeSpec` can parse+decode
  // it individually through the real `PatchSetProtocol.editFormat` -- same regression-guard
  // convention every other worked example in this file already follows.

  private[services] val OutputPanelExample: String =
    """{
      |  "target": { "kind": "panel", "id": "panel_111" },
      |  "op": "update",
      |  "patch": {
      |    "title": "Revenue",
      |    "config": { "outputId": "output_789" }
      |  }
      |}""".stripMargin

  private[services] val ContentPanelExample: String =
    """{
      |  "target": { "kind": "panel", "id": "panel_666" },
      |  "op": "update",
      |  "patch": { "config": { "content": "Updated note text" } }
      |}""".stripMargin

  private val PanelUpdateExamples: String =
    "output (a placement bound to an EXISTING Output -- config.outputId is the ONLY config key; " +
      "there is no fieldMapping/aggregation/chartType/baseType/layout/timelineOptions on a panel " +
      "at all anymore, those live on the Output itself and are not editable through this patch -- " +
      "if the message wants a different metric/column/chart type shown, that is an Output edit " +
      "(target.kind: \"output\", patch reuses UpdateOutputRequest -- name/config), never a panel " +
      "edit):\n" + OutputPanelExample +
      "\n\ntext/markdown/image/divider (content panels, no data binding -- content lives in " +
      "config.content for text/markdown, config.imageUrl for image, decoded tolerantly like every " +
      "other panel kind's config):\n" + ContentPanelExample

  // Panel-create worked example -- HEL-907 task 1.6/1.8: retargeted onto the Outputs model, same
  // rationale as the update examples above. A panel create's ONLY data-binding field is
  // config.outputId, pointing at a PRE-EXISTING Output (an Output must be created first, via an
  // `output`-kind create -- see the output-create example below -- or `add_output`/
  // `propose_pipeline`; a panel create can never mint an Output of its own in the same edit).

  private[services] val OutputPanelCreateExample: String =
    """{
      |  "target": { "kind": "panel" },
      |  "op": "create",
      |  "patch": {
      |    "dashboardId": "dash_123",
      |    "title": "Total Revenue",
      |    "type": "output",
      |    "config": { "outputId": "output_789" }
      |  }
      |}""".stripMargin

  // HEL-907 task 1.2's own new target.kind -- an Output create edit is NOT supported (no
  // parent-pipeline-id field on EditTarget or CreateOutputRequest to target one, mirrors
  // pipelineStep's own precedent below); an Output UPDATE edit reuses UpdateOutputRequest
  // (name/config) exactly like every other kind's update patch.
  private[services] val OutputUpdateExample: String =
    """{ "target": { "kind": "output", "id": "output_789" }, "op": "update", "patch": { "name": "Weekly Revenue" } }"""

  // HEL-913 (skeptic-final-1.md CR1): widened from `private` to `private[services]`, matching
  // every other example val in this file, so `RefinementEditShapeSpec` can assert its CONTENT
  // (not just that `Description` includes it structurally) -- this exact string went stale once
  // already (the `sourceDataSourceId` prompt-literal instructing the model to emit a body the
  // API hard-400s) with zero test coverage catching it. A future shape change must fail a test,
  // not rot silently again.
  private[services] val CreateExample: String =
    "panel create (patch reuses CreatePanelRequest \u2014 dashboardId/type/config required, title/appearance\n" +
      "optional; target.id is OMITTED \u2014 the resource does not exist yet). An output-kind panel's\n" +
      "config.outputId MUST reference an Output that ALREADY EXISTS BEFORE this patch set runs \u2014 never\n" +
      "a not-yet-created one (see the Rules section below: a create edit's real id does not exist\n" +
      "until this whole patch set is applied, so nothing else in the SAME patch set, including another\n" +
      "edit's target.id, can ever legitimately reference it):\n\n" +
      "output panel create:\n" + OutputPanelCreateExample +
      "\n\noutput update (rename, or rebind config \u2014 see the worked output-update\n" +
      "example above; output has NO create op of its own):\n" + OutputUpdateExample +
      "\n\ncreate is ALSO supported for dashboard (patch: { \"name\": string }), dataSource (patch reuses\n" +
      "StaticDataSourceRequest \u2014 { \"name\", \"type\": \"static\", \"columns\": [...], \"rows\": [...] }, static\n" +
      "only), and pipeline (patch reuses CreatePipelineRequest \u2014 { \"name\", \"roots\": [{ \"sourceId\" }] }\n" +
      "required \u2014 \"roots\" is a NON-EMPTY array, one element per pipeline root, each EITHER an existing\n" +
      "\"sourceId\" OR an inline source spec (\"type\"/\"name\"/one of \"sqlConfig\"/\"restConfig\"/\"staticConfig\");\n" +
      "\"sourceDataSourceId\" is RETIRED and hard-rejected (HEL-913, no alias, no default) \u2014 never emit it;\n" +
      "\"tag\"/\"steps\"/\"outputs\" optional). create is NEVER supported for pipelineStep or\n" +
      "output (neither has a direct create API reachable from a patch-set edit \u2014 never emit one of\n" +
      "those). \"dataType\" is not a valid target.kind at all anymore \u2014 never emit any edit targeting\n" +
      "it."

  private val DeleteExample: String =
    """delete (any target.kind; "patch" is ABSENT entirely — never null, never {}):
      |{ "target": { "kind": "panel", "id": "panel_666" }, "op": "delete" }""".stripMargin

  val Description: String =
    Skeleton + "\n\nWorked update examples (one per target.kind):\n\n" + UpdateExamples +
      "\n\nWorked panel-update examples (output placement, and a content-panel example):\n\n" + PanelUpdateExamples +
      "\n\nWorked create examples:\n\n" + CreateExample +
      "\n\nWorked delete example:\n\n" + DeleteExample
}
