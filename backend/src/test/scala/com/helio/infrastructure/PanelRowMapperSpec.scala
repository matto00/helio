package com.helio.infrastructure

import com.helio.domain._
import com.helio.domain.panels._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-244: `domainToRow`/`rowToDomain` round-trip coverage for a bound Text
 *  panel — Text now populates the `panels` table's existing generic
 *  `type_id`/`field_mapping` columns (already shared by metric/chart/table),
 *  alongside its own `content` column. */
class PanelRowMapperSpec extends AnyWordSpec with Matchers {

  private val now         = Instant.parse("2026-07-12T00:00:00Z")
  private val id          = PanelId("p-1")
  private val dashboardId = DashboardId("d-1")
  private val meta        = ResourceMeta("u", now, now)
  private val appearance  = PanelAppearance.Default
  private val owner       = UserId(UUID.randomUUID().toString)

  "PanelRowMapper" should {
    "round-trip a bound Text panel's typeId/fieldMapping through domainToRow/rowToDomain" in {
      val panel = TextPanel(
        id, dashboardId, "t", meta, appearance, owner,
        TextPanelConfig("Static fallback", DataTypeId("dt1"), JsObject("content" -> JsString("headline")))
      )

      val row     = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe TextPanel.Kind
      row.typeId shouldBe Some("dt1")
      row.fieldMapping shouldBe Some(JsObject("content" -> JsString("headline")).compactPrint)
      row.content shouldBe Some("Static fallback")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[TextPanel]
      decoded.config.dataTypeId shouldBe DataTypeId("dt1")
      decoded.config.fieldMapping shouldBe JsObject("content" -> JsString("headline"))
      decoded.config.content shouldBe "Static fallback"
    }

    "round-trip an unbound Text panel (no typeId/fieldMapping columns written)" in {
      val panel = TextPanel(id, dashboardId, "t", meta, appearance, owner, TextPanelConfig("Just literal", DataTypeId(""), JsObject.empty))

      val row = PanelRowMapper.domainToRow(panel)
      row.typeId shouldBe None
      row.fieldMapping shouldBe None
      row.content shouldBe Some("Just literal")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[TextPanel]
      decoded.config.dataTypeId shouldBe DataTypeId("")
      decoded.config.fieldMapping shouldBe JsObject.empty
      decoded.config.content shouldBe "Just literal"
    }

    // HEL-245: Markdown now persists typeId/fieldMapping alongside content —
    // before this change domainToRow discarded a bound Markdown panel's
    // binding (the skeptic-verified gap), so a Source-mode Markdown panel
    // silently reverted to unbound after a round-trip through the table.
    "round-trip a bound Markdown panel's typeId/fieldMapping through domainToRow/rowToDomain" in {
      val panel = MarkdownPanel(
        id, dashboardId, "t", meta, appearance, owner,
        MarkdownPanelConfig("# Static fallback", DataTypeId("dt1"), JsObject("content" -> JsString("body")))
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe MarkdownPanel.Kind
      row.typeId shouldBe Some("dt1")
      row.fieldMapping shouldBe Some(JsObject("content" -> JsString("body")).compactPrint)
      row.content shouldBe Some("# Static fallback")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[MarkdownPanel]
      decoded.config.dataTypeId shouldBe DataTypeId("dt1")
      decoded.config.fieldMapping shouldBe JsObject("content" -> JsString("body"))
      decoded.config.content shouldBe "# Static fallback"
    }

    "round-trip an unbound Markdown panel (no typeId/fieldMapping columns written)" in {
      val panel = MarkdownPanel(id, dashboardId, "t", meta, appearance, owner, MarkdownPanelConfig("Just literal", DataTypeId(""), JsObject.empty))

      val row = PanelRowMapper.domainToRow(panel)
      row.typeId shouldBe None
      row.fieldMapping shouldBe None
      row.content shouldBe Some("Just literal")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[MarkdownPanel]
      decoded.config.dataTypeId shouldBe DataTypeId("")
      decoded.config.fieldMapping shouldBe JsObject.empty
      decoded.config.content shouldBe "Just literal"
    }

    // HEL-255: guard the table arm the same way the Markdown arm was guarded —
    // domainToRow must persist density/columnOrder (+ widths) and rowToDomain
    // must read them back, for both a fully-populated and an all-absent config.
    "round-trip a Table panel with density + columnOrder + columnWidths set" in {
      val panel = TablePanel(
        id, dashboardId, "t", meta, appearance, owner,
        TablePanelConfig(
          DataTypeId("dt1"),
          JsObject("slot" -> JsString("colA")),
          Map("a" -> 120, "b" -> 200),
          Some("spacious"),
          Some(List("b", "a"))
        )
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe TablePanel.Kind
      row.typeId shouldBe Some("dt1")
      row.columnWidths shouldBe Some(JsObject("a" -> JsNumber(120), "b" -> JsNumber(200)).compactPrint)
      row.tableDensity shouldBe Some("spacious")
      row.columnOrder shouldBe Some(JsArray(JsString("b"), JsString("a")).compactPrint)

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[TablePanel]
      decoded.config.dataTypeId shouldBe DataTypeId("dt1")
      decoded.config.columnWidths shouldBe Map("a" -> 120, "b" -> 200)
      decoded.config.density shouldBe Some("spacious")
      decoded.config.columnOrder shouldBe Some(List("b", "a"))
    }

    "round-trip a Table panel with density/columnOrder/columnWidths all absent (no columns written)" in {
      val panel = TablePanel(
        id, dashboardId, "t", meta, appearance, owner,
        TablePanelConfig(DataTypeId("dt1"), JsObject.empty)
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.columnWidths shouldBe None
      row.tableDensity shouldBe None
      row.columnOrder shouldBe None

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[TablePanel]
      decoded.config.columnWidths shouldBe Map.empty
      decoded.config.density shouldBe None
      decoded.config.columnOrder shouldBe None
    }

    // HEL-248: guard the chart arm's BOTH directions — domainToRow must
    // serialize chart_options and rowToDomain must read it back. A missed write
    // arm silently drops chartOptions on dashboard duplicate/snapshot (the
    // HEL-245/255 sibling-bug class).
    "round-trip a Chart panel with per-type chartOptions set" in {
      val opts = ChartOptions(
        line = Some(LineChartOptions(smooth = Some(true), areaFill = Some(true))),
        bar  = Some(BarChartOptions(orientation = Some("horizontal"), stacking = Some("normalized"), barGapPct = Some(30))),
        pie  = Some(PieChartOptions(donutHolePct = Some(40), showPercentLabels = Some(true)))
      )
      val panel = ChartPanel(
        id, dashboardId, "t", meta, appearance, owner,
        ChartPanelConfig(DataTypeId("dt1"), JsObject("xAxis" -> JsString("colA")), None, Some(opts))
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe ChartPanel.Kind
      row.typeId shouldBe Some("dt1")
      row.chartOptions shouldBe Some(opts.toJson.compactPrint)

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[ChartPanel]
      decoded.config.dataTypeId shouldBe DataTypeId("dt1")
      decoded.config.chartOptions shouldBe Some(opts)
    }

    "round-trip a Chart panel with chartOptions absent (NULL column → None)" in {
      val panel = ChartPanel(
        id, dashboardId, "t", meta, appearance, owner,
        ChartPanelConfig(DataTypeId("dt1"), JsObject.empty)
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.chartOptions shouldBe None

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[ChartPanel]
      decoded.config.chartOptions shouldBe None
    }
  }
}
