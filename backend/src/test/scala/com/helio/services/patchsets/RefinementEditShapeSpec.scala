package com.helio.services.patchsets

import com.helio.services.patchsets.RefinementEditShape
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.patchsets.{Edit, PatchSetProtocol}
import com.helio.domain.panels.{ChartPanelConfig, CollectionPanelConfig, MetricPanelConfig, TablePanelConfig, TimelinePanelConfig}
import com.helio.domain.steps.{AggregateConfig, GroupByConfig, JoinConfig, PivotConfig, UnpivotConfig, WindowConfig}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Regression coverage for `RefinementEditShape`'s worked JSON examples (evaluation-1.md cycle-1 +
 *  evaluation-2.md cycle-3 findings, design.md D2a) — each panel-update/-create example is REAL,
 *  valid JSON that decodes to a valid `Edit` via the actual `PatchSetProtocol.editFormat` reader,
 *  AND its `config` decodes through the matching real `*PanelConfig.Patch.decode`/`.decodeCreate`
 *  with the SEMANTICALLY complete fields real consumers (e.g. `usePanelData.ts`'s
 *  `computeAggregate(rows, metricAggregation.value, ...)`) actually require — not merely
 *  structurally-valid JSON. Nothing downstream (`PatchSetPreviewService.preview` included)
 *  validates `aggregation`'s internal shape, so this is the only guardrail against a
 *  hand-maintained prompt example silently drifting out of sync with what the real config types
 *  need — exactly the class of defect cycle 1 caught in the UPDATE example, and cycle 3 caught
 *  again (live, via two real Claude calls) in the CREATE path the cycle-1 fix never touched. */
class RefinementEditShapeSpec extends AnyWordSpec with Matchers with PatchSetProtocol {

  private def parseEdit(json: String): Edit = json.parseJson.convertTo[Edit]

  "RefinementEditShape's worked panel-update examples" should {

    "metric: decodes to a valid Edit whose config.aggregation carries BOTH value and agg (MetricAggregation's required keys)" in {
      val edit = parseEdit(RefinementEditShape.MetricPanelExample)
      edit.target.kind shouldBe "panel"
      edit.op shouldBe "update"
      val configJson = edit.panelPatch.get.config.get
      val patch = MetricPanelConfig.Patch.decode(configJson)

      patch.aggregation shouldBe defined
      val aggregation = patch.aggregation.get.get
      aggregation.fields.keySet should contain allOf ("value", "agg")
      aggregation.fields("value") shouldBe a[JsString]
      aggregation.fields("value").asInstanceOf[JsString].value should not be empty
    }

    "chart: decodes to a valid Edit whose config.aggregation carries groupBy, agg, AND yField (ChartAggregation's required keys)" in {
      val edit = parseEdit(RefinementEditShape.ChartPanelExample)
      val configJson = edit.panelPatch.get.config.get
      val patch = ChartPanelConfig.Patch.decode(configJson)

      patch.aggregation shouldBe defined
      val aggregation = patch.aggregation.get.get
      aggregation.fields.keySet should contain allOf ("groupBy", "agg", "yField")
    }

    "table: decodes to a valid Edit + TablePanelConfig.Patch with a non-empty fieldMapping" in {
      val edit = parseEdit(RefinementEditShape.TablePanelExample)
      val configJson = edit.panelPatch.get.config.get
      val patch = TablePanelConfig.Patch.decode(configJson)

      patch.fieldMapping shouldBe defined
      patch.fieldMapping.get.get.fields should not be empty
    }

    "collection: decodes to a valid Edit + CollectionPanelConfig.Patch with baseType/layout set" in {
      val edit = parseEdit(RefinementEditShape.CollectionPanelExample)
      val configJson = edit.panelPatch.get.config.get
      val patch = CollectionPanelConfig.Patch.decode(configJson)

      patch.baseType shouldBe Some(Some("metric"))
      patch.layout shouldBe Some(Some("grid"))
    }

    "timeline: decodes to a valid Edit + TimelinePanelConfig.Patch with both required fieldMapping slots (time, event)" in {
      val edit = parseEdit(RefinementEditShape.TimelinePanelExample)
      val configJson = edit.panelPatch.get.config.get
      val patch = TimelinePanelConfig.Patch.decode(configJson)

      patch.fieldMapping shouldBe defined
      patch.fieldMapping.get.get.fields.keySet should contain allOf ("time", "event")
    }
  }

