package com.helio.infrastructure.persistence.panels

import com.helio.infrastructure.persistence.panels.PanelRowMapper
import com.helio.domain.model._
import com.helio.domain.panels._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-904 task 4.1: Text/Markdown's data-bound "Source mode" (`type_id`/
 *  `field_mapping` columns) is removed outright — both panel kinds are now
 *  literal-content-only (`content` column alone), mirroring `ImagePanel`/
 *  `DividerPanel`. */
class PanelRowMapperSpec extends AnyWordSpec with Matchers {

  private val now         = Instant.parse("2026-07-12T00:00:00Z")
  private val id          = PanelId("p-1")
  private val dashboardId = DashboardId("d-1")
  private val meta        = ResourceMeta("u", now, now)
  private val appearance  = PanelAppearance.Default
  private val owner       = UserId(UUID.randomUUID().toString)

  "PanelRowMapper" should {
    "round-trip a Text panel's content through domainToRow/rowToDomain" in {
      val panel = TextPanel(id, dashboardId, "t", meta, appearance, owner, TextPanelConfig("Just literal"))

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe TextPanel.Kind
      row.typeId shouldBe None
      row.fieldMapping shouldBe None
      row.content shouldBe Some("Just literal")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[TextPanel]
      decoded.config.content shouldBe "Just literal"
    }

    "round-trip a Markdown panel's content through domainToRow/rowToDomain" in {
      val panel = MarkdownPanel(id, dashboardId, "t", meta, appearance, owner, MarkdownPanelConfig("Just literal"))

      val row = PanelRowMapper.domainToRow(panel)
      row.panelType shouldBe MarkdownPanel.Kind
      row.typeId shouldBe None
      row.fieldMapping shouldBe None
      row.content shouldBe Some("Just literal")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[MarkdownPanel]
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
