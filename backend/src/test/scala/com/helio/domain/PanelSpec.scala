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

    "dispatch dataTypeId correctly (bound-capable subtypes → Some, others → None)" in {
      // HEL-244 — Text joins the bound-capable set alongside metric/chart/table.
      metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty)).dataTypeId shouldBe Some(DataTypeId("dt1"))
      chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty)).dataTypeId   shouldBe Some(DataTypeId("dt1"))
      table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, Map.empty)).dataTypeId   shouldBe Some(DataTypeId("dt1"))
      text(TextPanelConfig("hi", DataTypeId("dt1"), JsObject.empty)).dataTypeId shouldBe Some(DataTypeId("dt1"))
      // HEL-245 — Markdown joins the bound-capable set alongside Text.
      md(MarkdownPanelConfig("hi", DataTypeId("dt1"), JsObject.empty)).dataTypeId shouldBe Some(DataTypeId("dt1"))
      // Empty dataTypeId on bound-capable subtype reads as None (cycle-1 read-path tolerance)
      metric().dataTypeId shouldBe None
      text().dataTypeId      shouldBe None
      md().dataTypeId        shouldBe None
      img().dataTypeId       shouldBe None
      divider().dataTypeId   shouldBe None
    }

    "build a query for bound-capable subtypes only" in {
      metric(MetricPanelConfig(DataTypeId("dt1"), JsObject("a" -> JsString("b")))).buildQuery shouldBe defined
      chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty)).buildQuery shouldBe defined
      table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, Map.empty)).buildQuery shouldBe defined
      // HEL-244 — a bound Text panel builds a query too.
      text(TextPanelConfig("hi", DataTypeId("dt1"), JsObject("content" -> JsString("headline")))).buildQuery shouldBe defined
      // HEL-245 — a bound Markdown panel builds a query too.
      md(MarkdownPanelConfig("hi", DataTypeId("dt1"), JsObject("content" -> JsString("body")))).buildQuery shouldBe defined
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

    // HEL-244 design.md Decision 1 — Text's withBindingCleared diverges from
    // Metric's blanket-Empty reset: it clears only dataTypeId/fieldMapping,
    // preserving literal content (Metric's equivalent wipes label/unit too).
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

  // ── HEL-292: MetricPanelConfig / ChartPanelConfig aggregation wiring ───────

  "MetricPanelConfig.aggregation" should {
    val agg = JsObject("value" -> JsString("rating"), "agg" -> JsString("avg"))

    "default to None when absent" in {
      MetricPanelConfig.decode(JsObject.empty).aggregation shouldBe None
    }

    "decode a present aggregation object" in {
      val decoded = MetricPanelConfig.decode(JsObject(
        "dataTypeId" -> JsString("dt1"),
        "aggregation" -> agg
      ))
      decoded.aggregation shouldBe Some(agg)
    }

    "round-trip via the per-subtype format (jsonFormat3)" in {
      val cfg     = MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, Some(agg))
      val decoded = MetricPanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "Patch.decode: absent key leaves aggregation untouched (outer None)" in {
      MetricPanelConfig.Patch.decode(JsObject("dataTypeId" -> JsString("dt1"))).aggregation shouldBe None
    }

    "Patch.decode: explicit null clears aggregation (Some(None))" in {
      MetricPanelConfig.Patch.decode(JsObject("aggregation" -> JsNull)).aggregation shouldBe Some(None)
    }

    "Patch.decode: present object sets aggregation (Some(Some(v)))" in {
      MetricPanelConfig.Patch.decode(JsObject("aggregation" -> agg)).aggregation shouldBe Some(Some(agg))
    }

    "applyPatch: absent key preserves the existing aggregation" in {
      val existing = metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, Some(agg)))
      val patched   = existing.applyPatch(MetricPanelConfig.Patch(None, None, None))
      patched.config.aggregation shouldBe Some(agg)
    }

    "applyPatch: explicit null clears a previously-set aggregation" in {
      val existing = metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, Some(agg)))
      val patched   = existing.applyPatch(MetricPanelConfig.Patch(None, None, Some(None)))
      patched.config.aggregation shouldBe None
    }

    "applyPatch: present object sets aggregation" in {
      val existing = metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, None))
      val patched   = existing.applyPatch(MetricPanelConfig.Patch(None, None, Some(Some(agg))))
      patched.config.aggregation shouldBe Some(agg)
    }
  }

  // ── HEL-293: MetricPanelConfig literal label/unit override ─────────────────

  "MetricPanelConfig.label/unit" should {
    "default to None when absent" in {
      val decoded = MetricPanelConfig.decode(JsObject.empty)
      decoded.label shouldBe None
      decoded.unit shouldBe None
    }

    "decode present label/unit strings" in {
      val decoded = MetricPanelConfig.decode(JsObject(
        "dataTypeId" -> JsString("dt1"),
        "label"      -> JsString("Total Revenue"),
        "unit"       -> JsString("USD")
      ))
      decoded.label shouldBe Some("Total Revenue")
      decoded.unit shouldBe Some("USD")
    }

    "round-trip via the per-subtype format (jsonFormat5)" in {
      val cfg     = MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, None, Some("Total Revenue"), Some("USD"))
      val decoded = MetricPanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "Patch.decode: absent key leaves label/unit untouched (outer None)" in {
      val patch = MetricPanelConfig.Patch.decode(JsObject("dataTypeId" -> JsString("dt1")))
      patch.label shouldBe None
      patch.unit shouldBe None
    }

    "Patch.decode: explicit null clears label/unit (Some(None))" in {
      val patch = MetricPanelConfig.Patch.decode(JsObject("label" -> JsNull, "unit" -> JsNull))
      patch.label shouldBe Some(None)
      patch.unit shouldBe Some(None)
    }

    "Patch.decode: present string sets label/unit (Some(Some(v)))" in {
      val patch = MetricPanelConfig.Patch.decode(JsObject(
        "label" -> JsString("Total Revenue"),
        "unit"  -> JsString("USD")
      ))
      patch.label shouldBe Some(Some("Total Revenue"))
      patch.unit shouldBe Some(Some("USD"))
    }

    "applyPatch: absent key preserves the existing label/unit" in {
      val existing = metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, None, Some("Total Revenue"), Some("USD")))
      val patched   = existing.applyPatch(MetricPanelConfig.Patch(None, None, None, None, None))
      patched.config.label shouldBe Some("Total Revenue")
      patched.config.unit shouldBe Some("USD")
    }

    "applyPatch: explicit null clears a previously-set label/unit" in {
      val existing = metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, None, Some("Total Revenue"), Some("USD")))
      val patched   = existing.applyPatch(MetricPanelConfig.Patch(None, None, None, Some(None), Some(None)))
      patched.config.label shouldBe None
      patched.config.unit shouldBe None
    }

    "applyPatch: present string sets label/unit" in {
      val existing = metric(MetricPanelConfig(DataTypeId("dt1"), JsObject.empty, None, None, None))
      val patched   = existing.applyPatch(MetricPanelConfig.Patch(None, None, None, Some(Some("Total Revenue")), Some(Some("USD"))))
      patched.config.label shouldBe Some("Total Revenue")
      patched.config.unit shouldBe Some("USD")
    }
  }

  "ChartPanelConfig.aggregation" should {
    val agg = JsObject(
      "groupBy" -> JsString("year"),
      "agg"     -> JsString("avg"),
      "yField"  -> JsString("rating")
    )

    "default to None when absent" in {
      ChartPanelConfig.decode(JsObject.empty).aggregation shouldBe None
    }

    "decode a present aggregation object" in {
      val decoded = ChartPanelConfig.decode(JsObject(
        "dataTypeId" -> JsString("dt1"),
        "aggregation" -> agg
      ))
      decoded.aggregation shouldBe Some(agg)
    }

    "round-trip via the per-subtype format (jsonFormat4)" in {
      val cfg     = ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, Some(agg))
      val decoded = ChartPanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "Patch.decode: absent key leaves aggregation untouched (outer None)" in {
      ChartPanelConfig.Patch.decode(JsObject("dataTypeId" -> JsString("dt1"))).aggregation shouldBe None
    }

    "Patch.decode: explicit null clears aggregation (Some(None))" in {
      ChartPanelConfig.Patch.decode(JsObject("aggregation" -> JsNull)).aggregation shouldBe Some(None)
    }

    "Patch.decode: present object sets aggregation (Some(Some(v)))" in {
      ChartPanelConfig.Patch.decode(JsObject("aggregation" -> agg)).aggregation shouldBe Some(Some(agg))
    }

    "applyPatch: explicit null clears a previously-set aggregation" in {
      val existing = chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, Some(agg)))
      val patched   = existing.applyPatch(ChartPanelConfig.Patch(None, None, Some(None), None))
      patched.config.aggregation shouldBe None
    }

    "applyPatch: present object sets aggregation" in {
      val existing = chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, None))
      val patched   = existing.applyPatch(ChartPanelConfig.Patch(None, None, Some(Some(agg)), None))
      patched.config.aggregation shouldBe Some(agg)
    }
  }

  // ── HEL-248: ChartPanelConfig.chartOptions per-chart-type display config ────

  "ChartPanelConfig.chartOptions" should {
    val opts = ChartOptions(
      line    = Some(LineChartOptions(smooth = Some(true), showPoints = Some(false), areaFill = Some(true))),
      bar     = Some(BarChartOptions(orientation = Some("horizontal"), stacking = Some("stacked"), barGapPct = Some(20))),
      pie     = Some(PieChartOptions(donutHolePct = Some(50), showPercentLabels = Some(true))),
      scatter = Some(ScatterChartOptions(sizeField = Some("population"), colorField = Some("region")))
    )

    "default to None when the field is ABSENT (spray-json None-omission)" in {
      ChartPanelConfig.decode(JsObject("dataTypeId" -> JsString("dt1"))).chartOptions shouldBe None
    }

    "decode a present per-type-keyed chartOptions object" in {
      val decoded = ChartPanelConfig.decode(JsObject(
        "dataTypeId"   -> JsString("dt1"),
        "chartOptions" -> opts.toJson
      ))
      decoded.chartOptions shouldBe Some(opts)
    }

    "normalize an empty chartOptions object to None" in {
      ChartPanelConfig.decode(JsObject("chartOptions" -> JsObject.empty)).chartOptions shouldBe None
    }

    "lenient decode: an unknown stacking is dropped to None (stored-row tolerance)" in {
      val decoded = ChartPanelConfig.decode(JsObject(
        "chartOptions" -> JsObject("bar" -> JsObject("stacking" -> JsString("sideways")))
      ))
      decoded.chartOptions shouldBe None
    }

    "lenient decode: an out-of-range donutHolePct is dropped to None" in {
      val decoded = ChartPanelConfig.decode(JsObject(
        "chartOptions" -> JsObject("pie" -> JsObject("donutHolePct" -> JsNumber(150)))
      ))
      decoded.chartOptions shouldBe None
    }

    "round-trip via the per-subtype format (jsonFormat4)" in {
      val cfg     = ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, None, Some(opts))
      val decoded = ChartPanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "omit absent chartOptions from the wire (spray-json None-omission)" in {
      val json = ChartPanelConfig(DataTypeId("dt1"), JsObject.empty).toJson.asJsObject
      json.fields.keySet should not contain "chartOptions"
    }

    "decodeCreate: an invalid enum is rejected (deserializationError → 400)" in {
      a[DeserializationException] should be thrownBy
        ChartPanelConfig.decodeCreate(JsObject(
          "chartOptions" -> JsObject("bar" -> JsObject("stacking" -> JsString("sideways")))
        ))
    }

    "decodeCreate: an out-of-range barGapPct is rejected" in {
      a[DeserializationException] should be thrownBy
        ChartPanelConfig.decodeCreate(JsObject(
          "chartOptions" -> JsObject("bar" -> JsObject("barGapPct" -> JsNumber(200)))
        ))
    }

    "Patch.decode: absent key leaves chartOptions untouched (outer None)" in {
      ChartPanelConfig.Patch.decode(JsObject("dataTypeId" -> JsString("dt1"))).chartOptions shouldBe None
    }

    "Patch.decode: explicit null clears chartOptions (Some(None))" in {
      ChartPanelConfig.Patch.decode(JsObject("chartOptions" -> JsNull)).chartOptions shouldBe Some(None)
    }

    "Patch.decode: present object sets chartOptions (Some(Some(v)))" in {
      ChartPanelConfig.Patch.decode(JsObject("chartOptions" -> opts.toJson)).chartOptions shouldBe Some(Some(opts))
    }

    "Patch.decode: an invalid stacking is rejected (deserializationError → 400)" in {
      a[DeserializationException] should be thrownBy
        ChartPanelConfig.Patch.decode(JsObject(
          "chartOptions" -> JsObject("bar" -> JsObject("stacking" -> JsString("sideways")))
        ))
    }

    "applyPatch: absent key preserves existing chartOptions" in {
      val existing = chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, None, Some(opts)))
      val patched  = existing.applyPatch(ChartPanelConfig.Patch(None, None, None, None))
      patched.config.chartOptions shouldBe Some(opts)
    }

    "applyPatch: explicit null clears a previously-set chartOptions" in {
      val existing = chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, None, Some(opts)))
      val patched  = existing.applyPatch(ChartPanelConfig.Patch(None, None, None, Some(None)))
      patched.config.chartOptions shouldBe None
    }

    "applyPatch: a chartOptions-only patch leaves dataTypeId/fieldMapping/aggregation untouched" in {
      val mapping  = JsObject("xAxis" -> JsString("colA"))
      val existing = chart(ChartPanelConfig(DataTypeId("dt1"), mapping, None, None))
      val patched  = existing.applyPatch(ChartPanelConfig.Patch(None, None, None, Some(Some(opts))))
      patched.config.dataTypeId shouldBe DataTypeId("dt1")
      patched.config.fieldMapping shouldBe mapping
      patched.config.chartOptions shouldBe Some(opts)
    }

    "switching type preserves other types' options (keyed map is untouched on partial edit)" in {
      // Only the bar entry changes; line/pie/scatter pass through unchanged.
      val barOnly = ChartOptions(bar = Some(BarChartOptions(stacking = Some("normalized"))))
      val existing = chart(ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, None, Some(opts)))
      val patched  = existing.applyPatch(
        ChartPanelConfig.Patch(None, None, None, Some(Some(opts.copy(bar = barOnly.bar))))
      )
      patched.config.chartOptions.flatMap(_.line) shouldBe opts.line
      patched.config.chartOptions.flatMap(_.pie) shouldBe opts.pie
      patched.config.chartOptions.flatMap(_.scatter) shouldBe opts.scatter
      patched.config.chartOptions.flatMap(_.bar).flatMap(_.stacking) shouldBe Some("normalized")
    }
  }

  // ── HEL-253: TablePanelConfig.columnWidths persistence ─────────────────────

  "TablePanelConfig.columnWidths" should {
    val widths = Map("col-a" -> 120, "col-b" -> 200)

    "default to empty map when absent" in {
      TablePanelConfig.decode(JsObject.empty).columnWidths shouldBe Map.empty
      table().config.columnWidths shouldBe Map.empty
    }

    "decode a present columnWidths object" in {
      val decoded = TablePanelConfig.decode(JsObject(
        "dataTypeId"   -> JsString("dt1"),
        "columnWidths" -> JsObject("col-a" -> JsNumber(120), "col-b" -> JsNumber(200))
      ))
      decoded.columnWidths shouldBe widths
    }

    "round-trip via the per-subtype format (jsonFormat3)" in {
      val cfg     = TablePanelConfig(DataTypeId("dt1"), JsObject.empty, widths)
      val decoded = TablePanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "Patch.decode: absent key leaves columnWidths untouched (outer None)" in {
      TablePanelConfig.Patch.decode(JsObject("dataTypeId" -> JsString("dt1"))).columnWidths shouldBe None
    }

    "Patch.decode: explicit null clears columnWidths (Some(None))" in {
      TablePanelConfig.Patch.decode(JsObject("columnWidths" -> JsNull)).columnWidths shouldBe Some(None)
    }

    "Patch.decode: present object sets columnWidths (Some(Some(v)))" in {
      val patch = TablePanelConfig.Patch.decode(JsObject(
        "columnWidths" -> JsObject("col-a" -> JsNumber(120), "col-b" -> JsNumber(200))
      ))
      patch.columnWidths shouldBe Some(Some(widths))
    }

    "applyPatch: absent key preserves the existing columnWidths" in {
      val existing = table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, widths))
      val patched   = existing.applyPatch(TablePanelConfig.Patch(None, None, None, None, None))
      patched.config.columnWidths shouldBe widths
    }

    "applyPatch: explicit null clears previously-set columnWidths" in {
      val existing = table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, widths))
      val patched   = existing.applyPatch(TablePanelConfig.Patch(None, None, Some(None), None, None))
      patched.config.columnWidths shouldBe Map.empty
    }

    "applyPatch: present object sets columnWidths" in {
      val existing = table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, Map.empty))
      val patched   = existing.applyPatch(TablePanelConfig.Patch(None, None, Some(Some(widths)), None, None))
      patched.config.columnWidths shouldBe widths
    }

    "applyPatch: a columnWidths-only patch leaves dataTypeId/fieldMapping untouched" in {
      val mapping  = JsObject("slot1" -> JsString("colA"))
      val existing = table(TablePanelConfig(DataTypeId("dt1"), mapping, Map.empty))
      val patched   = existing.applyPatch(TablePanelConfig.Patch(None, None, Some(Some(widths)), None, None))
      patched.config.dataTypeId shouldBe DataTypeId("dt1")
      patched.config.fieldMapping shouldBe mapping
    }

    "applyPatch: a binding-only patch leaves columnWidths untouched" in {
      val existing = table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, widths))
      val patched   = existing.applyPatch(TablePanelConfig.Patch(Some(Some(DataTypeId("dt2"))), None, None, None, None))
      patched.config.dataTypeId shouldBe DataTypeId("dt2")
      patched.config.columnWidths shouldBe widths
    }
  }

  // ── HEL-255: TablePanelConfig density + columnOrder display config ──────────

  "TablePanelConfig.density/columnOrder" should {
    val order = List("b", "a")

    "default to None when the fields are ABSENT (spray-json None-omission)" in {
      val decoded = TablePanelConfig.decode(JsObject("dataTypeId" -> JsString("dt1")))
      decoded.density shouldBe None
      decoded.columnOrder shouldBe None
    }

    "decode valid density and columnOrder" in {
      val decoded = TablePanelConfig.decode(JsObject(
        "dataTypeId"  -> JsString("dt1"),
        "density"     -> JsString("spacious"),
        "columnOrder" -> JsArray(JsString("b"), JsString("a"))
      ))
      decoded.density shouldBe Some("spacious")
      decoded.columnOrder shouldBe Some(order)
    }

    "lenient decode: an unknown density is treated as absent" in {
      TablePanelConfig.decode(JsObject("density" -> JsString("cozy"))).density shouldBe None
    }

    "lenient decode: a wrong-typed density is treated as absent" in {
      TablePanelConfig.decode(JsObject("density" -> JsNumber(3))).density shouldBe None
    }

    "round-trip valid values through the per-subtype format" in {
      val cfg     = TablePanelConfig(DataTypeId("dt1"), JsObject.empty, Map.empty, Some("condensed"), Some(order))
      val decoded = TablePanelConfig.decode(cfg.toJson)
      decoded shouldBe cfg
    }

    "omit absent density/columnOrder from the wire (spray-json None-omission)" in {
      val json = TablePanelConfig(DataTypeId("dt1"), JsObject.empty).toJson.asJsObject
      json.fields.keySet should not contain "density"
      json.fields.keySet should not contain "columnOrder"
    }

    "Patch.decode: absent keys leave both fields untouched (outer None)" in {
      val patch = TablePanelConfig.Patch.decode(JsObject("dataTypeId" -> JsString("dt1")))
      patch.density shouldBe None
      patch.columnOrder shouldBe None
    }

    "Patch.decode: explicit null clears each field (Some(None))" in {
      val patch = TablePanelConfig.Patch.decode(JsObject("density" -> JsNull, "columnOrder" -> JsNull))
      patch.density shouldBe Some(None)
      patch.columnOrder shouldBe Some(None)
    }

    "Patch.decode: present values set each field (Some(Some(v)))" in {
      val patch = TablePanelConfig.Patch.decode(JsObject(
        "density"     -> JsString("condensed"),
        "columnOrder" -> JsArray(JsString("b"), JsString("a"))
      ))
      patch.density shouldBe Some(Some("condensed"))
      patch.columnOrder shouldBe Some(Some(order))
    }

    "Patch.decode: an invalid density is rejected (deserializationError → 400)" in {
      a[DeserializationException] should be thrownBy
        TablePanelConfig.Patch.decode(JsObject("density" -> JsString("cozy")))
    }

    "applyPatch: absent keys preserve existing density/columnOrder" in {
      val existing = table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, Map.empty, Some("spacious"), Some(order)))
      val patched  = existing.applyPatch(TablePanelConfig.Patch(None, None, None, None, None))
      patched.config.density shouldBe Some("spacious")
      patched.config.columnOrder shouldBe Some(order)
    }

    "applyPatch: explicit null clears previously-set density/columnOrder" in {
      val existing = table(TablePanelConfig(DataTypeId("dt1"), JsObject.empty, Map.empty, Some("spacious"), Some(order)))
      val patched  = existing.applyPatch(TablePanelConfig.Patch(None, None, None, Some(None), Some(None)))
      patched.config.density shouldBe None
      patched.config.columnOrder shouldBe None
    }

    "applyPatch: a display-only patch leaves dataTypeId/fieldMapping untouched" in {
      val mapping  = JsObject("slot1" -> JsString("colA"))
      val existing = table(TablePanelConfig(DataTypeId("dt1"), mapping, Map.empty))
      val patched  = existing.applyPatch(
        TablePanelConfig.Patch(None, None, None, Some(Some("condensed")), Some(Some(order)))
      )
      patched.config.dataTypeId shouldBe DataTypeId("dt1")
      patched.config.fieldMapping shouldBe mapping
      patched.config.density shouldBe Some("condensed")
    }
  }

  // ── HEL-244: TextPanelConfig dataTypeId/fieldMapping binding wiring ────────

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
