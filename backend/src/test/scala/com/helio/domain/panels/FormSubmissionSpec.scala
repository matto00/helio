package com.helio.domain.panels

import com.helio.domain.engine.DatasetRowValidator.FieldError
import com.helio.domain.model.{DataFieldType, DataSourceId, DatasetFieldDeclaration}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1087 tasks.md 3.1 — unit coverage for `FormSubmission.buildRow` against every rule in
 *  design.md D3 (i)-(viii). */
class FormSubmissionSpec extends AnyWordSpec with Matchers {

  private def decl(name: String, t: DataFieldType, required: Boolean = false, default: Option[JsValue] = None) =
    DatasetFieldDeclaration(name, t, required, default)

  private def field(sourceField: String, control: String, required: Option[Boolean] = None, options: Option[JsValue] = None) =
    FormFieldSpec(sourceField, control, required = required, options = options)

  private def config(fields: FormFieldSpec*) = FormPanelConfig(DataSourceId("src"), fields.toVector, FormSubmitSpec.Default)

  "FormSubmission.buildRow" should {

    "reject an unconfigured key with 'not part of this form'" in {
      val declaration = Vector(decl("note", DataFieldType.StringType))
      val cfg = config(field("note", "text"))
      val result = FormSubmission.buildRow(cfg, declaration, Map("bogus" -> JsString("x"), "note" -> JsString("hi")))
      result shouldBe Left(Vector(FieldError("bogus", "not part of this form")))
    }

    "reject a value supplied for a `file` control" in {
      val declaration = Vector(decl("photo", DataFieldType.BinaryRefType))
      val cfg = config(field("photo", "file"))
      val result = FormSubmission.buildRow(cfg, declaration, Map("photo" -> JsObject("id" -> JsString("x"))))
      result shouldBe Left(Vector(FieldError("photo", "file fields are not yet supported")))
    }

    "reject a required, undeclared configured field even when unsupplied — reason wins over required" in {
      val declaration = Vector(decl("quantity", DataFieldType.IntegerType, required = true))
      val cfg = config(field("quantity", "number", required = Some(true)), field("ghost", "text", required = Some(true)))
      val result = FormSubmission.buildRow(cfg, declaration, Map("quantity" -> JsNumber(1)))
      result shouldBe Left(Vector(FieldError("ghost", "not declared by the bound dataset")))
    }

    "reject a supplied value for an undeclared configured field" in {
      val declaration = Vector(decl("quantity", DataFieldType.IntegerType, required = true))
      val cfg = config(field("quantity", "number", required = Some(true)), field("ghost", "text"))
      val result = FormSubmission.buildRow(cfg, declaration, Map("quantity" -> JsNumber(1), "ghost" -> JsString("x")))
      result shouldBe Left(Vector(FieldError("ghost", "not declared by the bound dataset")))
    }

    "ignore an unsupplied OPTIONAL undeclared field — the row builds" in {
      val declaration = Vector(decl("quantity", DataFieldType.IntegerType, required = true))
      val cfg = config(field("quantity", "number", required = Some(true)), field("ghost", "text"))
      val result = FormSubmission.buildRow(cfg, declaration, Map("quantity" -> JsNumber(1)))
      result shouldBe Right(Vector(JsNumber(1)))
    }

    "treat a blank/whitespace-only string as not supplied" in {
      val declaration = Vector(decl("note", DataFieldType.StringType, required = false, default = Some(JsString("def"))))
      val cfg = config(field("note", "text"))
      val result = FormSubmission.buildRow(cfg, declaration, Map("note" -> JsString("   ")))
      result shouldBe Right(Vector(JsString("def")))
    }

    "reject a required (form-tightened) field left unsupplied — no declared-default fill" in {
      val declaration = Vector(decl("note", DataFieldType.StringType, required = false, default = Some(JsString("def"))))
      val cfg = config(field("note", "text", required = Some(true)))
      val result = FormSubmission.buildRow(cfg, declaration, Map.empty)
      result shouldBe Left(Vector(FieldError("note", "required")))
    }

    "reject a required (declared-required) field left unsupplied" in {
      val declaration = Vector(decl("quantity", DataFieldType.IntegerType, required = true))
      val cfg = config(field("quantity", "number"))
      val result = FormSubmission.buildRow(cfg, declaration, Map.empty)
      result shouldBe Left(Vector(FieldError("quantity", "required")))
    }

    "fill the declared default for an optional configured field left unsupplied" in {
      val declaration = Vector(decl("note", DataFieldType.StringType, required = false, default = Some(JsString("def"))))
      val cfg = config(field("note", "text"))
      val result = FormSubmission.buildRow(cfg, declaration, Map.empty)
      result shouldBe Right(Vector(JsString("def")))
    }

    "reject a select value not among the configured options" in {
      val declaration = Vector(decl("status", DataFieldType.StringType))
      val cfg = config(field("status", "select", options = Some(JsArray(JsString("a"), JsString("b")))))
      val result = FormSubmission.buildRow(cfg, declaration, Map("status" -> JsString("c")))
      result shouldBe Left(Vector(FieldError("status", "not one of the configured options")))
    }

    "accept a select value among the configured options" in {
      val declaration = Vector(decl("status", DataFieldType.StringType))
      val cfg = config(field("status", "select", options = Some(JsArray(JsString("a"), JsString("b")))))
      val result = FormSubmission.buildRow(cfg, declaration, Map("status" -> JsString("a")))
      result shouldBe Right(Vector(JsString("a")))
    }

    "reject every supplied value when options is an empty array" in {
      val declaration = Vector(decl("status", DataFieldType.StringType))
      val cfg = config(field("status", "select", options = Some(JsArray.empty)))
      val result = FormSubmission.buildRow(cfg, declaration, Map("status" -> JsString("a")))
      result shouldBe Left(Vector(FieldError("status", "options are not configured")))
    }

    "reject every supplied value when options is an object, not an array" in {
      val declaration = Vector(decl("status", DataFieldType.StringType))
      val cfg = config(field("status", "select", options = Some(JsObject.empty)))
      val result = FormSubmission.buildRow(cfg, declaration, Map("status" -> JsString("a")))
      result shouldBe Left(Vector(FieldError("status", "options are not configured")))
    }

    "reject every supplied value when options is a scalar, not an array" in {
      val declaration = Vector(decl("status", DataFieldType.StringType))
      val cfg = config(field("status", "select", options = Some(JsNumber(5))))
      val result = FormSubmission.buildRow(cfg, declaration, Map("status" -> JsString("a")))
      result shouldBe Left(Vector(FieldError("status", "options are not configured")))
    }

    "build the row in DECLARED order, regardless of the form's field order" in {
      val declaration = Vector(decl("a", DataFieldType.StringType), decl("b", DataFieldType.StringType))
      val cfg = config(field("b", "text"), field("a", "text"))
      val result = FormSubmission.buildRow(cfg, declaration, Map("a" -> JsString("A"), "b" -> JsString("B")))
      result shouldBe Right(Vector(JsString("A"), JsString("B")))
    }

    "take the declared default for a field the form never configures at all" in {
      val declaration = Vector(
        decl("quantity", DataFieldType.IntegerType, required = true),
        decl("extra", DataFieldType.StringType, required = false, default = Some(JsString("def")))
      )
      val cfg = config(field("quantity", "number", required = Some(true)))
      val result = FormSubmission.buildRow(cfg, declaration, Map("quantity" -> JsNumber(1)))
      result shouldBe Right(Vector(JsNumber(1), JsString("def")))
    }

    "reject a value whose type does not match the declared type, with the pinned reason" in {
      val declaration = Vector(decl("quantity", DataFieldType.IntegerType))
      val cfg = config(field("quantity", "number"))
      val result = FormSubmission.buildRow(cfg, declaration, Map("quantity" -> JsString("5")))
      result shouldBe Left(Vector(FieldError("quantity", "expected integer, got string")))
    }

    "collect multiple errors across different fields, not short-circuit on the first" in {
      val declaration = Vector(
        decl("quantity", DataFieldType.IntegerType, required = true),
        decl("status", DataFieldType.StringType)
      )
      val cfg = config(
        field("quantity", "number", required = Some(true)),
        field("status", "select", options = Some(JsArray(JsString("a"), JsString("b"))))
      )
      val result = FormSubmission.buildRow(cfg, declaration, Map("status" -> JsString("c"), "bogus" -> JsString("x")))
      result shouldBe Left(Vector(
        FieldError("bogus", "not part of this form"),
        FieldError("quantity", "required"),
        FieldError("status", "not one of the configured options")
      ))
    }

    // evaluation-1.md CR2 — the ONE case that distinguishes layer 1 (buildRow's own per-field
    // `if (required) Left(...)`) from layer 2 (DatasetRowValidator's required check on the
    // effective declaration): a configured field the dataset declares `required: true` WITH a
    // declared default, omitted from `values`. Layer 2 alone would never catch this — the
    // effective-declaration copy only touches a FORM-required field's `required`/`default`
    // (`formRequiredNames`), and this field is not form-required, so `effectiveDeclaration`
    // leaves it exactly as declared: `required = true, default = Some("open")`. That is NOT
    // "missing, no default" from `DatasetRowValidator`'s point of view — a `JsNull` cell with a
    // present `default` is filled, never rejected (`DatasetRowValidator.scala`'s `case Some(d) =>
    // Right(d)` runs before the `required` check is ever reached). Only layer 1's OWN check
    // (`required = configRequired || declared.required`, evaluated before any row is even built)
    // rejects this.
    "reject a declared-required field with a declared default, left unsupplied — layer 1's own check, not layer 2's" in {
      val declaration = Vector(decl("status", DataFieldType.StringType, required = true, default = Some(JsString("open"))))
      val cfg = config(field("status", "text"))
      val result = FormSubmission.buildRow(cfg, declaration, Map.empty)
      result shouldBe Left(Vector(FieldError("status", "required")))
    }

    "collect a declared-type mismatch alongside a select rejection when both are the only violations" in {
      val declaration = Vector(
        decl("quantity", DataFieldType.IntegerType),
        decl("status", DataFieldType.StringType)
      )
      val cfg = config(
        field("quantity", "number"),
        field("status", "select", options = Some(JsArray(JsString("a"), JsString("b"))))
      )
      val result = FormSubmission.buildRow(cfg, declaration, Map("quantity" -> JsString("5"), "status" -> JsString("a")))
      result shouldBe Left(Vector(FieldError("quantity", "expected integer, got string")))
    }
  }
}
