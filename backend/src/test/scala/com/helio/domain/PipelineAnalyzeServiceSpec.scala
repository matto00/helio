package com.helio.domain

import com.helio.domain.PipelineAnalyzeService._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class PipelineAnalyzeServiceSpec extends AnyWordSpec with Matchers {

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private def field(name: String, t: String): SchemaField = SchemaField(name, t)

  private def step(op: String, config: String, position: Int = 0): PipelineStepInput =
    PipelineStepInput(id = s"step-$position", position = position, op = op, config = config)

  private val baseSchema: Vector[SchemaField] = Vector(
    field("order_id",   "string"),
    field("amount",     "number"),
    field("created_at", "string")
  )

  // ── Empty step list ───────────────────────────────────────────────────────────

  "PipelineAnalyzeService.analyze" should {

    "return an empty result for an empty step list" in {
      val result = analyze(Vector.empty, baseSchema)
      result shouldBe empty
    }

    // ── select inference ──────────────────────────────────────────────────────

    "select — filters fields present in config.fields" in {
      val steps = Vector(step("select", """{"fields":["order_id","amount"]}"""))
      val result = analyze(steps, baseSchema)

      result should have size 1
      result(0).validationError shouldBe None
      result(0).inputSchema  shouldBe baseSchema
      result(0).outputSchema shouldBe Vector(field("order_id", "string"), field("amount", "number"))
    }

    "select — empty fields list produces empty outputSchema" in {
      val steps  = Vector(step("select", """{"fields":[]}"""))
      val result = analyze(steps, baseSchema)

      result(0).outputSchema shouldBe empty
      result(0).validationError shouldBe None
    }

    "select — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("select", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    // ── rename inference ──────────────────────────────────────────────────────

    "rename — replaces field names per config.renames map" in {
      val steps  = Vector(step("rename", """{"renames":{"order_id":"id","amount":"total"}}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      val names = result(0).outputSchema.map(_.name)
      names should contain("id")
      names should contain("total")
      names should contain("created_at")
      names should not contain "order_id"
      names should not contain "amount"
    }

    "rename — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("rename", """{"renames": "not-a-map"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    // ── cast inference ────────────────────────────────────────────────────────

    "cast — retypes fields per config.casts map" in {
      val steps  = Vector(step("cast", """{"casts":{"amount":"integer"}}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema.find(_.name == "amount").map(_.`type`) shouldBe Some("integer")
      result(0).outputSchema.find(_.name == "order_id").map(_.`type`) shouldBe Some("string")
    }

    "cast — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("cast", """{"casts": 42}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    // ── filter / limit / sort identity ────────────────────────────────────────

    "filter — identity: outputSchema equals inputSchema" in {
      val steps  = Vector(step("filter", """{"expression":"amount > 0"}"""))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    "limit — identity: outputSchema equals inputSchema" in {
      val steps  = Vector(step("limit", """{"n":100}"""))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    "sort — identity: outputSchema equals inputSchema" in {
      val steps  = Vector(step("sort", """{"by":"amount","dir":"desc"}"""))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    // ── compute inference ─────────────────────────────────────────────────────

    "compute — appends the declared output field to the schema (unified config shape)" in {
      val cfg    = """{"column":"tax","expression":"$amount * 0.1","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      val names = result(0).outputSchema.map(_.name)
      names should contain allOf ("order_id", "amount", "created_at", "tax")
      result(0).outputSchema should have size (baseSchema.size + 1)
      result(0).outputSchema.last shouldBe SchemaField("tax", "number")
    }

    "compute — infers output field type from the expression, ignoring a stale wire type" in {
      val cfg    = """{"column":"label","expression":"concat($order_id, $amount)","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema.find(_.name == "label").map(_.`type`) shouldBe Some("string")
    }

    "compute — single-field-reference expression infers the referenced field's type" in {
      val cfg    = """{"column":"label","expression":"$order_id","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema.find(_.name == "label").map(_.`type`) shouldBe Some("string")
    }

    "compute — computed field is visible to downstream steps" in {
      val computeCfg = """{"column":"tax","expression":"$amount * 0.1","type":"number"}"""
      val selectCfg  = """{"fields":["order_id","tax"]}"""
      val steps = Vector(
        step("compute", computeCfg, position = 0),
        step("select",  selectCfg,  position = 1)
      )
      val result = analyze(steps, baseSchema)

      result(1).inputSchema.map(_.name) should contain ("tax")
      result(1).outputSchema.map(_.name) shouldBe Vector("order_id", "tax")
    }

    "compute — malformed config (missing column key) produces validationError and identity outputSchema" in {
      val steps  = Vector(step("compute", """{"expression":"$amount * 0.1","type":"number"}"""))
      val result = analyze(steps, baseSchema)
      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    "compute — malformed config (empty JSON) produces validationError and identity outputSchema" in {
      val steps  = Vector(step("compute", "{}"))
      val result = analyze(steps, baseSchema)
      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    "compute — a legacy bare-identifier expression is flagged with a validationError but still appends the wire-typed field" in {
      val cfg    = """{"column":"revenue","expression":"amount * 0.1","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe Some("Column references require a '$' prefix")
      result(0).outputSchema.find(_.name == "revenue").map(_.`type`) shouldBe Some("number")
    }

    "compute — an unknown $-prefixed field reference is flagged with a validationError and falls back to the wire type" in {
      val cfg    = """{"column":"x","expression":"$missing * 2","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe Some("Unknown field: missing")
      result(0).outputSchema.find(_.name == "x").map(_.`type`) shouldBe Some("number")
    }

    // ── aggregate inference ───────────────────────────────────────────────────

    "aggregate — groupBy fields plus alias fields in outputSchema" in {
      val cfg = """{
        "groupBy":[{"name":"created_at","type":"string"}],
        "aggregations":[
          {"alias":"total_amount","fn":"sum","field":"amount"},
          {"alias":"row_count","fn":"count","field":"order_id"}
        ]
      }"""
      val steps  = Vector(step("aggregate", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      val output = result(0).outputSchema
      output.map(_.name) shouldBe Vector("created_at", "total_amount", "row_count")
      output.find(_.name == "created_at").map(_.`type`) shouldBe Some("string")
      output.find(_.name == "total_amount").map(_.`type`) shouldBe Some("number")
      output.find(_.name == "row_count").map(_.`type`) shouldBe Some("integer")
    }

    "aggregate — count fn always yields integer type" in {
      val cfg = """{
        "groupBy":[],
        "aggregations":[{"alias":"cnt","fn":"count","field":"order_id"}]
      }"""
      val steps  = Vector(step("aggregate", cfg))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema.find(_.name == "cnt").map(_.`type`) shouldBe Some("integer")
    }

    "aggregate — min/max inherit the source field type from inputSchema" in {
      val cfg = """{
        "groupBy":[],
        "aggregations":[
          {"alias":"min_amt","fn":"min","field":"amount"},
          {"alias":"max_created","fn":"max","field":"created_at"}
        ]
      }"""
      val steps  = Vector(step("aggregate", cfg))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema.find(_.name == "min_amt").map(_.`type`) shouldBe Some("number")
      result(0).outputSchema.find(_.name == "max_created").map(_.`type`) shouldBe Some("string")
    }

    "aggregate — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("aggregate", """{"groupBy":"bad"}"""))
      val result = analyze(steps, baseSchema)
      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    // ── splittext inference (HEL-219) ─────────────────────────────────────────

    "splittext — valid string-body field appends indexField as integer" in {
      val schema = Vector(field("content", "string-body"))
      val steps  = Vector(step("splittext", """{"field":"content","indexField":"segmentIndex"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(
        field("content", "string-body"),
        field("segmentIndex", "integer")
      )
    }

    "splittext — unknown field is flagged at analyze time" in {
      val steps  = Vector(step("splittext", """{"field":"missing"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe Some("Unknown field 'missing'")
      result(0).outputSchema shouldBe baseSchema
    }

    "splittext — non-string-body field is flagged at analyze time" in {
      val steps  = Vector(step("splittext", """{"field":"price"}"""))
      val schema = Vector(field("price", "integer"))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe Some(
        "Field 'price' is not a content field (string-body); splittext requires a string-body field"
      )
      result(0).outputSchema shouldBe schema
    }

    "splittext — missing indexField config defaults to 'segmentIndex'" in {
      val schema = Vector(field("content", "string-body"))
      val steps  = Vector(step("splittext", """{"field":"content"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema.map(_.name) should contain("segmentIndex")
    }

    "splittext — indexField collision with an existing field replaces it (last write wins)" in {
      val schema = Vector(field("content", "string-body"), field("segmentIndex", "string"))
      val steps  = Vector(step("splittext", """{"field":"content","indexField":"segmentIndex"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(
        field("content", "string-body"),
        field("segmentIndex", "integer")
      )
    }

    "splittext — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("splittext", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    // ── extractheadings inference (HEL-220) ───────────────────────────────────

    "extractheadings — valid string-body field appends indexField and levelField as integer" in {
      val schema = Vector(field("content", "string-body"))
      val steps  = Vector(step("extractheadings", """{"field":"content","indexField":"headingIndex","levelField":"headingLevel"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(
        field("content", "string-body"),
        field("headingIndex", "integer"),
        field("headingLevel", "integer")
      )
    }

    "extractheadings — unknown field is flagged at analyze time" in {
      val steps  = Vector(step("extractheadings", """{"field":"missing"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe Some("Unknown field 'missing'")
      result(0).outputSchema shouldBe baseSchema
    }

    "extractheadings — non-string-body field is flagged at analyze time" in {
      val steps  = Vector(step("extractheadings", """{"field":"price"}"""))
      val schema = Vector(field("price", "integer"))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe Some(
        "Field 'price' is not a content field (string-body); extractheadings requires a string-body field"
      )
      result(0).outputSchema shouldBe schema
    }

    "extractheadings — missing indexField/levelField config defaults to 'headingIndex'/'headingLevel'" in {
      val schema = Vector(field("content", "string-body"))
      val steps  = Vector(step("extractheadings", """{"field":"content"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema.map(_.name) should contain allOf ("headingIndex", "headingLevel")
    }

    "extractheadings — indexField/levelField collision with existing fields replaces them (last write wins)" in {
      val schema = Vector(field("content", "string-body"), field("headingIndex", "string"), field("headingLevel", "string"))
      val steps  = Vector(step("extractheadings", """{"field":"content","indexField":"headingIndex","levelField":"headingLevel"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(
        field("content", "string-body"),
        field("headingIndex", "integer"),
        field("headingLevel", "integer")
      )
    }

    "extractheadings — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("extractheadings", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    // ── renamed-field cascade ─────────────────────────────────────────────────

    "rename cascade — renamed field is visible to downstream step" in {
      val steps = Vector(
        step("rename", """{"renames":{"order_id":"id"}}""",   position = 0),
        step("select", """{"fields":["id","amount"]}""",      position = 1)
      )
      val result = analyze(steps, baseSchema)

      result should have size 2
      // After rename, step 1 should see "id" (not "order_id")
      result(1).inputSchema.map(_.name) should contain("id")
      result(1).inputSchema.map(_.name) should not contain "order_id"
      // select then keeps only id and amount
      result(1).outputSchema.map(_.name) shouldBe Vector("id", "amount")
    }

    // ── malformed-config validationError + identity fallback ──────────────────

    "malformed config step treats as identity so downstream steps get prior schema" in {
      val steps = Vector(
        step("select", "INVALID_JSON",                        position = 0),
        step("select", """{"fields":["order_id"]}""",         position = 1)
      )
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      // Step 0 identity → step 1 inputSchema == baseSchema
      result(1).inputSchema shouldBe baseSchema
      result(1).outputSchema shouldBe Vector(field("order_id", "string"))
    }

    // ── unknown op ────────────────────────────────────────────────────────────

    "unknown op produces validationError and identity outputSchema" in {
      val steps  = Vector(step("explode", """{}"""))
      val result = analyze(steps, baseSchema)
      result(0).validationError.map(_.toLowerCase) should not be empty
      result(0).outputSchema shouldBe baseSchema
    }
  }
}
