package com.helio.domain.model

import com.helio.domain.model.{DashboardId, Panel, PanelAppearance, PanelId, PanelKind, ResourceMeta, UserId}
import com.helio.domain.panels._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant


/** Spec for the per-file `Panel` ADT introduced in CS2c-3b cycle 1.
 *
 *  Mirrors the structure of `PipelineStepSpec`: Registry parity,
 *  per-subtype `kind` correctness, polymorphic-method behavior, and the
 *  exhaustiveness pattern-match that catches new subtypes added to the
 *  registry without test surface updates.
 *
 *  HEL-904 task 3.6: the bound trio + Collection + Timeline sections
 *  (MetricPanelConfig/ChartPanelConfig/TablePanelConfig/CollectionPanelConfig/
 *  TimelinePanelConfig aggregation, metricId, chartOptions, annotation,
 *  columnWidths/density/columnOrder, and their PanelConfigCodec dispatch
 *  tests) were deleted outright along with the subtypes themselves -- the
 *  panel-kind set collapsed to output|text|markdown|image|divider.
 *
 *  HEL-904 task 4.1: Text/Markdown's data-bound "Source mode"
 *  (`dataTypeId`/`fieldMapping`, `buildQuery`/`withBindingCleared`, the
 *  `Panel` trait's `dataTypeId`/`fieldMapping`/`buildQuery`/
 *  `withBindingCleared` members) is removed outright — the V94 migration
 *  already converted every data-bound text/markdown panel into a
 *  `markdown`-kind Output + `OutputPanel` placement, so `TextPanelConfig`/
 *  `MarkdownPanelConfig` are now literal-content-only, mirroring
 *  `ImagePanelConfig`/`DividerPanelConfig`. */
class PanelSpec extends AnyWordSpec with Matchers {

  private val now = Instant.parse("2026-05-16T00:00:00Z")
  private val id  = PanelId("p-1")
  private val dashboardId = DashboardId("d-1")
  private val meta        = ResourceMeta("u", now, now)
  private val appearance  = PanelAppearance.Default
  private val owner       = UserId("u")

  // -- Per-subtype factory helpers --------------------------------------------

  private def text(cfg: TextPanelConfig = TextPanelConfig.Empty): TextPanel =
    TextPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def md(cfg: MarkdownPanelConfig = MarkdownPanelConfig.Empty): MarkdownPanel =
    MarkdownPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def img(cfg: ImagePanelConfig = ImagePanelConfig.Empty): ImagePanel =
    ImagePanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def divider(cfg: DividerPanelConfig = DividerPanelConfig.Empty): DividerPanel =
    DividerPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def output(cfg: OutputPanelConfig = OutputPanelConfig.Empty): OutputPanel =
    OutputPanel(id, dashboardId, "t", meta, appearance, owner, cfg)

  "Panel.Registry" should {
    "be the single source of truth for all 5 panel kinds" in {
      Panel.Registry.keySet shouldBe Set(
        TextPanel.Kind,
        MarkdownPanel.Kind,
        ImagePanel.Kind,
        DividerPanel.Kind,
        OutputPanel.Kind
      )
    }

    "expose canonical kind strings" in {
      TextPanel.Kind       shouldBe "text"
      MarkdownPanel.Kind   shouldBe "markdown"
      ImagePanel.Kind      shouldBe "image"
      DividerPanel.Kind    shouldBe "divider"
      OutputPanel.Kind     shouldBe "output"
    }
  }

  "PanelKind.All" should {
    "derive from Panel.Registry" in {
      PanelKind.All shouldBe Panel.Registry.keySet
    }

    "parse known kinds and reject unknown" in {
      PanelKind.parseKind("output") shouldBe Right("output")
      PanelKind.parseKind("nope").isLeft shouldBe true
    }
  }

