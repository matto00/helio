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

    // HEL-247: guard BOTH mapper directions for a Collection panel — the binding
    // rides type_id/field_mapping while baseType/layout/itemOptions ride the
    // collection_options JSONB blob. A missed write arm would silently drop the
    // config on dashboard duplicate/snapshot (the HEL-245/248 sibling-bug class),
    // so this exercises the full create→duplicate→read round-trip.
    "round-trip a Collection panel with baseType/layout/itemOptions set" in {
      val items = JsObject("metric" -> JsObject("unit" -> JsString("$"), "label" -> JsString("Revenue")))
      val panel = CollectionPanel(
        id, dashboardId, "t", meta, appearance, owner,
        CollectionPanelConfig(DataTypeId("dt1"), JsObject("value" -> JsString("amount")), "metric", "list", Some(items))
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe CollectionPanel.Kind
      row.typeId shouldBe Some("dt1")
      row.fieldMapping shouldBe Some(JsObject("value" -> JsString("amount")).compactPrint)
      row.collectionOptions shouldBe defined

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[CollectionPanel]
      decoded.config.dataTypeId shouldBe DataTypeId("dt1")
      decoded.config.fieldMapping shouldBe JsObject("value" -> JsString("amount"))
      decoded.config.baseType shouldBe "metric"
      decoded.config.layout shouldBe "list"
      decoded.config.itemOptions shouldBe Some(items)
    }

    "round-trip a Collection panel with a NULL collection_options column → defaults" in {
      // Simulate a legacy/mid-edit row: binding present, collection_options NULL.
      val panel = CollectionPanel(
        id, dashboardId, "t", meta, appearance, owner,
        CollectionPanelConfig(DataTypeId("dt1"), JsObject.empty, "metric", "grid", None)
      )

      val row = PanelRowMapper.domainToRow(panel)
      val rowNulled = row.copy(collectionOptions = None)

      val decoded = PanelRowMapper.rowToDomain(rowNulled).asInstanceOf[CollectionPanel]
      decoded.config.baseType shouldBe "metric"
      decoded.config.layout shouldBe "grid"
      decoded.config.itemOptions shouldBe None
    }

    "preserve item options under a non-active base-type key across a round-trip" in {
      // D3: options stored under a key other than the active baseType must survive.
      val items = JsObject(
        "metric" -> JsObject("unit" -> JsString("$")),
        "image"  -> JsObject("fit" -> JsString("cover"))
      )
      val panel = CollectionPanel(
        id, dashboardId, "t", meta, appearance, owner,
        CollectionPanelConfig(DataTypeId("dt1"), JsObject.empty, "metric", "grid", Some(items))
      )

      val decoded = PanelRowMapper.rowToDomain(PanelRowMapper.domainToRow(panel)).asInstanceOf[CollectionPanel]
      decoded.config.itemOptions shouldBe Some(items)
    }

    // HEL-317: guard BOTH mapper directions for a Timeline panel — the binding
    // rides type_id/field_mapping while timelineOptions.sort rides the
    // timeline_options JSONB blob. A missed write arm would silently drop the
    // config on dashboard duplicate/snapshot (the HEL-245/247/248 sibling-bug
    // class), so this exercises the full create→duplicate→read round-trip.
    "round-trip a Timeline panel with timelineOptions.sort set" in {
      val panel = TimelinePanel(
        id, dashboardId, "t", meta, appearance, owner,
        TimelinePanelConfig(
          DataTypeId("dt1"),
          JsObject("time" -> JsString("when"), "event" -> JsString("what")),
          TimelineOptions("desc")
        )
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe TimelinePanel.Kind
      row.typeId shouldBe Some("dt1")
      row.fieldMapping shouldBe Some(JsObject("time" -> JsString("when"), "event" -> JsString("what")).compactPrint)
      row.timelineOptions shouldBe defined

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[TimelinePanel]
      decoded.config.dataTypeId shouldBe DataTypeId("dt1")
      decoded.config.fieldMapping shouldBe JsObject("time" -> JsString("when"), "event" -> JsString("what"))
      decoded.config.timelineOptions shouldBe TimelineOptions("desc")
    }

    "round-trip a Timeline panel with a NULL timeline_options column → defaults" in {
      // Simulate a legacy/mid-edit row: binding present, timeline_options NULL.
      val panel = TimelinePanel(
        id, dashboardId, "t", meta, appearance, owner,
        TimelinePanelConfig(DataTypeId("dt1"), JsObject.empty, TimelineOptions("desc"))
      )

      val row = PanelRowMapper.domainToRow(panel)
      val rowNulled = row.copy(timelineOptions = None)

      val decoded = PanelRowMapper.rowToDomain(rowNulled).asInstanceOf[TimelinePanel]
      decoded.config.timelineOptions shouldBe TimelineOptions("asc")
    }

    // HEL-318: guard BOTH mapper directions for the caption/annotation text
    // columns. A missed write arm would silently drop the caption/annotation on
    // dashboard duplicate/snapshot (the HEL-245/247/248/317 sibling-bug class),
    // so this exercises the full create→duplicate→read round-trip.
    "round-trip an Image panel's caption through image_caption" in {
      val panel = ImagePanel(
        id, dashboardId, "t", meta, appearance, owner,
        ImagePanelConfig("http://x/y.png", "cover", Some("Hero photo — Reuters"))
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe ImagePanel.Kind
      row.imageCaption shouldBe Some("Hero photo — Reuters")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[ImagePanel]
      decoded.config.caption shouldBe Some("Hero photo — Reuters")
    }

    "write NULL image_caption for an Image panel with no caption; a NULL/blank column reads back as None" in {
      val panel = ImagePanel(
        id, dashboardId, "t", meta, appearance, owner,
        ImagePanelConfig("http://x/y.png", "cover", None)
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.imageCaption shouldBe None

      // Legacy/blank stored value normalizes to None on read (no empty strip).
      val blankRow = row.copy(imageCaption = Some("   "))
      PanelRowMapper.rowToDomain(blankRow).asInstanceOf[ImagePanel].config.caption shouldBe None
    }

    "round-trip a Chart panel's annotation through chart_annotation" in {
      val panel = ChartPanel(
        id, dashboardId, "t", meta, appearance, owner,
        ChartPanelConfig(DataTypeId("dt1"), JsObject.empty, None, None, Some("Source: BLS"))
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe ChartPanel.Kind
      row.chartAnnotation shouldBe Some("Source: BLS")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[ChartPanel]
      decoded.config.annotation shouldBe Some("Source: BLS")
    }

    "write NULL chart_annotation for a Chart panel with no annotation; a NULL/blank column reads back as None" in {
      val panel = ChartPanel(
        id, dashboardId, "t", meta, appearance, owner,
        ChartPanelConfig(DataTypeId("dt1"), JsObject.empty)
      )

      val row = PanelRowMapper.domainToRow(panel)
      row.chartAnnotation shouldBe None

      val blankRow = row.copy(chartAnnotation = Some("  "))
      PanelRowMapper.rowToDomain(blankRow).asInstanceOf[ChartPanel].config.annotation shouldBe None
    }
  }
}
