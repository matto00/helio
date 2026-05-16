package com.helio.domain

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
 *  registry without test surface updates. */
class PanelSpec extends AnyWordSpec with Matchers {

  private val now = Instant.parse("2026-05-16T00:00:00Z")
  private val id  = PanelId("p-1")
  private val dashboardId = DashboardId("d-1")
  private val meta        = ResourceMeta("u", now, now)
  private val appearance  = PanelAppearance.Default
  private val owner       = UserId("u")

  // ── Per-subtype factory helpers ────────────────────────────────────────────

  private def metric(cfg: MetricPanelConfig = MetricPanelConfig.Empty): MetricPanel =
    MetricPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def chart(cfg: ChartPanelConfig = ChartPanelConfig.Empty): ChartPanel =
    ChartPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def table(cfg: TablePanelConfig = TablePanelConfig.Empty): TablePanel =
    TablePanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def text(cfg: TextPanelConfig = TextPanelConfig.Empty): TextPanel =
    TextPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def md(cfg: MarkdownPanelConfig = MarkdownPanelConfig.Empty): MarkdownPanel =
    MarkdownPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def img(cfg: ImagePanelConfig = ImagePanelConfig.Empty): ImagePanel =
    ImagePanel(id, dashboardId, "t", meta, appearance, owner, cfg)
  private def divider(cfg: DividerPanelConfig = DividerPanelConfig.Empty): DividerPanel =
    DividerPanel(id, dashboardId, "t", meta, appearance, owner, cfg)

  "Panel.Registry" should {
    "be the single source of truth for all 7 panel kinds" in {
      Panel.Registry.keySet shouldBe Set(
        MetricPanel.Kind,
        ChartPanel.Kind,
        TablePanel.Kind,
        TextPanel.Kind,
        MarkdownPanel.Kind,
        ImagePanel.Kind,
        DividerPanel.Kind
      )
    }

    "expose canonical kind strings" in {
      MetricPanel.Kind   shouldBe "metric"
      ChartPanel.Kind    shouldBe "chart"
      TablePanel.Kind    shouldBe "table"
      TextPanel.Kind     shouldBe "text"
      MarkdownPanel.Kind shouldBe "markdown"
      ImagePanel.Kind    shouldBe "image"
      DividerPanel.Kind  shouldBe "divider"
    }
  }

  "PanelKind.All" should {
    "derive from Panel.Registry" in {
      PanelKind.All shouldBe Panel.Registry.keySet
    }

    "parse known kinds and reject unknown" in {
      PanelKind.parseKind("metric") shouldBe Right("metric")
      PanelKind.parseKind("nope").isLeft shouldBe true
    }
  }

  "Each subtype" should {
    "expose its registered kind via the trait" in {
      val all: Seq[Panel] = Seq(metric(), chart(), table(), text(), md(), img(), divider())
      all.foreach { p =>
        Panel.Registry.contains(p.kind) shouldBe true
        Panel.Registry(p.kind).kind shouldBe p.kind
      }
    }

    "dispatch dataTypeId correctly (bound trio → Some, others → None)" in {
      metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty)).dataTypeId shouldBe Some(DataTypeId("dt1"))
      chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty)).dataTypeId   shouldBe Some(DataTypeId("dt1"))
      table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty)).dataTypeId   shouldBe Some(DataTypeId("dt1"))
      // Empty dataTypeId on bound subtype reads as None (cycle-1 read-path tolerance)
      metric().dataTypeId shouldBe None
      text().dataTypeId      shouldBe None
      md().dataTypeId        shouldBe None
      img().dataTypeId       shouldBe None
      divider().dataTypeId   shouldBe None
    }

    "build a query for bound subtypes only" in {
      metric(MetricPanelConfig(DataTypeId("dt1"), JsObject("a" -> JsString("b")))).buildQuery shouldBe defined
      chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty)).buildQuery shouldBe defined
      table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty)).buildQuery shouldBe defined
      // Unbound subtypes always return None
      text().buildQuery     shouldBe None
      md().buildQuery       shouldBe None
      img().buildQuery      shouldBe None
      divider().buildQuery  shouldBe None
      // Metric with empty dataTypeId also returns None (cycle-1 tolerance)
      metric().buildQuery shouldBe None
    }

    "build the correct selected fields from the field mapping" in {
      val mapping = JsObject("slot1" -> JsString("colA"), "slot2" -> JsString("colB"))
      val q       = metric(MetricPanelConfig(DataTypeId("dt1"), mapping)).buildQuery.get
      q.selectedFields should contain theSameElementsAs List("colA", "colB")
    }

    "expose validateConfig per subtype" in {
      metric().validateConfig shouldBe Right(())
      chart().validateConfig  shouldBe Right(())
      table().validateConfig  shouldBe Right(())
      text().validateConfig   shouldBe Right(())
      md().validateConfig     shouldBe Right(())
      img().validateConfig    shouldBe Right(())
      divider().validateConfig shouldBe Right(())

      // DividerPanel.weight invariant: must be positive if present.
      divider(DividerPanelConfig("horizontal", Some(0), None)).validateConfig.isLeft shouldBe true
      divider(DividerPanelConfig("horizontal", Some(-1), None)).validateConfig.isLeft shouldBe true
      divider(DividerPanelConfig("horizontal", Some(3), None)).validateConfig shouldBe Right(())
    }

    "clear bindings only for bound subtypes" in {
      val bound = metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty))
      bound.withBindingCleared.asInstanceOf[MetricPanel].config.dataTypeId.value shouldBe ""

      val image = img(ImagePanelConfig("http://example.com/x.png", "cover"))
      image.withBindingCleared shouldBe image
    }
  }

  "Per-subtype JSON config decode" should {
    "be tolerant of missing fields" in {
      MetricPanelConfig.decode(JsObject.empty)   shouldBe MetricPanelConfig.Empty
      ChartPanelConfig.decode(JsObject.empty)    shouldBe ChartPanelConfig.Empty
      TablePanelConfig.decode(JsObject.empty)    shouldBe TablePanelConfig.Empty
      TextPanelConfig.decode(JsObject.empty)     shouldBe TextPanelConfig.Empty
      MarkdownPanelConfig.decode(JsObject.empty) shouldBe MarkdownPanelConfig.Empty
      ImagePanelConfig.decode(JsObject.empty)    shouldBe ImagePanelConfig.Empty
      DividerPanelConfig.decode(JsObject.empty)  shouldBe DividerPanelConfig.Empty
    }

    "round-trip via the per-subtype format" in {
      val cfg     = MetricPanelConfig(DataTypeId("dt1"), JsObject("a" -> JsString("b")))
      val decoded = MetricPanelConfig.decode(cfg.toJson)
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

  // Exhaustiveness pattern-match — adding an 8th subtype without updating this
  // block fails compilation (non-exhaustive match warning is fatal under the
  // build's `-Xfatal-warnings` if enabled, else a runtime MatchError surfaces
  // in the test). Mirrors the CS2c-3a `PipelineStepSpec` exhaustiveness check.
  "Exhaustiveness over Panel subtypes" should {
    "cover all 7 kinds in a closed match" in {
      val all: Seq[Panel] = Seq(metric(), chart(), table(), text(), md(), img(), divider())
      all.foreach {
        case _: MetricPanel   => succeed
        case _: ChartPanel    => succeed
        case _: TablePanel    => succeed
        case _: TextPanel     => succeed
        case _: MarkdownPanel => succeed
        case _: ImagePanel    => succeed
        case _: DividerPanel  => succeed
      }
    }
  }
}