  // ── CREATE path (evaluation-2.md cycle-3) — decodes via CreatePanelRequest + the matching
  //    *PanelConfig.decodeCreate (the FULL-config decoder, not the partial `.Patch.decode` the
  //    UPDATE examples above use — a create edit's `patch` is a whole `CreatePanelRequest`, not a
  //    partial patch), mirroring exactly how `PatchSetApplyResolvers.resolvePanelCreate` itself
  //    decodes a real `op: "create"` edit at apply time (`decodeCreatePatch[CreatePanelRequest]`). ──

  "RefinementEditShape's worked panel-create examples" should {

    "metric create: decodes to a valid Edit + CreatePanelRequest whose config.aggregation carries BOTH value and agg" in {
      val edit = parseEdit(RefinementEditShape.MetricPanelCreateExample)
      edit.target.kind shouldBe "panel"
      edit.op shouldBe "create"
      edit.target.id shouldBe empty // create never sets target.id — the resource doesn't exist yet

      val createRequest = edit.createPatch.get.convertTo[CreatePanelRequest]
      createRequest.`type` shouldBe Some("metric")
      val config = MetricPanelConfig.decodeCreate(createRequest.config.get)

      config.aggregation shouldBe defined
      val aggregation = config.aggregation.get
      aggregation.fields.keySet should contain allOf ("value", "agg")
      aggregation.fields("value") shouldBe a[JsString]
      aggregation.fields("value").asInstanceOf[JsString].value should not be empty
    }

    "chart create: decodes to a valid Edit + CreatePanelRequest whose config.aggregation carries groupBy, agg, AND yField" in {
      val edit = parseEdit(RefinementEditShape.ChartPanelCreateExample)
      edit.op shouldBe "create"

      val createRequest = edit.createPatch.get.convertTo[CreatePanelRequest]
      createRequest.`type` shouldBe Some("chart")
      val config = ChartPanelConfig.decodeCreate(createRequest.config.get)

      config.aggregation shouldBe defined
      val aggregation = config.aggregation.get
      aggregation.fields.keySet should contain allOf ("groupBy", "agg", "yField")
    }

    "table create: decodes to a valid Edit + CreatePanelRequest + TablePanelConfig with a non-empty fieldMapping" in {
      val edit = parseEdit(RefinementEditShape.TablePanelCreateExample)
      edit.op shouldBe "create"

      val createRequest = edit.createPatch.get.convertTo[CreatePanelRequest]
      createRequest.`type` shouldBe Some("table")
      val config = TablePanelConfig.decodeCreate(createRequest.config.get)

      config.fieldMapping.fields should not be empty
    }
  }

  // ── pipelineStep UPDATE path (skeptic-final-1.md, D2a's pipelineStep gap) — decodes the SAME way
  //    `PatchSetApplyResolvers.resolvePipelineStepUpdate`/`validateEmbeddedStepReferences` do
  //    (`UpdatePipelineStepRequest.config` -> `*Config.decode(rawJsonText)`), and — critically —
  //    asserts the decoded `groupBy`/`aggregations` are NON-EMPTY and match the example's own
  //    requested values, not just "decodes without throwing". `AggregateConfig.decode`/
  //    `GroupByConfig.decode` silently DROP a shape-mismatched item rather than raising (see their
  //    own doc comments), so a merely-decodes-successfully assertion would NOT have caught the live
  //    defect this suite exists to guard against — only a non-empty/content check does. ─────────

