package com.helio.domain.model

import com.helio.domain.model.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelKind, ResourceMeta, UserId}
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
 *  panel-kind set collapsed to output|text|markdown|image|divider. */
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

    "dispatch dataTypeId correctly (bound-capable subtypes -> Some, others -> None)" in {
      text(TextPanelConfig("hi", DataTypeId("dt1"), JsObject.empty)).dataTypeId shouldBe Some(DataTypeId("dt1"))
      md(MarkdownPanelConfig("hi", DataTypeId("dt1"), JsObject.empty)).dataTypeId shouldBe Some(DataTypeId("dt1"))
      text().dataTypeId      shouldBe None
      md().dataTypeId        shouldBe None
      img().dataTypeId       shouldBe None
      divider().dataTypeId   shouldBe None
      // OutputPanel never has a meaning for the legacy dataTypeId accessor.
      output().dataTypeId    shouldBe None
    }

    "build a query for bound-capable subtypes only" in {
      text(TextPanelConfig("hi", DataTypeId("dt1"), JsObject("content" -> JsString("headline")))).buildQuery shouldBe defined
      md(MarkdownPanelConfig("hi", DataTypeId("dt1"), JsObject("content" -> JsString("body")))).buildQuery shouldBe defined
      text().buildQuery     shouldBe None
      md().buildQuery       shouldBe None
      img().buildQuery      shouldBe None
      divider().buildQuery  shouldBe None
      // OutputPanel data comes from NodeSnapshotRepository/OutputRepository, not
      // the DataTypeId-keyed PanelQuery path.
      output().buildQuery   shouldBe None
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

    "clear bindings only for bound subtypes" in {
      val bound = text(TextPanelConfig("hi", DataTypeId("dt1"), JsObject.empty))
      bound.withBindingCleared.asInstanceOf[TextPanel].config.dataTypeId.value shouldBe ""

      val image = img(ImagePanelConfig("http://example.com/x.png", "cover"))
      image.withBindingCleared shouldBe image

      val out = output(OutputPanelConfig(OutputId("out-1")))
      out.withBindingCleared.asInstanceOf[OutputPanel].config.outputId.value shouldBe ""
    }

    // HEL-244 design.md Decision 1 -- Text's withBindingCleared diverges from
    // a blanket-Empty reset: it clears only dataTypeId/fieldMapping,
    // preserving literal content.
    "preserve literal content when clearing a Text panel's binding (Decision 1 divergence)" in {
      val bound = text(TextPanelConfig("Hello world", DataTypeId("dt1"), JsObject("content" -> JsString("headline"))))
      val cleared = bound.withBindingCleared.asInstanceOf[TextPanel]
      cleared.config.dataTypeId shouldBe DataTypeId("")
      cleared.config.fieldMapping shouldBe JsObject.empty
      cleared.config.content shouldBe "Hello world"
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

  "TextPanelConfig.dataTypeId/fieldMapping" should {
    "default to empty when absent" in {
      val decoded = TextPanelConfig.decode(JsObject.empty)
      decoded.dataTypeId shouldBe DataTypeId("")
      decoded.fieldMapping shouldBe JsObject.empty
      decoded.content shouldBe ""
    }

    "decode present dataTypeId/fieldMapping alongside content" in {
      val decoded = TextPanelConfig.decode(JsObject(
        "content"      -> JsString("Static fallback"),
        "dataTypeId"   -> JsString("dt1"),
        "fieldMapping" -> JsObject("content" -> JsString("headline"))
      ))
      decoded.content shouldBe "Static fallback"
      decoded.dataTypeId shouldBe DataTypeId("dt1")
      decoded.fieldMapping shouldBe JsObject("content" -> JsString("headline"))
    }

    "round-trip via the per-subtype format (jsonFormat3)" in {
      val cfg = TextPanelConfig("Hi", DataTypeId("dt1"), JsObject("content" -> JsString("headline")))
      val decoded = TextPanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "Patch.decode: absent dataTypeId/fieldMapping key leaves them untouched (outer None)" in {
      val patch = TextPanelConfig.Patch.decode(JsObject("content" -> JsString("x")))
      patch.dataTypeId shouldBe None
      patch.fieldMapping shouldBe None
    }

    "Patch.decode: explicit null clears dataTypeId/fieldMapping (Some(None))" in {
      val patch = TextPanelConfig.Patch.decode(JsObject("dataTypeId" -> JsNull, "fieldMapping" -> JsNull))
      patch.dataTypeId shouldBe Some(None)
      patch.fieldMapping shouldBe Some(None)
    }

    "Patch.decode: present value sets dataTypeId/fieldMapping (Some(Some(v)))" in {
      val patch = TextPanelConfig.Patch.decode(JsObject(
        "dataTypeId"   -> JsString("dt1"),
        "fieldMapping" -> JsObject("content" -> JsString("headline"))
      ))
      patch.dataTypeId shouldBe Some(Some(DataTypeId("dt1")))
      patch.fieldMapping shouldBe Some(Some(JsObject("content" -> JsString("headline"))))
    }

    "applyPatch: absent content key preserves the existing content (existing convention, unaffected)" in {
      val existing = text(TextPanelConfig("Hello", DataTypeId(""), JsObject.empty))
      val patched = existing.applyPatch(TextPanelConfig.Patch(None, None, None))
      patched.config.content shouldBe "Hello"
    }

    "applyPatch: dataTypeId/fieldMapping patch alongside absent content leaves content untouched" in {
      // HEL-244 design.md Decision 1's bind-direction corollary: a Source-mode
      // save patches only dataTypeId/fieldMapping (content key omitted
      // entirely), and TextPanelConfig.Patch's "absent = unchanged" convention
      // for content means the prior literal text survives untouched.
      val existing = text(TextPanelConfig("Prior literal text", DataTypeId(""), JsObject.empty))
      val patch = TextPanelConfig.Patch(
        content      = None,
        dataTypeId   = Some(Some(DataTypeId("dt1"))),
        fieldMapping = Some(Some(JsObject("content" -> JsString("headline"))))
      )
      val patched = existing.applyPatch(patch)
      patched.config.dataTypeId shouldBe DataTypeId("dt1")
      patched.config.fieldMapping shouldBe JsObject("content" -> JsString("headline"))
      patched.config.content shouldBe "Prior literal text"
    }

    "applyPatch: a Static-mode save sets content and clears any prior binding" in {
      val existing = text(TextPanelConfig("Old", DataTypeId("dt1"), JsObject("content" -> JsString("headline"))))
      val patch = TextPanelConfig.Patch(
        content      = Some("New literal text"),
        dataTypeId   = Some(None),
        fieldMapping = Some(None)
      )
      val patched = existing.applyPatch(patch)
      patched.config.content shouldBe "New literal text"
      patched.config.dataTypeId shouldBe DataTypeId("")
      patched.config.fieldMapping shouldBe JsObject.empty
    }

    "buildQuery selects the mapped field for a bound Text panel" in {
      val bound = text(TextPanelConfig("", DataTypeId("dt1"), JsObject("content" -> JsString("headline"))))
      val query = bound.buildQuery.get
      query.selectedFields should contain theSameElementsAs List("headline")
    }
  }

  // ── HEL-245: MarkdownPanelConfig dataTypeId/fieldMapping binding wiring ─────

  "MarkdownPanelConfig.dataTypeId/fieldMapping" should {
    "default to empty when absent (spray-json omits Option=None; here fields are simply absent)" in {
      val decoded = MarkdownPanelConfig.decode(JsObject.empty)
      decoded.dataTypeId shouldBe DataTypeId("")
      decoded.fieldMapping shouldBe JsObject.empty
      decoded.content shouldBe ""
    }

    "decode present dataTypeId/fieldMapping alongside content" in {
      val decoded = MarkdownPanelConfig.decode(JsObject(
        "content"      -> JsString("# Static fallback"),
        "dataTypeId"   -> JsString("dt1"),
        "fieldMapping" -> JsObject("content" -> JsString("body"))
      ))
      decoded.content shouldBe "# Static fallback"
      decoded.dataTypeId shouldBe DataTypeId("dt1")
      decoded.fieldMapping shouldBe JsObject("content" -> JsString("body"))
    }

    "round-trip via the per-subtype format (jsonFormat3)" in {
      val cfg = MarkdownPanelConfig("# Hi", DataTypeId("dt1"), JsObject("content" -> JsString("body")))
      val decoded = MarkdownPanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "Patch.decode: absent dataTypeId/fieldMapping key leaves them untouched (outer None)" in {
      val patch = MarkdownPanelConfig.Patch.decode(JsObject("content" -> JsString("x")))
      patch.dataTypeId shouldBe None
      patch.fieldMapping shouldBe None
    }

    "Patch.decode: explicit null clears dataTypeId/fieldMapping (Some(None))" in {
      val patch = MarkdownPanelConfig.Patch.decode(JsObject("dataTypeId" -> JsNull, "fieldMapping" -> JsNull))
      patch.dataTypeId shouldBe Some(None)
      patch.fieldMapping shouldBe Some(None)
    }

    "Patch.decode: present value sets dataTypeId/fieldMapping (Some(Some(v)))" in {
      val patch = MarkdownPanelConfig.Patch.decode(JsObject(
        "dataTypeId"   -> JsString("dt1"),
        "fieldMapping" -> JsObject("content" -> JsString("body"))
      ))
      patch.dataTypeId shouldBe Some(Some(DataTypeId("dt1")))
      patch.fieldMapping shouldBe Some(Some(JsObject("content" -> JsString("body"))))
    }

    "applyPatch: absent content key preserves the existing content (existing convention, unaffected)" in {
      val existing = md(MarkdownPanelConfig("Hello", DataTypeId(""), JsObject.empty))
      val patched = existing.applyPatch(MarkdownPanelConfig.Patch(None, None, None))
      patched.config.content shouldBe "Hello"
    }

    "applyPatch: dataTypeId/fieldMapping patch alongside absent content leaves content untouched (Source-mode save)" in {
      val existing = md(MarkdownPanelConfig("Prior literal markdown", DataTypeId(""), JsObject.empty))
      val patch = MarkdownPanelConfig.Patch(
        content      = None,
        dataTypeId   = Some(Some(DataTypeId("dt1"))),
        fieldMapping = Some(Some(JsObject("content" -> JsString("body"))))
      )
      val patched = existing.applyPatch(patch)
      patched.config.dataTypeId shouldBe DataTypeId("dt1")
      patched.config.fieldMapping shouldBe JsObject("content" -> JsString("body"))
      patched.config.content shouldBe "Prior literal markdown"
    }

    "applyPatch: a Static-mode save sets content and clears any prior binding" in {
      val existing = md(MarkdownPanelConfig("Old", DataTypeId("dt1"), JsObject("content" -> JsString("body"))))
      val patch = MarkdownPanelConfig.Patch(
        content      = Some("New literal markdown"),
        dataTypeId   = Some(None),
        fieldMapping = Some(None)
      )
      val patched = existing.applyPatch(patch)
      patched.config.content shouldBe "New literal markdown"
      patched.config.dataTypeId shouldBe DataTypeId("")
      patched.config.fieldMapping shouldBe JsObject.empty
    }

    "withBindingCleared preserves literal content (Decision 1 divergence, mirrors Text)" in {
      val bound = md(MarkdownPanelConfig("# Hello world", DataTypeId("dt1"), JsObject("content" -> JsString("body"))))
      val cleared = bound.withBindingCleared.asInstanceOf[MarkdownPanel]
      cleared.config.dataTypeId shouldBe DataTypeId("")
      cleared.config.fieldMapping shouldBe JsObject.empty
      cleared.config.content shouldBe "# Hello world"
    }

    "buildQuery selects the mapped field for a bound Markdown panel" in {
      val bound = md(MarkdownPanelConfig("", DataTypeId("dt1"), JsObject("content" -> JsString("body"))))
      val query = bound.buildQuery.get
      query.selectedFields should contain theSameElementsAs List("body")
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
