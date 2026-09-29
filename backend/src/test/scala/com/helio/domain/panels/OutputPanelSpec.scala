package com.helio.domain.panels

import com.helio.domain.model.{DashboardId, OutputId, PanelAppearance, PanelId, ResourceMeta, UserId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant

/** HEL-1189 tasks.md 1.2 — decode/encode/patch round-trip coverage for `OutputPanelConfig`'s new
 *  `controls` field, plus `OutputControlSpec`'s closed-key strict decode (design.md D2) and
 *  `OutputPanel.validateConfig`'s structural checks. */
class OutputPanelSpec extends AnyWordSpec with Matchers {

  private val now = Instant.parse("2026-05-16T00:00:00Z")
  private val id = PanelId("p-1")
  private val dashboardId = DashboardId("d-1")
  private val meta = ResourceMeta("u", now, now)
  private val appearance = PanelAppearance.Default
  private val owner = UserId("u")

  private def panel(cfg: OutputPanelConfig): OutputPanel =
    OutputPanel(id, dashboardId, "t", meta, appearance, owner, cfg)

  private def dateControl(
      controlId: String = "ctrl-1",
      column: String = "created_at",
      defaultValue: Option[JsValue] = None
  ): OutputControlSpec =
    OutputControlSpec(controlId, "date-range", column, "Date", defaultValue)

  "OutputPanelConfig.decode" should {
    "be tolerant of a missing/empty payload, decoding controls to an empty list" in {
      OutputPanelConfig.decode(JsObject.empty) shouldBe OutputPanelConfig.Empty
      OutputPanelConfig.decode(JsObject("outputId" -> JsString("o-1"))).controls shouldBe Vector.empty
    }

    "round-trip outputId and controls unchanged, preserving order" in {
      val cfg = OutputPanelConfig(
        OutputId("o-1"),
        Vector(dateControl("a"), dateControl("b", column = "updated_at"))
      )
      OutputPanelConfig.decode(cfg.toJson) shouldBe cfg
      OutputPanelConfig.decode(cfg.toJson).controls.map(_.id) shouldBe Vector("a", "b")
    }

    "round-trip each defaultValue wire shape per kind" in {
      val text = OutputControlSpec("c1", "text", "name", "Name", Some(JsString("hello")))
      val numericRange = OutputControlSpec(
        "c2", "numeric-range", "amount", "Amount",
        Some(JsObject("min" -> JsNumber(1), "max" -> JsNull))
      )
      val dateRange = OutputControlSpec(
        "c3", "date-range", "created_at", "Date",
        Some(JsObject("from" -> JsString("2026-01-01"), "to" -> JsNull))
      )
      val cfg = OutputPanelConfig(OutputId("o-1"), Vector(text, numericRange, dateRange))
      OutputPanelConfig.decode(cfg.toJson) shouldBe cfg
    }

    "reject an unrecognized control attribute (400-mapped by decodeCreate)" in {
      val json = JsObject(
        "outputId" -> JsString("o-1"),
        "controls" -> JsArray(JsObject(
          "id"     -> JsString("c1"),
          "kind"   -> JsString("text"),
          "column" -> JsString("name"),
          "label"  -> JsString("Name"),
          "bogus"  -> JsString("nope")
        ))
      )
      a[DeserializationException] should be thrownBy OutputPanelConfig.decode(json)
    }

    "reject a control missing a required key" in {
      val json = JsObject(
        "outputId" -> JsString("o-1"),
        "controls" -> JsArray(JsObject(
          "id"     -> JsString("c1"),
          "kind"   -> JsString("text"),
          "column" -> JsString("name")
          // label omitted
        ))
      )
      a[DeserializationException] should be thrownBy OutputPanelConfig.decode(json)
    }
  }

  "OutputPanelConfig.Patch.decode" should {
    "absent controls means unchanged, present controls replaces the whole list" in {
      OutputPanelConfig.Patch.decode(JsObject("outputId" -> JsString("o-2"))).controls shouldBe None
      OutputPanelConfig.Patch.decode(
        JsObject("controls" -> JsArray(dateControl().toJson))
      ).controls shouldBe Some(Vector(dateControl()))
    }
  }

  "OutputPanel.applyPatch" should {
    "keeps existing controls when the patch omits controls" in {
      val existing = panel(OutputPanelConfig(OutputId("o-1"), Vector(dateControl())))
      val patched = existing.applyPatch(OutputPanelConfig.Patch(Some(OutputId("o-2")), None))
      patched.config.controls shouldBe Vector(dateControl())
      patched.config.outputId shouldBe OutputId("o-2")
    }

    "replaces the whole controls list when the patch carries one" in {
      val existing = panel(OutputPanelConfig(OutputId("o-1"), Vector(dateControl())))
      val next = Vector(dateControl("c2", column = "updated_at"))
      val patched = existing.applyPatch(OutputPanelConfig.Patch(None, Some(next)))
      patched.config.controls shouldBe next
      patched.config.outputId shouldBe OutputId("o-1")
    }
  }

  "OutputPanel.validateConfig" should {
    "accepts a panel with no controls" in {
      panel(OutputPanelConfig(OutputId("o-1"))).validateConfig shouldBe Right(())
    }

    "accepts a structurally valid control" in {
      panel(OutputPanelConfig(OutputId("o-1"), Vector(dateControl()))).validateConfig shouldBe Right(())
    }

    "rejects an unknown control kind" in {
      val cfg = OutputPanelConfig(OutputId("o-1"), Vector(dateControl().copy(kind = "bogus")))
      panel(cfg).validateConfig.isLeft shouldBe true
    }

    "rejects a blank control column" in {
      val cfg = OutputPanelConfig(OutputId("o-1"), Vector(dateControl().copy(column = "  ")))
      panel(cfg).validateConfig.isLeft shouldBe true
    }

    "rejects a blank control label" in {
      val cfg = OutputPanelConfig(OutputId("o-1"), Vector(dateControl().copy(label = "")))
      panel(cfg).validateConfig.isLeft shouldBe true
    }

    "rejects a blank control id" in {
      val cfg = OutputPanelConfig(OutputId("o-1"), Vector(dateControl().copy(id = "")))
      panel(cfg).validateConfig.isLeft shouldBe true
    }
  }
}
