package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

class SchemaInferenceEngineSpec extends AnyWordSpec with Matchers {

  import DataFieldType._
  import SchemaInferenceEngine._

  // ---------------------------------------------------------------------------
  // JSON tests
  // ---------------------------------------------------------------------------

  "SchemaInferenceEngine.fromJson" should {

    "infer fields from a root JsObject with mixed types" in {
      val json = """{"id": 1, "name": "Alice", "active": true}""".parseJson
      val schema = fromJson(json)
      val fields = schema.fields.map(f => f.name -> f.dataType).toMap
      fields("id")     shouldBe IntegerType
      fields("name")   shouldBe StringType
      fields("active") shouldBe BooleanType
      schema.fields.forall(!_.nullable) shouldBe true
    }

    "infer union of keys from a root JsArray" in {
      val json = """[{"x": 1}, {"x": 2, "y": "hello"}]""".parseJson
      val schema = fromJson(json)
      schema.fields.map(_.name) should contain allOf ("x", "y")
    }

    "return empty schema for non-object/array root" in {
      fromJson(JsString("hello")).fields shouldBe empty
      fromJson(JsNumber(42)).fields      shouldBe empty
    }

    "flatten nested objects with dot notation" in {
      val json = """{"address": {"city": "London", "zip": "EC1"}}""".parseJson
      val schema = fromJson(json)
      schema.fields.map(_.name) should contain allOf ("address.city", "address.zip")
      schema.fields.find(_.name == "address.city").get.dataType shouldBe StringType
    }

    "mark field nullable when any object has null for that key" in {
      val json = """[{"ts": "2024-01-01"}, {"ts": null}]""".parseJson
      val schema = fromJson(json)
      schema.fields.find(_.name == "ts").get.nullable shouldBe true
    }

    "infer IntegerType for whole numbers" in {
      val json = """{"count": 42}""".parseJson
      fromJson(json).fields.head.dataType shouldBe IntegerType
    }

    "infer FloatType for numbers with decimal" in {
      val json = """{"ratio": 3.14}""".parseJson
      fromJson(json).fields.head.dataType shouldBe FloatType
    }

    "infer TimestampType from ISO-8601 date string" in {
      val json = """{"created": "2024-01-15"}""".parseJson
      fromJson(json).fields.head.dataType shouldBe TimestampType
    }

    "infer TimestampType from ISO-8601 datetime string" in {
      val json = """{"ts": "2024-01-15T10:30:00Z"}""".parseJson
      fromJson(json).fields.head.dataType shouldBe TimestampType
    }

    "keep StringType for non-timestamp strings" in {
      val json = """{"label": "hello world"}""".parseJson
      fromJson(json).fields.head.dataType shouldBe StringType
    }

    "return empty schema for empty JsArray" in {
      fromJson(JsArray()).fields shouldBe empty
    }
  }

  // ---------------------------------------------------------------------------
  // CSV tests
  // ---------------------------------------------------------------------------

  "SchemaInferenceEngine.fromCsv" should {

    "use header row as field names" in {
      val csv = "id,name,score\n1,Alice,9.5"
      fromCsv(csv).fields.map(_.name) shouldBe Seq("id", "name", "score")
    }

    "infer IntegerType when all values are whole numbers" in {
      val csv = "count\n1\n2\n3"
      fromCsv(csv).fields.head.dataType shouldBe IntegerType
    }

    "widen to FloatType when column contains a decimal" in {
      val csv = "value\n1\n1.5\n3"
      fromCsv(csv).fields.head.dataType shouldBe FloatType
    }

    "infer BooleanType when all values are true/false (case-insensitive)" in {
      val csv = "flag\ntrue\nFalse\nTRUE"
      fromCsv(csv).fields.head.dataType shouldBe BooleanType
    }

    "infer TimestampType when all values match a date pattern" in {
      val csv = "created\n2024-01-01\n2024-06-15"
      fromCsv(csv).fields.head.dataType shouldBe TimestampType
    }

    "fall back to StringType for mixed values" in {
      val csv = "mixed\n1\nhello\n3"
      fromCsv(csv).fields.head.dataType shouldBe StringType
    }

    "mark field nullable when any cell is empty" in {
      val csv = "val\n1\n\n3"
      fromCsv(csv).fields.head.nullable shouldBe true
    }

    "not mark field nullable when no empty cells" in {
      val csv = "val\n1\n2\n3"
      fromCsv(csv).fields.head.nullable shouldBe false
    }

    "cap sampling at 100 rows" in {
      // Rows 1-100 are integers; row 101 is "hello" — should NOT affect the result
      val dataRows = (1 to 100).map(_.toString) ++ Seq("hello")
      val csv = "val\n" + dataRows.mkString("\n")
      fromCsv(csv).fields.head.dataType shouldBe IntegerType
    }

    "handle a CSV with only a header row" in {
      val csv = "id,name"
      val schema = fromCsv(csv)
      schema.fields.map(_.name) shouldBe Seq("id", "name")
      schema.fields.forall(_.dataType == StringType) shouldBe true
    }

    "return empty schema for empty CSV" in {
      fromCsv("").fields shouldBe empty
    }

    "parse quoted field containing a comma as a single field" in {
      val csv = "name,age\n\"Smith, John\",30"
      val schema = fromCsv(csv)
      schema.fields.map(_.name) shouldBe Seq("name", "age")
      schema.fields.find(_.name == "age").get.dataType shouldBe DataFieldType.IntegerType
    }

    "unescape double-quotes inside quoted fields" in {
      val csv = "label\n\"say \"\"hello\"\"\""
      val schema = fromCsv(csv)
      schema.fields.head.dataType shouldBe DataFieldType.StringType
    }

    "accept CRLF line endings" in {
      val csv = "id,name\r\n1,Alice\r\n2,Bob"
      val schema = fromCsv(csv)
      schema.fields.map(_.name) shouldBe Seq("id", "name")
      schema.fields.find(_.name == "id").get.dataType shouldBe DataFieldType.IntegerType
    }
  }

  // ---------------------------------------------------------------------------
  // displayName tests
  // ---------------------------------------------------------------------------

  "SchemaInferenceEngine.displayName" should {

    "convert snake_case to title case" in {
      displayName("created_at") shouldBe "Created At"
    }

    "convert camelCase to title case" in {
      displayName("firstName") shouldBe "First Name"
    }

    "convert dot-separated path to title case" in {
      displayName("address.city") shouldBe "Address City"
    }

    "handle single-word names" in {
      displayName("name") shouldBe "Name"
    }

    "handle mixed snake and camel" in {
      displayName("user_firstName") shouldBe "User First Name"
    }
  }

  // ---------------------------------------------------------------------------
  // DataFieldType.asString
  // ---------------------------------------------------------------------------

  "DataFieldType.asString" should {

    "return canonical lowercase strings" in {
      DataFieldType.asString(StringType)    shouldBe "string"
      DataFieldType.asString(IntegerType)   shouldBe "integer"
      DataFieldType.asString(FloatType)     shouldBe "float"
      DataFieldType.asString(BooleanType)   shouldBe "boolean"
      DataFieldType.asString(TimestampType) shouldBe "timestamp"
    }
  }
}
