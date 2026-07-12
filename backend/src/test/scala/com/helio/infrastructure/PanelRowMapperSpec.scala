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
  }
}
