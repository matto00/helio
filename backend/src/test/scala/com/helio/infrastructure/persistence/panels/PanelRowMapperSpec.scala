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
      row.kind shouldBe TextPanel.Kind
      row.content shouldBe Some("Just literal")

      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[TextPanel]
      decoded.config.content shouldBe "Just literal"
    }

    "round-trip a Markdown panel's content through domainToRow/rowToDomain" in {
      val panel = MarkdownPanel(id, dashboardId, "t", meta, appearance, owner, MarkdownPanelConfig("Just literal"))

      val row = PanelRowMapper.domainToRow(panel)
      row.kind shouldBe MarkdownPanel.Kind
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
      row.kind shouldBe ImagePanel.Kind
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

  // HEL-1083: `rowToDomain` ends in `case _ => OutputPanel(...)` — a `form`
  // row omitted from the explicit `FormPanel.Kind` arm decodes SILENTLY as
  // an output panel. This spec calls `rowToDomain` DIRECTLY (not through an
  // HTTP create-response echo), so it actually traverses the mutated code —
  // task 4.7's mutation-evidence transcript deletes the `form` arm and
  // records this test (and `FormPanelRoundTripSpec`'s 4.3b/4.4) going red.
  "PanelRowMapper — form kind (HEL-1083, design.md D8/D9)" should {
    "round-trip a Form panel's dataSourceId/fields/submit through domainToRow/rowToDomain" in {
      val cfg = FormPanelConfig(
        DataSourceId("ds-1"),
        Vector(FormFieldSpec("quantity", "number", step = Some(1))),
        FormSubmitSpec.Default
      )
      val panel = FormPanel(id, dashboardId, "t", meta, appearance, owner, cfg)

      val row = PanelRowMapper.domainToRow(panel)
      row.kind shouldBe FormPanel.Kind
      row.formConfig should not be None

      val decoded = PanelRowMapper.rowToDomain(row)
      decoded shouldBe a[FormPanel]
      decoded.asInstanceOf[FormPanel].config shouldBe cfg
    }

    "never decode a form row as an OutputPanel" in {
      val cfg   = FormPanelConfig(DataSourceId("ds-1"), Vector.empty, FormSubmitSpec.Default)
      val panel = FormPanel(id, dashboardId, "t", meta, appearance, owner, cfg)
      val row   = PanelRowMapper.domainToRow(panel)

      PanelRowMapper.rowToDomain(row) should not be a[OutputPanel]
    }

    // 4.9 (C11) — the tolerant read path: a stored `form_config` carrying an
    // attribute this build doesn't recognize (e.g. written by a later
    // version, or a rolled-back deploy) must stay READABLE, never 500.
    "decode an unrecognized stored form_config attribute as Empty, never throwing" in {
      val malformed = JsObject(
        "dataSourceId" -> JsString("ds-1"),
        "fields" -> JsArray(JsObject(
          "sourceField" -> JsString("q"),
          "control"     -> JsString("number"),
          "min"         -> JsNumber(0) // not yet a recognized attribute
        ))
      ).compactPrint

      val row = PanelRowMapper.domainToRow(
        FormPanel(id, dashboardId, "t", meta, appearance, owner, FormPanelConfig.Empty)
      ).copy(formConfig = Some(malformed))

      noException should be thrownBy PanelRowMapper.rowToDomain(row)
      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[FormPanel]
      decoded.config shouldBe FormPanelConfig.Empty
    }

    // evaluation-1.md CR3: the top-level AllowedKeys check added to
    // FormPanelConfig.read is a decode-time failure just like a field-level
    // one, so it must ALSO stay tolerant on read (D9 layer iii / C11) — a
    // stored row carrying an unrecognized top-level key (e.g. from a rolled-
    // back future version) must decode to Empty + a logged warning, never a
    // 500-on-read.
    "decode an unrecognized stored form_config TOP-LEVEL attribute as Empty, never throwing" in {
      val malformed = JsObject(
        "dataSourceId"  -> JsString("ds-1"),
        "fields"        -> JsArray(),
        "bogusTopLevel" -> JsNumber(123)
      ).compactPrint

      val row = PanelRowMapper.domainToRow(
        FormPanel(id, dashboardId, "t", meta, appearance, owner, FormPanelConfig.Empty)
      ).copy(formConfig = Some(malformed))

      noException should be thrownBy PanelRowMapper.rowToDomain(row)
      val decoded = PanelRowMapper.rowToDomain(row).asInstanceOf[FormPanel]
      decoded.config shouldBe FormPanelConfig.Empty
    }
  }
}
