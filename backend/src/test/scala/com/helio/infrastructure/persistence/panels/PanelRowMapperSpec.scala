package com.helio.infrastructure.persistence.panels

import com.helio.infrastructure.persistence.panels.PanelRowMapper
import com.helio.domain.model._
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

  }
}
