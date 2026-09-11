package com.helio.domain.engine

import com.helio.domain.model.{DataFieldType, DatasetFieldDeclaration}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1076 tasks.md 2.5: unit-tests every scenario in
 *  specs/dataset-schema-validation/spec.md verbatim. */
class DatasetRowValidatorSpec extends AnyWordSpec with Matchers {

  private def decl(name: String, t: DataFieldType, required: Boolean = false, default: Option[JsValue] = None) =
    DatasetFieldDeclaration(name, t, required, default)

  "DatasetRowValidator.validate" should {

    "reject a wrong-typed value, not coerce it, with the pinned reason" in {
      val declaration = Vector(decl("age", DataFieldType.IntegerType))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsString("12"))))
      result shouldBe Left(Vector("row 0: field 'age' — expected integer, got string"))
    }

    // skeptic-final-1.md CR1: exact-string, not `include(...)` — the non-integral-integer reason
    // must use the SAME pinned "expected <type>, got <kind>" template as every other mismatch.
    "reject a non-integral number for an integer field, with the pinned reason (not a bespoke wording)" in {
      val declaration = Vector(decl("age", DataFieldType.IntegerType))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsNumber(1.5))))
      result shouldBe Left(Vector("row 0: field 'age' — expected integer, got number"))
    }

    "accept a whole number for a float field" in {
      val declaration = Vector(decl("price", DataFieldType.FloatType))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsNumber(3))))
      result shouldBe Right(Vector(Vector(JsNumber(3))))
    }

    "accept a bare date string for a timestamp field" in {
      val declaration = Vector(decl("createdAt", DataFieldType.TimestampType))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsString("2026-01-01"))))
      result shouldBe Right(Vector(Vector(JsString("2026-01-01"))))
    }

    // skeptic-final-1.md CR1: no test previously exercised the unparseable-timestamp case at all.
    "reject an unparseable string for a timestamp field, with the pinned reason (not a bespoke wording)" in {
      val declaration = Vector(decl("createdAt", DataFieldType.TimestampType))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsString("not-a-date"))))
      result shouldBe Left(Vector("row 0: field 'createdAt' — expected timestamp, got string"))
    }

    "reject a missing required field with no default, naming the field" in {
      val declaration = Vector(decl("age", DataFieldType.IntegerType, required = true))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsNull)))
      result shouldBe Left(Vector("row 0: field 'age' is required"))
    }

    "fill a missing required field from its default rather than reject" in {
      val declaration = Vector(decl("age", DataFieldType.IntegerType, required = true, default = Some(JsNumber(0))))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector.empty))
      result shouldBe Right(Vector(Vector(JsNumber(0))))
    }

    "accept a missing optional field with no default as absent (JsNull)" in {
      val declaration = Vector(decl("nickname", DataFieldType.StringType))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsNull)))
      result shouldBe Right(Vector(Vector(JsNull)))
    }

    "reject a row with more values than the declaration has fields" in {
      val declaration = Vector(decl("a", DataFieldType.StringType))
      val result = DatasetRowValidator.validate(declaration, Vector(Vector(JsString("x"), JsString("y"))))
      result shouldBe Left(Vector("row 0: expected 1 fields, got 2"))
    }

    "join multiple failures across rows with '; ' in row-then-field order" in {
      val declaration = Vector(decl("age", DataFieldType.IntegerType, required = true))
      val result = DatasetRowValidator.validate(
        declaration,
        Vector(Vector(JsString("bad")), Vector(JsNull))
      )
      result shouldBe Left(Vector(
        "row 0: field 'age' — expected integer, got string",
        "row 1: field 'age' is required"
      ))
    }

    "canonicalize 'double'/'long'/'date' synonyms via DataFieldType.validateAndCanonicalize" in {
      DataFieldType.validateAndCanonicalize("double") shouldBe Right("float")
      DataFieldType.validateAndCanonicalize("long") shouldBe Right("integer")
      DataFieldType.validateAndCanonicalize("date") shouldBe Right("timestamp")
    }
  }

  "DatasetRowValidator.validateDefault" should {

    "reject a default of the wrong type at declaration time, with the pinned message" in {
      val field = decl("age", DataFieldType.IntegerType, default = Some(JsString("not-a-number")))
      val result = DatasetRowValidator.validateDefault(field)
      result shouldBe Left(DatasetRowValidator.FieldError("age", "default expected integer, got string"))
      result.left.map(DatasetRowValidator.renderDefaultError).left.getOrElse("") shouldBe
        "field 'age' — default expected integer, got string"
    }

    "accept a default matching the field's declared type" in {
      val field = decl("age", DataFieldType.IntegerType, default = Some(JsNumber(0)))
      DatasetRowValidator.validateDefault(field) shouldBe Right(())
    }

    "accept a field with no default" in {
      val field = decl("age", DataFieldType.IntegerType)
      DatasetRowValidator.validateDefault(field) shouldBe Right(())
    }
  }
}
