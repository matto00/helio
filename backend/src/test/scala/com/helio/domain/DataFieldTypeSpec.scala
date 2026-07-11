package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Unit tests for the DataFieldType vocabulary additions (HEL-217):
 *  StringBodyType/BinaryRefType, asString/fromString round-trip, and the
 *  FieldTypeCategory classifier. */
class DataFieldTypeSpec extends AnyWordSpec with Matchers {

  import DataFieldType._

  private val allVariants: Seq[DataFieldType] =
    Seq(StringType, IntegerType, FloatType, BooleanType, TimestampType, StringBodyType, BinaryRefType)

  "DataFieldType.asString" should {

    "map all 7 variants to their canonical wire strings" in {
      asString(StringType) shouldBe "string"
      asString(IntegerType) shouldBe "integer"
      asString(FloatType) shouldBe "float"
      asString(BooleanType) shouldBe "boolean"
      asString(TimestampType) shouldBe "timestamp"
      asString(StringBodyType) shouldBe "string-body"
      asString(BinaryRefType) shouldBe "binary-ref"
    }
  }

  "DataFieldType.fromString" should {

    "round-trip through asString for all 7 variants" in {
      for (t <- allVariants) {
        fromString(asString(t)) shouldBe Some(t)
      }
    }

    "return None for an unknown type string" in {
      fromString("unknown-type") shouldBe None
    }
  }

  "DataFieldType.category" should {

    "classify the 5 structured variants as Structured" in {
      category(StringType) shouldBe FieldTypeCategory.Structured
      category(IntegerType) shouldBe FieldTypeCategory.Structured
      category(FloatType) shouldBe FieldTypeCategory.Structured
      category(BooleanType) shouldBe FieldTypeCategory.Structured
      category(TimestampType) shouldBe FieldTypeCategory.Structured
    }

    "classify the 2 content variants as Content" in {
      category(StringBodyType) shouldBe FieldTypeCategory.Content
      category(BinaryRefType) shouldBe FieldTypeCategory.Content
    }
  }
}
