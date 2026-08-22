package com.helio.services.patchsets

import com.helio.services.patchsets.RefinementEditShape
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.patchsets.{Edit, PatchSetProtocol}
import com.helio.domain.panels.{ChartPanelConfig, CollectionPanelConfig, MetricPanelConfig, TablePanelConfig, TimelinePanelConfig}
import com.helio.domain.steps.{AggregateConfig, GroupByConfig}
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
  }
}
