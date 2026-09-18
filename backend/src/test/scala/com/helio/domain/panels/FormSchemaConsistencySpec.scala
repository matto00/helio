package com.helio.domain.panels

import com.helio.domain.model.{DataFieldType, DataSourceId, DatasetFieldDeclaration}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1084 task 4.1 — one case per design.md D1 (b)-(e) rule and every pinned message
 *  `FormSchemaConsistency.check` produces. */
class FormSchemaConsistencySpec extends AnyWordSpec with Matchers {

  private val declaration = Vector(
    DatasetFieldDeclaration("quantity", DataFieldType.IntegerType, required = true),
    DatasetFieldDeclaration("note", DataFieldType.StringType),
    DatasetFieldDeclaration("when", DataFieldType.TimestampType),
    DatasetFieldDeclaration("flag", DataFieldType.BooleanType)
  )

  private def config(fields: Vector[FormFieldSpec]): FormPanelConfig =
    FormPanelConfig(DataSourceId("ds-1"), fields, FormSubmitSpec.Default)

  "FormSchemaConsistency.check" should {
    "accept a config whose every field is declared, fits, and carries no options/initialValue" in {
      val cfg = config(Vector(
        FormFieldSpec("quantity", "number"),
        FormFieldSpec("note", "text")
      ))
      FormSchemaConsistency.check(cfg, declaration) shouldBe Right(())
    }

    "reject an undeclared sourceField, naming it" in {
      val cfg = config(Vector(FormFieldSpec("legacy", "text")))
      FormSchemaConsistency.check(cfg, declaration) shouldBe
        Left("field 'legacy' is not declared by the bound dataset")
    }

    "reject an unfit control, naming the fitting controls" in {
      val cfg = config(Vector(FormFieldSpec("note", "checkbox")))
      val result = FormSchemaConsistency.check(cfg, declaration)
      result.isLeft shouldBe true
      result.swap.getOrElse("") should include("note")
      result.swap.getOrElse("") should include("text, textarea, select")
    }

    "accept a fitting non-default control (text on an integer field)" in {
      val cfg = config(Vector(FormFieldSpec("quantity", "text")))
      FormSchemaConsistency.check(cfg, declaration) shouldBe Right(())
    }

    "reject options with a wrongly typed value, naming it" in {
      val cfg = config(Vector(FormFieldSpec("quantity", "select", options = Some(JsArray(JsNumber(1), JsString("two"))))))
      val result = FormSchemaConsistency.check(cfg, declaration)
      result.isLeft shouldBe true
      result.swap.getOrElse("") should include("\"two\"")
    }

    "reject empty-array options" in {
      val cfg = config(Vector(FormFieldSpec("quantity", "select", options = Some(JsArray()))))
      FormSchemaConsistency.check(cfg, declaration).isLeft shouldBe true
    }

    "reject non-array options" in {
      val cfg = config(Vector(FormFieldSpec("quantity", "select", options = Some(JsString("nope")))))
      FormSchemaConsistency.check(cfg, declaration).isLeft shouldBe true
    }

    "accept typed options that all fit the declared type" in {
      val cfg = config(Vector(FormFieldSpec("quantity", "select", options = Some(JsArray(JsNumber(1), JsNumber(2))))))
      FormSchemaConsistency.check(cfg, declaration) shouldBe Right(())
    }

    "reject a wrongly typed initialValue, naming the field" in {
      val cfg = config(Vector(FormFieldSpec("when", "text", initialValue = Some(JsString("soon")))))
      val result = FormSchemaConsistency.check(cfg, declaration)
      result.isLeft shouldBe true
      result.swap.getOrElse("") should include("when")
    }

    "accept a valid initialValue" in {
      val cfg = config(Vector(FormFieldSpec("quantity", "number", initialValue = Some(JsNumber(5)))))
      FormSchemaConsistency.check(cfg, declaration) shouldBe Right(())
    }

    "treat a null initialValue as absent" in {
      val cfg = config(Vector(FormFieldSpec("when", "text", initialValue = Some(JsNull))))
      FormSchemaConsistency.check(cfg, declaration) shouldBe Right(())
    }

    "accept an empty field list" in {
      FormSchemaConsistency.check(config(Vector.empty), declaration) shouldBe Right(())
    }
  }
}