  "RefinementEditShape's worked pipelineStep-update examples" should {

    "rename: decodes to a valid Edit + UpdatePipelineStepRequest carrying a non-empty renames map" in {
      val edit = parseEdit(RefinementEditShape.RenameStepExample)
      edit.target.kind shouldBe "pipelineStep"
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      request.config shouldBe defined
      request.config.get.fields.keySet should contain("renames")
    }

    "aggregate: config round-trips through the REAL AggregateConfig.decode with non-empty groupBy/aggregations matching the example's own values" in {
      val edit = parseEdit(RefinementEditShape.AggregateStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = AggregateConfig.decode(request.config.get.compactPrint)

      decoded.groupBy should not be empty
      decoded.groupBy.map(_.name) should contain("region")
      decoded.aggregations should not be empty
      decoded.aggregations.map(_.alias) should contain("total_amount")
      decoded.aggregations.map(_.fn) should contain("avg")
      decoded.aggregations.map(_.field) should contain("amount")
    }

    "groupby: config round-trips through the REAL GroupByConfig.decode with a non-empty groupBy matching the example's own values (a DIFFERENT shape from aggregate)" in {
      val edit = parseEdit(RefinementEditShape.GroupByStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = GroupByConfig.decode(request.config.get.compactPrint)

      decoded.groupBy should contain("region")
      decoded.aggColumn shouldBe "amount"
      decoded.aggFunction shouldBe "avg"
    }

    // HEL-671: join/pivot/window/unpivot decode-and-assert-actual-values coverage (design.md D2,
    // tasks 3.2) — mirrors the aggregate/groupby tests above exactly: decode through the REAL config
    // decoder and assert non-empty/matching field values, never a bare "decodes without throwing"
    // assertion (that assertion shape would NOT catch a wrong-shape edit that silently decodes to a
    // degraded/defaulted config).

    "join: config round-trips through the REAL JoinConfig.decode with non-empty rightDataSourceId/joinKey/joinType matching the example's own values" in {
      val edit = parseEdit(RefinementEditShape.JoinStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = JoinConfig.decode(request.config.get.compactPrint)

      decoded.rightDataSourceId should not be empty
      decoded.rightDataSourceId shouldBe "src_456"
      decoded.joinKey should not be empty
      decoded.joinKey shouldBe "customerId"
      decoded.joinType shouldBe "left"
    }

    "pivot: config round-trips through the REAL PivotConfig.decode with a non-empty index matching the example's own column/values/agg" in {
      val edit = parseEdit(RefinementEditShape.PivotStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = PivotConfig.decode(request.config.get.compactPrint)

      decoded.index should not be empty
      decoded.index should contain("region")
      decoded.column shouldBe "quarter"
      decoded.values shouldBe "revenue"
      decoded.agg shouldBe "sum"
    }

    "unpivot: config round-trips through the REAL UnpivotConfig.decode with non-empty idVars/valueVars matching the example's own columns" in {
      val edit = parseEdit(RefinementEditShape.UnpivotStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = UnpivotConfig.decode(request.config.get.compactPrint)

      decoded.idVars should not be empty
      decoded.idVars should contain("region")
      decoded.valueVars should not be empty
      decoded.valueVars should contain allOf ("q1", "q2")
      decoded.varName shouldBe "quarter"
      decoded.valueName shouldBe "revenue"
    }

    "window: config round-trips through the REAL WindowConfig.decode with orderBy/partitionBy both reflecting every intended entry (no item silently dropped)" in {
      val edit = parseEdit(RefinementEditShape.WindowStepExample)
      edit.op shouldBe "update"

      val request = edit.pipelineStepPatch.get
      val decoded = WindowConfig.decode(request.config.get.compactPrint)

      decoded.partitionBy should not be empty
      decoded.partitionBy should contain("region")
      decoded.orderBy should not be empty
      decoded.orderBy.map(_.field) should contain("revenue")
      decoded.orderBy.map(_.direction) should contain("desc")
      decoded.function shouldBe "row_number"
      decoded.outputColumn shouldBe "rank"
    }
  }

  // HEL-671 skeptic-final-1.md CR-1: a discriminating NEGATIVE control. Every assertion above
  // decodes a CORRECT worked example and checks it stays correct — that alone cannot distinguish
  // "the tolerant decode-time defaulting is real" from "these examples just happen to be
  // well-formed". Each test below hand-constructs a WRONG-SHAPE config (never one of the worked
  // examples above), decodes it through the SAME real decoder, and asserts the decoded VALUE is
  // silently degraded (empty vector / `""` default) — never a bare "decodes without throwing"
  // assertion. This is what makes "the tolerance HEL-671 exists to reason about is real" a tested
  // fact rather than a code-read/doc-comment inference.

  // CHARACTERIZATION-TEST WARNING (added post skeptic-final-2.md CONFIRM): the 4 tests below
  // deliberately assert the CURRENT silently-tolerant decoder behavior (`joinKey shouldBe ""`,
  // `index shouldBe empty`, `orderBy shouldBe empty`, etc.) as EXPECTED for HEL-671's scope
  // (decoder hardening is explicitly deferred — see design.md D3). HEL-814 (filed, High priority)
  // will make these decoders RAISE on shape mismatch instead of silently defaulting. When HEL-814
  // lands, ALL FOUR of these tests SHOULD FAIL — that failure is the correct signal the hardening
  // fix worked, NOT a regression in HEL-814's own change. The correct response to that failure is
  // to INVERT each assertion (e.g. assert `JoinConfig.decode(wrongShape)` raises, rather than that
  // it returns a degraded value) — never to weaken the assertion or revert the hardening just to
  // turn these tests green again.
  "The real config decoders' silent-tolerance behavior on a hand-constructed WRONG-SHAPE config (negative control)" should {

    "join: an edit missing joinKey silently decodes to joinKey = \"\" (no exception, no signal)" in {
      val wrongShape = """{"rightDataSourceId": "src_456", "joinType": "inner"}"""
      val decoded = JoinConfig.decode(wrongShape)

      decoded.rightDataSourceId shouldBe "src_456"
      decoded.joinKey shouldBe "" // silently defaulted — the real degradation this ticket is about
      decoded.joinType shouldBe "inner"
    }

    "pivot: a non-array index silently decodes to an EMPTY index vector (no exception, no signal)" in {
      val wrongShape = """{"index": "region", "column": "quarter", "values": "revenue", "agg": "sum"}"""
      val decoded = PivotConfig.decode(wrongShape)

      decoded.index shouldBe empty // silently defaulted from a non-JsArray "index"
      decoded.column shouldBe "quarter"
    }

    "unpivot: a bare-string valueVars AND a missing varName both silently decode to degraded values" in {
      val wrongShape = """{"idVars": ["region"], "valueVars": "q1", "valueName": "revenue"}"""
      val decoded = UnpivotConfig.decode(wrongShape)

      decoded.idVars should contain("region")
      decoded.valueVars shouldBe empty // silently defaulted from a non-JsArray "valueVars"
      decoded.varName shouldBe "variable" // StepCodecUtil.stringOr's own hardcoded default, not "" — still a
      // SILENT substitution for a value the caller never actually provided, i.e. the same defect class
    }

    "window: plain-string orderBy entries are silently DROPPED (item-level flatMap-drop), and a non-array partitionBy silently defaults to empty" in {
      val wrongShape =
        """{"partitionBy": "region", "orderBy": ["revenue"], "function": "row_number", "outputColumn": "rank"}"""
      val decoded = WindowConfig.decode(wrongShape)

      decoded.partitionBy shouldBe empty // silently defaulted from a non-JsArray "partitionBy"
      decoded.orderBy shouldBe empty // the plain-string "revenue" entry doesn't convertTo[SortKey] and is
      // silently DROPPED by the flatMap(...).toOption pattern — the same mechanism AggregateConfig/
      // GroupByConfig had before HEL-411's fix
      decoded.function shouldBe "row_number"
    }
  }
}
