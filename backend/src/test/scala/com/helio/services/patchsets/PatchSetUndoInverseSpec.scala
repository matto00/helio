package com.helio.services.patchsets

import com.helio.api.protocols.panels.PanelAppearanceResponse
import com.helio.api.protocols.panels.PanelResponse
import com.helio.services.patchsets.PatchSetUndoInverse
import com.helio.api.JsonProtocols
import com.helio.api.protocols._
import com.helio.domain.panels.MetricPanel
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Dedicated regression coverage for [[PatchSetUndoInverse]]'s explicit-null-default treatment of
 *  omitted Option config fields (design.md D5) -- the exact HEL-406 final-gate bug
 *  (`PatchSetApplyRollback.optionalConfigFieldNames`/`fullConfigInverse`, skeptic-final-1.md CR1)
 *  re-verified here for undo's INDEPENDENT reimplementation, never a shared reference to the
 *  apply-side builder (design.md D5's own explicit point). A pure unit test (no DB) -- the
 *  `apply` -> `undo` full round trip through a real panel row is covered separately by
 *  `PatchSetUndoServiceSpec` (tasks.md 5.3). */
class PatchSetUndoInverseSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private def panelResponse(config: JsValue): PanelResponse =
    PanelResponse(
      id          = "panel-1",
      dashboardId = "dashboard-1",
      title       = "Aggregation panel",
      `type`      = MetricPanel.Kind,
      meta        = ResourceMetaResponse("owner-1", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      appearance  = PanelAppearanceResponse("#fff", "#000", 1.0, None),
      ownerId     = "owner-1",
      config      = config,
      dataAsOf    = None
    )

  "PatchSetUndoInverse.fullPanelInverse" should {

    "emit an explicit null for an Option config field the captured response's config OMITTED entirely (D5)" in {
      // `PanelConfigCodec.encodeConfig`'s plain jsonFormatN writer omits a None-valued Option
      // field rather than writing `null` -- so a captured `PanelResponse.config` for a panel whose
      // `aggregation` was never set looks exactly like this: the key is simply ABSENT.
      val configWithoutAggregation = JsObject(
        "dataTypeId"   -> JsString("dt-1"),
        "fieldMapping" -> JsObject("value" -> JsString("value"))
      )
      configWithoutAggregation.fields.keySet should not contain "aggregation"

      val inverse = PatchSetUndoInverse.fullPanelInverse(panelResponse(configWithoutAggregation))
      val configJson = inverse.config.getOrElse(fail("expected config")).asJsObject

      // The regression bar: an ABSENT key (which every `*Config.Patch.decode` reads as "leave the
      // CURRENT value unchanged") would silently fail to clear an aggregation the live panel still
      // has set. An explicit `null` is required so the patch reader genuinely clears it.
      configJson.fields.get("aggregation") shouldBe Some(JsNull)
      configJson.fields.get("label") shouldBe Some(JsNull)
      configJson.fields.get("unit") shouldBe Some(JsNull)
      configJson.fields.get("metricId") shouldBe Some(JsNull)
    }

    "preserve a real (non-omitted) Option config field's captured value rather than overriding it with null (D5)" in {
      val configWithAggregation = JsObject(
        "dataTypeId"   -> JsString("dt-1"),
        "fieldMapping" -> JsObject("value" -> JsString("value")),
        "aggregation"  -> JsObject("op" -> JsString("sum"))
      )
      val inverse = PatchSetUndoInverse.fullPanelInverse(panelResponse(configWithAggregation))
      val configJson = inverse.config.getOrElse(fail("expected config")).asJsObject
      configJson.fields("aggregation") shouldBe JsObject("op" -> JsString("sum"))
    }

    "clear an aggregation that a live panel currently has set, end to end through the SAME Patch.decode/applyPatch path PATCH /api/panels/:id uses (D5)" in {
      import com.helio.domain.panels.{MetricPanel, MetricPanelConfig}
      import com.helio.domain.model.{DataTypeId, DashboardId, PanelAppearance, PanelId, ResourceMeta, UserId}
      import java.time.Instant

      val meta = ResourceMeta("owner-1", Instant.EPOCH, Instant.EPOCH)
      // The live (post-apply) panel still carries the aggregation the original edit set.
      val livePanel = MetricPanel(
        id          = PanelId("panel-1"),
        dashboardId = DashboardId("dashboard-1"),
        title       = "Aggregation panel",
        meta        = meta,
        appearance  = PanelAppearance.Default,
        ownerId     = UserId("owner-1"),
        config = MetricPanelConfig(
          dataTypeId   = DataTypeId("dt-1"),
          fieldMapping = JsObject("value" -> JsString("value")),
          aggregation  = Some(JsObject("op" -> JsString("sum")))
        )
      )

      // The captured PRIOR state (what undo restores to) never had aggregation set -- so its
      // encoded config omits the key entirely, exactly like `PanelConfigCodec.encodeConfig` would.
      val priorConfigJson = JsObject("dataTypeId" -> JsString("dt-1"), "fieldMapping" -> JsObject("value" -> JsString("value")))
      val inverse = PatchSetUndoInverse.fullPanelInverse(panelResponse(priorConfigJson))
      val patch = MetricPanelConfig.Patch.decode(inverse.config.getOrElse(fail("expected config")))

      val restored = livePanel.applyPatch(patch)
      restored.config.aggregation shouldBe None
    }
  }

  /** Regression coverage for HEL-705: a persisted pipeline-step JSON captured in the apply
   *  journal carries `enabled` (HEL-412) alongside `type`/`config`/`position` -- these two
   *  helpers previously dropped it entirely, silently reviving a disabled step as enabled on
   *  undo/redo. */
  private def pipelineStepJson(enabledField: Option[Boolean]): JsValue = {
    val base = Map[String, JsValue](
      "type"     -> JsString("filter"),
      "config"   -> JsObject("field" -> JsString("status"), "op" -> JsString("eq"), "value" -> JsString("active")),
      "position" -> JsNumber(2)
    )
    JsObject(base ++ enabledField.map(v => "enabled" -> JsBoolean(v)).toMap)
  }

  "PatchSetUndoInverse.fullPipelineStepInverse" should {

    "restore a captured disabled step's enabled=false rather than defaulting it to enabled (HEL-705)" in {
      val inverse = PatchSetUndoInverse.fullPipelineStepInverse(pipelineStepJson(Some(false)))
      inverse.enabled shouldBe Some(false)
    }

    "default enabled=true when the captured JSON has no enabled key at all (legacy, pre-HEL-412)" in {
      val inverse = PatchSetUndoInverse.fullPipelineStepInverse(pipelineStepJson(None))
      inverse.enabled shouldBe Some(true)
    }
  }

  "PatchSetUndoInverse.pipelineStepCreateRequestFromResponse" should {

    "pass through a captured disabled step's enabled=false rather than defaulting it to enabled (HEL-705)" in {
      val create = PatchSetUndoInverse.pipelineStepCreateRequestFromResponse(pipelineStepJson(Some(false)))
      create.enabled shouldBe Some(false)
    }

    "leave enabled=None when the captured JSON has no enabled key at all -- matching the create endpoint's own absent-means-enabled contract" in {
      val create = PatchSetUndoInverse.pipelineStepCreateRequestFromResponse(pipelineStepJson(None))
      create.enabled shouldBe None
    }
  }
}