  "Each subtype" should {
    "expose its registered kind via the trait" in {
      val all: Seq[Panel] = Seq(text(), md(), img(), divider(), output())
      all.foreach { p =>
        Panel.Registry.contains(p.kind) shouldBe true
        Panel.Registry(p.kind).kind shouldBe p.kind
      }
    }

    "expose validateConfig per subtype" in {
      text().validateConfig   shouldBe Right(())
      md().validateConfig     shouldBe Right(())
      img().validateConfig    shouldBe Right(())
      divider().validateConfig shouldBe Right(())
      output(OutputPanelConfig(OutputId("out-1"))).validateConfig shouldBe Right(())
      output().validateConfig.isLeft shouldBe true // empty outputId is invalid

      // DividerPanel.weight invariant: must be positive if present.
      divider(DividerPanelConfig("horizontal", Some(0), None)).validateConfig.isLeft shouldBe true
      divider(DividerPanelConfig("horizontal", Some(-1), None)).validateConfig.isLeft shouldBe true
      divider(DividerPanelConfig("horizontal", Some(3), None)).validateConfig shouldBe Right(())
    }
  }

  "Per-subtype JSON config decode" should {
    "be tolerant of missing fields" in {
      TextPanelConfig.decode(JsObject.empty)     shouldBe TextPanelConfig.Empty
      MarkdownPanelConfig.decode(JsObject.empty) shouldBe MarkdownPanelConfig.Empty
      ImagePanelConfig.decode(JsObject.empty)    shouldBe ImagePanelConfig.Empty
      DividerPanelConfig.decode(JsObject.empty)  shouldBe DividerPanelConfig.Empty
      OutputPanelConfig.decode(JsObject.empty)   shouldBe OutputPanelConfig.Empty
    }

    "round-trip via the per-subtype format" in {
      val cfg     = OutputPanelConfig(OutputId("out-1"))
      val decoded = OutputPanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "decode a DividerPanelConfig with all optional fields populated" in {
      val cfg = DividerPanelConfig.decode(JsObject(
        "orientation" -> JsString("vertical"),
        "weight"      -> JsNumber(2),
        "color"       -> JsString("#abcdef")
      ))
      cfg shouldBe DividerPanelConfig("vertical", Some(2), Some("#abcdef"))
    }
  }

  "ImagePanelConfig.caption" should {
    "default to None when absent" in {
      ImagePanelConfig.decode(JsObject("imageUrl" -> JsString("http://x/y.png"))).caption shouldBe None
    }

    "normalize null/empty/whitespace to None at decode" in {
      ImagePanelConfig.decode(JsObject("caption" -> JsNull)).caption shouldBe None
      ImagePanelConfig.decode(JsObject("caption" -> JsString(""))).caption shouldBe None
      ImagePanelConfig.decode(JsObject("caption" -> JsString("   "))).caption shouldBe None
    }

    "decode a non-blank caption" in {
      ImagePanelConfig.decode(JsObject("caption" -> JsString("Hero photo"))).caption shouldBe Some("Hero photo")
    }

    "omit caption from the wire when None (spray-json None-omission)" in {
      val fields = ImagePanelConfig("http://x/y.png", "cover", None).toJson.asJsObject.fields
      fields.contains("caption") shouldBe false
    }

    "include caption on the wire when set" in {
      val fields = ImagePanelConfig("http://x/y.png", "cover", Some("Fig. 1")).toJson.asJsObject.fields
      fields.get("caption") shouldBe Some(JsString("Fig. 1"))
    }

    "round-trip via the per-subtype format (jsonFormat3)" in {
      val cfg = ImagePanelConfig("http://x/y.png", "cover", Some("Cap"))
      ImagePanelConfig.decode(cfg.toJson) shouldBe cfg
    }

    "Patch.decode: absent key leaves caption untouched (outer None)" in {
      ImagePanelConfig.Patch.decode(JsObject("imageUrl" -> JsString("u"))).caption shouldBe None
    }

    "Patch.decode: null/empty/whitespace clears caption (Some(None))" in {
      ImagePanelConfig.Patch.decode(JsObject("caption" -> JsNull)).caption shouldBe Some(None)
      ImagePanelConfig.Patch.decode(JsObject("caption" -> JsString(""))).caption shouldBe Some(None)
      ImagePanelConfig.Patch.decode(JsObject("caption" -> JsString("  "))).caption shouldBe Some(None)
    }

    "Patch.decode: non-blank string sets caption (Some(Some(v)))" in {
      ImagePanelConfig.Patch.decode(JsObject("caption" -> JsString("New"))).caption shouldBe Some(Some("New"))
    }

    "applyPatch: absent leaves the existing caption, null clears it, value sets it" in {
      val existing = img(ImagePanelConfig("u", "cover", Some("Old")))
      existing.applyPatch(ImagePanelConfig.Patch(None, None, None)).config.caption shouldBe Some("Old")
      existing.applyPatch(ImagePanelConfig.Patch(None, None, Some(None))).config.caption shouldBe None
      existing.applyPatch(ImagePanelConfig.Patch(None, None, Some(Some("New")))).config.caption shouldBe Some("New")
    }
  }

  "TextPanelConfig" should {
    "default content to empty when absent" in {
      TextPanelConfig.decode(JsObject.empty).content shouldBe ""
    }

    "decode present content" in {
      TextPanelConfig.decode(JsObject("content" -> JsString("Static fallback"))).content shouldBe "Static fallback"
    }

    "round-trip via the per-subtype format (jsonFormat1)" in {
      val cfg = TextPanelConfig("Hi")
      TextPanelConfig.decode(cfg.toJson) shouldBe cfg
    }

    "Patch.decode: absent content key leaves it untouched (outer None)" in {
      TextPanelConfig.Patch.decode(JsObject.empty).content shouldBe None
    }

    "Patch.decode: explicit null clears content to empty string" in {
      TextPanelConfig.Patch.decode(JsObject("content" -> JsNull)).content shouldBe Some("")
    }

    "Patch.decode: present value sets content" in {
      TextPanelConfig.Patch.decode(JsObject("content" -> JsString("New"))).content shouldBe Some("New")
    }

    "applyPatch: absent content key preserves the existing content" in {
      val existing = text(TextPanelConfig("Hello"))
      val patched = existing.applyPatch(TextPanelConfig.Patch(None))
      patched.config.content shouldBe "Hello"
    }

    "applyPatch: present content replaces the existing content" in {
      val existing = text(TextPanelConfig("Old"))
      val patched = existing.applyPatch(TextPanelConfig.Patch(Some("New literal text")))
      patched.config.content shouldBe "New literal text"
    }
  }

  "MarkdownPanelConfig" should {
    "default content to empty when absent" in {
      MarkdownPanelConfig.decode(JsObject.empty).content shouldBe ""
    }

    "decode present content" in {
      MarkdownPanelConfig.decode(JsObject("content" -> JsString("# Static fallback"))).content shouldBe "# Static fallback"
    }

    "round-trip via the per-subtype format (jsonFormat1)" in {
      val cfg = MarkdownPanelConfig("# Hi")
      MarkdownPanelConfig.decode(cfg.toJson) shouldBe cfg
    }

    "Patch.decode: absent content key leaves it untouched (outer None)" in {
      MarkdownPanelConfig.Patch.decode(JsObject.empty).content shouldBe None
    }

    "Patch.decode: explicit null clears content to empty string" in {
      MarkdownPanelConfig.Patch.decode(JsObject("content" -> JsNull)).content shouldBe Some("")
    }

    "Patch.decode: present value sets content" in {
      MarkdownPanelConfig.Patch.decode(JsObject("content" -> JsString("# Body"))).content shouldBe Some("# Body")
    }

    "applyPatch: absent content key preserves the existing content" in {
      val existing = md(MarkdownPanelConfig("Hello"))
      val patched = existing.applyPatch(MarkdownPanelConfig.Patch(None))
      patched.config.content shouldBe "Hello"
    }

    "applyPatch: present content replaces the existing content" in {
      val existing = md(MarkdownPanelConfig("Old"))
      val patched = existing.applyPatch(MarkdownPanelConfig.Patch(Some("New literal markdown")))
      patched.config.content shouldBe "New literal markdown"
    }
  }

  "Exhaustiveness over Panel subtypes" should {
    "cover all 5 kinds in a closed match" in {
      val all: Seq[Panel] = Seq(text(), md(), img(), divider(), output())
      all.foreach {
        case _: TextPanel       => succeed
        case _: MarkdownPanel   => succeed
        case _: ImagePanel      => succeed
        case _: DividerPanel    => succeed
        case _: OutputPanel     => succeed
      }
    }
  }
}
