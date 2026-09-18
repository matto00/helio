package com.helio.domain.panels

import com.helio.domain.model.{DashboardId, DataFieldType, DataSourceId, PanelAppearance, PanelId, ResourceMeta, UserId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant

/** HEL-1083: decode/encode/patch coverage for the `form` panel kind plus
 *  every structural rejection (design.md D3/D3a/D4/D5, spec requirements).
 *  Mirrors `PanelSpec`'s per-subtype sections. */
class FormPanelSpec extends AnyWordSpec with Matchers {

  private val now = Instant.parse("2026-05-16T00:00:00Z")
  private val id = PanelId("p-1")
  private val dashboardId = DashboardId("d-1")
  private val meta = ResourceMeta("u", now, now)
  private val appearance = PanelAppearance.Default
  private val owner = UserId("u")

  private def form(cfg: FormPanelConfig): FormPanel =
    FormPanel(id, dashboardId, "t", meta, appearance, owner, cfg)

  private def numberField(sourceField: String = "quantity", step: Option[Double] = None): FormFieldSpec =
    FormFieldSpec(sourceField = sourceField, control = "number", step = step)

  private def validConfig(fields: Vector[FormFieldSpec] = Vector(numberField())): FormPanelConfig =
    FormPanelConfig(DataSourceId("ds-1"), fields, FormSubmitSpec.Default)

  "FormFieldSpec.FittingControls" should {
    "declare a non-empty fitting set for every DataFieldType (task 1.1)" in {
      val allTypes = Vector(
        DataFieldType.StringType, DataFieldType.IntegerType, DataFieldType.FloatType,
        DataFieldType.BooleanType, DataFieldType.TimestampType, DataFieldType.StringBodyType,
        DataFieldType.BinaryRefType
      )
      allTypes.foreach { t =>
        FormFieldSpec.FittingControls(t) should not be empty
      }
    }

    "map binary-ref to file only" in {
      FormFieldSpec.FittingControls(DataFieldType.BinaryRefType) shouldBe Vector("file")
    }

    "expose the type's default control as the fitting set's first entry" in {
      FormFieldSpec.defaultControlFor(DataFieldType.IntegerType) shouldBe "number"
      FormFieldSpec.defaultControlFor(DataFieldType.StringType) shouldBe "text"
      FormFieldSpec.defaultControlFor(DataFieldType.BooleanType) shouldBe "checkbox"
    }
  }

  "FormPanelConfig.decode" should {
    "be tolerant of a missing/empty payload" in {
      FormPanelConfig.decode(JsObject.empty) shouldBe FormPanelConfig.Empty
    }

    "round-trip dataSourceId and control unchanged" in {
      val cfg = validConfig(Vector(FormFieldSpec("quantity", "number")))
      FormPanelConfig.decode(cfg.toJson) shouldBe cfg
    }

    "preserve field order" in {
      val cfg = validConfig(Vector(
        FormFieldSpec("a", "text"),
        FormFieldSpec("b", "text"),
        FormFieldSpec("c", "text")
      ))
      FormPanelConfig.decode(cfg.toJson).fields.map(_.sourceField) shouldBe Vector("a", "b", "c")
    }

    "reject an unrecognized field attribute (400-mapped by decodeCreate)" in {
      val json = JsObject(
        "dataSourceId" -> JsString("ds-1"),
        "fields" -> JsArray(JsObject(
          "sourceField" -> JsString("q"),
          "control"     -> JsString("number"),
          "bogus"       -> JsString("nope")
        ))
      )
      an[DeserializationException] should be thrownBy FormPanelConfig.decode(json)
      // decodeCreateConfig maps this to a clean Left, not a throw — checked
      // in PanelConfigCodecFormSpec.
    }

    // evaluation-1.md CR3: FormPanelConfig.read itself must reject an
    // unrecognized TOP-LEVEL key (e.g. a "submitt" typo), not just delegate
    // strictness to its `fields`/`submit` children — the shipped
    // schemas/panels/panel.schema.json $defs.FormConfig already declares
    // additionalProperties: false, so a silent drop here would put the
    // backend and the published contract in disagreement.
    "reject an unrecognized top-level config attribute" in {
      val json = JsObject(
        "dataSourceId" -> JsString("ds-1"),
        "fields"       -> JsArray(),
        "submitt"      -> JsObject("writeMode" -> JsString("append")),
        "bogusTopLevel" -> JsNumber(123)
      )
      the[DeserializationException] thrownBy FormPanelConfig.decode(json) should
        have message "Unrecognized form config attribute(s): bogusTopLevel, submitt"
    }

    "carry no DataFieldType of its own — a field entry has no `type` key" in {
      val cfg = validConfig()
      val fieldJson = cfg.toJson.asJsObject.fields("fields").convertTo[Vector[JsValue]].head.asJsObject
      fieldJson.fields.keySet should not contain "type"
    }

    "round-trip a file control with no upload semantics implied" in {
      val cfg = validConfig(Vector(FormFieldSpec("attachment", "file")))
      FormPanelConfig.decode(cfg.toJson) shouldBe cfg
    }

    "round-trip a positive step on a number control" in {
      val cfg = validConfig(Vector(numberField(step = Some(1))))
      FormPanelConfig.decode(cfg.toJson).fields.head.step shouldBe Some(1)
    }
  }

  "FormPanelConfig.decodeCreate" should {
    "equal decode" in {
      val json = JsObject("dataSourceId" -> JsString("ds-1"))
      FormPanelConfig.decodeCreate(json) shouldBe FormPanelConfig.decode(json)
    }
  }

  "FormPanelConfig.Patch.decode" should {
    "leave every field untouched when absent" in {
      FormPanelConfig.Patch.decode(JsObject.empty) shouldBe FormPanelConfig.Patch.Empty
    }

    "set dataSourceId, fields, and submit when present" in {
      val json = JsObject(
        "dataSourceId" -> JsString("ds-2"),
        "fields"       -> JsArray(JsObject("sourceField" -> JsString("q"), "control" -> JsString("number"))),
        "submit"       -> JsObject("writeMode" -> JsString("append"))
      )
      val patch = FormPanelConfig.Patch.decode(json)
      patch.dataSourceId shouldBe Some(DataSourceId("ds-2"))
      patch.fields.map(_.map(_.sourceField)) shouldBe Some(Vector("q"))
      patch.submit shouldBe Some(FormSubmitSpec.Default)
    }
  }

  "FormPanel.applyPatch" should {
    "preserve existing config for absent patch fields" in {
      val existing = form(validConfig())
      val patched  = existing.applyPatch(FormPanelConfig.Patch.Empty)
      patched.config shouldBe existing.config
    }

    "a step round-trips through a PATCH intact (C8)" in {
      val existing = form(validConfig(Vector(numberField(step = Some(2)))))
      val patch = FormPanelConfig.Patch(None, Some(Vector(numberField(step = Some(2)))), None)
      val patched = existing.applyPatch(patch)
      patched.config.fields.head.step shouldBe Some(2)
    }
  }

  "FormPanel.validateConfig" should {
    "accept a fully valid config" in {
      form(validConfig()).validateConfig shouldBe Right(())
    }

    "reject an empty dataSourceId" in {
      form(FormPanelConfig.Empty).validateConfig.isLeft shouldBe true
    }

    "reject a blank sourceField" in {
      form(validConfig(Vector(FormFieldSpec("   ", "text")))).validateConfig.isLeft shouldBe true
    }

    "reject a duplicate sourceField" in {
      form(validConfig(Vector(
        FormFieldSpec("q", "text"),
        FormFieldSpec("q", "number")
      ))).validateConfig.isLeft shouldBe true
    }

    "reject an unknown control" in {
      form(validConfig(Vector(FormFieldSpec("q", "unknown-control")))).validateConfig shouldBe
        Left("unknown control: 'unknown-control'. Valid values: checkbox, counter, date, file, number, select, text, textarea")
    }

    "reject a select field with no options" in {
      form(validConfig(Vector(FormFieldSpec("q", "select")))).validateConfig.isLeft shouldBe true
    }

    "accept a select field with options" in {
      form(validConfig(Vector(FormFieldSpec("q", "select", options = Some(JsArray(JsString("a"), JsString("b"))))))).validateConfig shouldBe Right(())
    }

    "reject required: false (tighten-only)" in {
      form(validConfig(Vector(FormFieldSpec("q", "text", required = Some(false))))).validateConfig.isLeft shouldBe true
    }

    "accept required: true" in {
      form(validConfig(Vector(FormFieldSpec("q", "text", required = Some(true))))).validateConfig shouldBe Right(())
    }

    "reject a non-positive step" in {
      form(validConfig(Vector(numberField(step = Some(0))))).validateConfig.isLeft shouldBe true
      form(validConfig(Vector(numberField(step = Some(-1))))).validateConfig.isLeft shouldBe true
    }

    "reject a step on a non-number control" in {
      form(validConfig(Vector(FormFieldSpec("q", "text", step = Some(1))))).validateConfig.isLeft shouldBe true
    }

    // HEL-1088 design.md Decision 5 — step is shared by number and counter now.
    "accept a step on a counter control" in {
      form(
        validConfig(Vector(FormFieldSpec("q", "counter", required = Some(true), step = Some(5)))),
      ).validateConfig shouldBe Right(())
    }

    "reject a non-positive step on a counter control" in {
      form(
        validConfig(Vector(FormFieldSpec("q", "counter", required = Some(true), step = Some(0)))),
      ).validateConfig.isLeft shouldBe true
    }

    "reject writeMode: replace naming append" in {
      val cfg = validConfig().copy(submit = FormSubmitSpec("replace"))
      form(cfg).validateConfig shouldBe Left("writeMode must be 'append'")
    }
  }
}
