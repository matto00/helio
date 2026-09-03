package com.helio.domain.engine

import com.helio.domain.engine.SchemaField
import com.helio.domain.engine.PipelineAnalyzeService._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class PipelineAnalyzeServiceSpec extends AnyWordSpec with Matchers {


  private def field(name: String, t: String): SchemaField = SchemaField(name, t)

  private def step(op: String, config: String, position: Int = 0): PipelineStepInput =
    PipelineStepInput(id = s"step-$position", position = position, op = op, config = config)

  private val baseSchema: Vector[SchemaField] = Vector(
    field("order_id",   "string"),
    field("amount",     "float"),
    field("created_at", "string")
  )


  "PipelineAnalyzeService.analyze" should {

    "return an empty result for an empty step list" in {
      val result = analyze(Vector.empty, baseSchema)
      result shouldBe empty
    }


    "select — filters fields present in config.fields" in {
      val steps = Vector(step("select", """{"fields":["order_id","amount"]}"""))
      val result = analyze(steps, baseSchema)

      result should have size 1
      result(0).validationError shouldBe None
      result(0).inputSchema  shouldBe baseSchema
      result(0).outputSchema shouldBe Vector(field("order_id", "string"), field("amount", "float"))
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

    "cast — non-canonical legacy target types (double/long/date) are canonicalized (HEL-895/638/906 cycle 3)" in {
      val steps  = Vector(step("cast", """{"casts":{"amount":"double","order_id":"long","created_at":"date"}}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema.find(_.name == "amount").map(_.`type`) shouldBe Some("float")
      result(0).outputSchema.find(_.name == "order_id").map(_.`type`) shouldBe Some("integer")
      result(0).outputSchema.find(_.name == "created_at").map(_.`type`) shouldBe Some("timestamp")
    }


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

    "dedupe — identity: outputSchema equals inputSchema" in {
      val steps  = Vector(step("dedupe", """{"keys":["order_id"],"keep":"first"}"""))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    "fillnull — identity: outputSchema equals inputSchema" in {
      val steps  = Vector(step("fillnull", """{"columns":["amount"],"strategy":"mean"}"""))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    // HEL-384 — union: documented best-effort passthrough (design.md Decision
    // 6). The other source's schema isn't resolved at analyze time, so the
    // output schema is exactly the input schema unchanged, and — unlike
    // JoinStep, which has no case here at all — this is a real dispatch case,
    // so no validationError is emitted.
    "union — identity passthrough: outputSchema equals inputSchema, no validationError" in {
      val steps  = Vector(step("union", """{"secondaryInput":{"kind":"source","dataSourceId":"ds-2"},"mode":"byName"}"""))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    // HEL-386 — lookup: additive best-effort typing (design.md Decision 7).
    // The reference source's schema isn't resolved at analyze time, so each
    // requested `columns` entry is appended typed string, and this is a real
    // dispatch case — no validationError is emitted.
    "lookup — appends the requested columns typed string, no validationError" in {
      val cfg = """{"secondaryInput":{"kind":"source","dataSourceId":"ds-2"},"sourceKey":"order_id","lookupKey":"code","columns":["label","category"]}"""
      val steps  = Vector(step("lookup", cfg))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe (baseSchema :+ field("label", "string") :+ field("category", "string"))
      result(0).validationError shouldBe None
    }

    "lookup — replaces an existing same-named field in place rather than duplicating it" in {
      val cfg = """{"secondaryInput":{"kind":"source","dataSourceId":"ds-2"},"sourceKey":"order_id","lookupKey":"code","columns":["amount"]}"""
      val steps  = Vector(step("lookup", cfg))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe Vector(
        field("order_id", "string"), field("created_at", "string"), field("amount", "string")
      )
      result(0).validationError shouldBe None
    }

    "lookup — empty columns is a no-op, outputSchema equals inputSchema" in {
      val cfg = """{"secondaryInput":{"kind":"source","dataSourceId":"ds-2"},"sourceKey":"order_id","lookupKey":"code","columns":[]}"""
      val steps  = Vector(step("lookup", cfg))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }


    "assert — identity output schema, no validationError for a well-formed config" in {
      val cfg = """{"rules":[{"kind":"notNull","field":"order_id","params":{},"severity":"error"}]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    "assert — empty rules produces identity output schema and no validationError" in {
      val steps  = Vector(step("assert", """{"rules":[]}"""))
      val result = analyze(steps, baseSchema)
      result(0).outputSchema shouldBe baseSchema
      result(0).validationError shouldBe None
    }

    "assert — unknown field on a notNull rule produces a validationError naming the field, output schema unchanged" in {
      val cfg = """{"rules":[{"kind":"notNull","field":"missing_field","params":{},"severity":"error"}]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).validationError.get should include ("missing_field")
      result(0).outputSchema shouldBe baseSchema
    }

    "assert — invalid kind produces a validationError naming the kind, output schema unchanged" in {
      val cfg = """{"rules":[{"kind":"bogus","field":null,"params":{},"severity":"error"}]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).validationError.get should include ("bogus")
      result(0).outputSchema shouldBe baseSchema
    }

    "assert — invalid severity produces a validationError naming the severity, output schema unchanged" in {
      val cfg = """{"rules":[{"kind":"unique","field":"order_id","params":{},"severity":"critical"}]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).validationError.get should include ("critical")
      result(0).outputSchema shouldBe baseSchema
    }

    "assert — rowCountMin rule is not checked against field, no validationError from an absent field" in {
      val cfg = """{"rules":[{"kind":"rowCountMin","field":null,"params":{"count":1},"severity":"warn"}]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema
    }

    "assert — rowCountMax rule is not checked against field, no validationError from an absent field" in {
      val cfg = """{"rules":[{"kind":"rowCountMax","field":null,"params":{"count":100},"severity":"warn"}]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema
    }

    "assert — missing field on a field-required rule produces a validationError" in {
      val cfg = """{"rules":[{"kind":"unique","field":null,"params":{},"severity":"warn"}]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).validationError.get should include ("missing field")
      result(0).outputSchema shouldBe baseSchema
    }

    "assert — problems across multiple rules are aggregated into one validationError, not short-circuited on the first" in {
      val cfg = """{"rules":[
          {"kind":"bogus","field":null,"params":{},"severity":"error"},
          {"kind":"notNull","field":"missing_field","params":{},"severity":"error"}
        ]}"""
      val steps  = Vector(step("assert", cfg))
      val result = analyze(steps, baseSchema)
      result(0).validationError.get should include ("bogus")
      result(0).validationError.get should include ("missing_field")
      result(0).outputSchema shouldBe baseSchema
    }

    "assert — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("assert", "NOT_JSON"))
      val result = analyze(steps, baseSchema)
      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }


    "compute — appends the declared output field to the schema (unified config shape)" in {
      val cfg    = """{"column":"tax","expression":"$amount * 0.1","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      val names = result(0).outputSchema.map(_.name)
      names should contain allOf ("order_id", "amount", "created_at", "tax")
      result(0).outputSchema should have size (baseSchema.size + 1)
      result(0).outputSchema.last shouldBe SchemaField("tax", "float")
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
      result(0).outputSchema.find(_.name == "revenue").map(_.`type`) shouldBe Some("float")
    }

    "compute — an unknown $-prefixed field reference is flagged with a validationError and falls back to the wire type" in {
      val cfg    = """{"column":"x","expression":"$missing * 2","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe Some("Unknown field: missing")
      result(0).outputSchema.find(_.name == "x").map(_.`type`) shouldBe Some("float")
    }

    // HEL-867 task 2.2: verify the dotted-reference error wording end-to-end on the
    // step-card validationError surface a user actually reads, not only at the
    // evaluator's return value.
    "compute — a \"double\" wire type in the fallback path is canonicalized to float (HEL-895/638/906 cycle 3)" in {
      val cfg    = """{"column":"revenue","expression":"amount * 0.1","type":"double"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      // "amount * 0.1" is a legacy bare-identifier expression -- validate() rejects it, so this
      // exercises the Left(validationMsg) branch's canonicalizeLegacyType(wireType) call.
      result(0).validationError shouldBe Some("Column references require a '$' prefix")
      result(0).outputSchema.find(_.name == "revenue").map(_.`type`) shouldBe Some("float")
    }

        "compute — an unresolved dotted reference produces a validationError that names the whole" +
      " dotted reference, states it is matched as a literal flattened column (not a path), and" +
      " does not imply traversal was attempted" in {
      val cfg    = """{"column":"x","expression":"$stats.pts_ppr * 2","type":"number"}"""
      val steps  = Vector(step("compute", cfg))
      val result = analyze(steps, baseSchema)

      val msg = result(0).validationError.getOrElse(fail("Expected a validationError"))
      msg should include ("stats.pts_ppr")
      msg should include ("literal")
      msg should include ("not traversed as a path")
      result(0).outputSchema.find(_.name == "x").map(_.`type`) shouldBe Some("float")
    }


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
      output.find(_.name == "total_amount").map(_.`type`) shouldBe Some("float")
      output.find(_.name == "row_count").map(_.`type`) shouldBe Some("integer")
    }

    "aggregate — groupBy field with a non-canonical legacy type (double/long/date) is canonicalized (HEL-906 cycle 4)" in {
      val cfg = """{
        "groupBy":[{"name":"amount","type":"double"},{"name":"order_id","type":"long"},{"name":"created_at","type":"date"}],
        "aggregations":[]
      }"""
      val steps  = Vector(step("aggregate", cfg))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      val output = result(0).outputSchema
      output.find(_.name == "amount").map(_.`type`) shouldBe Some("float")
      output.find(_.name == "order_id").map(_.`type`) shouldBe Some("integer")
      output.find(_.name == "created_at").map(_.`type`) shouldBe Some("timestamp")
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
      result(0).outputSchema.find(_.name == "min_amt").map(_.`type`) shouldBe Some("float")
      result(0).outputSchema.find(_.name == "max_created").map(_.`type`) shouldBe Some("string")
    }

    "aggregate — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("aggregate", """{"groupBy":"bad"}"""))
      val result = analyze(steps, baseSchema)
      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }


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


    "chunkbytokencount — valid string-body field appends indexField and tokenCountField as integer" in {
      val schema = Vector(field("content", "string-body"))
      val steps  = Vector(step("chunkbytokencount", """{"field":"content","indexField":"chunkIndex","tokenCountField":"tokenCount"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(
        field("content", "string-body"),
        field("chunkIndex", "integer"),
        field("tokenCount", "integer")
      )
    }

    "chunkbytokencount — unknown field is flagged at analyze time" in {
      val steps  = Vector(step("chunkbytokencount", """{"field":"missing"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe Some("Unknown field 'missing'")
      result(0).outputSchema shouldBe baseSchema
    }

    "chunkbytokencount — non-string-body field is flagged at analyze time" in {
      val steps  = Vector(step("chunkbytokencount", """{"field":"price"}"""))
      val schema = Vector(field("price", "integer"))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe Some(
        "Field 'price' is not a content field (string-body); chunkbytokencount requires a string-body field"
      )
      result(0).outputSchema shouldBe schema
    }

    "chunkbytokencount — missing indexField/tokenCountField config defaults to 'chunkIndex'/'tokenCount'" in {
      val schema = Vector(field("content", "string-body"))
      val steps  = Vector(step("chunkbytokencount", """{"field":"content"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema.map(_.name) should contain allOf ("chunkIndex", "tokenCount")
    }

    "chunkbytokencount — indexField/tokenCountField collision with existing fields replaces them (last write wins)" in {
      val schema = Vector(field("content", "string-body"), field("chunkIndex", "string"), field("tokenCount", "string"))
      val steps  = Vector(step("chunkbytokencount", """{"field":"content","indexField":"chunkIndex","tokenCountField":"tokenCount"}"""))
      val result = analyze(steps, schema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(
        field("content", "string-body"),
        field("chunkIndex", "integer"),
        field("tokenCount", "integer")
      )
    }

    "chunkbytokencount — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("chunkbytokencount", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }


    "datebucket — overwrite case: resolved output field is retyped timestamp (HEL-895/638), no duplicate" in {
      val steps  = Vector(step("datebucket", """{"field":"created_at","granularity":"day"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema.count(_.name == "created_at") shouldBe 1
      result(0).outputSchema.find(_.name == "created_at").map(_.`type`) shouldBe Some("timestamp")
      // other fields pass through unchanged
      result(0).outputSchema.find(_.name == "order_id").map(_.`type`) shouldBe Some("string")
      result(0).outputSchema.find(_.name == "amount").map(_.`type`) shouldBe Some("float")
    }

    "datebucket — new outputColumn is appended, source field type unchanged" in {
      val steps  = Vector(step("datebucket", """{"field":"created_at","granularity":"month","outputColumn":"created_month"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema :+ field("created_month", "timestamp")
      result(0).outputSchema.find(_.name == "created_at").map(_.`type`) shouldBe Some("string")
    }

    "datebucket — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("datebucket", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }


    "pivot — output schema is index-only, no false validation error" in {
      val steps  = Vector(step("pivot", """{"index":["order_id"],"column":"created_at","values":"amount","agg":"sum"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(field("order_id", "string"))
    }

    "pivot — unknown index field yields a real validation error" in {
      val steps  = Vector(step("pivot", """{"index":["nonexistent"],"column":"created_at","values":"amount","agg":"sum"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).validationError.get should include ("nonexistent")
      result(0).outputSchema shouldBe baseSchema
    }

    "pivot — unknown column field yields a real validation error" in {
      val steps  = Vector(step("pivot", """{"index":["order_id"],"column":"missingCol","values":"amount","agg":"sum"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).validationError.get should include ("missingCol")
      result(0).outputSchema shouldBe baseSchema
    }

    "pivot — unknown values field yields a real validation error" in {
      val steps  = Vector(step("pivot", """{"index":["order_id"],"column":"created_at","values":"missingVals","agg":"sum"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).validationError.get should include ("missingVals")
      result(0).outputSchema shouldBe baseSchema
    }

    "pivot — multiple index fields all carry their looked-up types" in {
      val steps  = Vector(step("pivot", """{"index":["order_id","amount"],"column":"created_at","values":"amount","agg":"sum"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(field("order_id", "string"), field("amount", "float"))
    }

    "pivot — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("pivot", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }


    "window — appends outputColumn with integer type for row_number/rank/dense_rank" in {
      val steps  = Vector(step("window", """{"partitionBy":["order_id"],"orderBy":[{"field":"amount","direction":"desc"}],"function":"rank","outputColumn":"category_rank"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema :+ field("category_rank", "integer")
    }

    "window — appends outputColumn with canonical float type for running_sum (HEL-895/638)" in {
      val steps  = Vector(step("window", """{"partitionBy":["order_id"],"orderBy":[],"function":"running_sum","field":"amount","outputColumn":"cum"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema :+ field("cum", "float")
    }

    "window — infers lag/lead output type from field's declared type in the input schema" in {
      val steps  = Vector(step("window", """{"partitionBy":["order_id"],"orderBy":[],"function":"lag","field":"amount","outputColumn":"prev_amount"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema :+ field("prev_amount", "float")
    }

    "window — lag/lead falls back to string type when field is absent from the input schema" in {
      val steps  = Vector(step("window", """{"partitionBy":["order_id"],"orderBy":[],"function":"lag","field":"nonexistent","outputColumn":"prev"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema :+ field("prev", "string")
    }

    // HEL-859: before the analyze-time validation hook, `inferWindow`'s type
    // computation degraded an unrecognized function to "string" silently —
    // exactly the "validation that exists but only fires at execution" gap
    // this ticket closes. `window.function` is now analyze-time validated
    // (design.md Decision 6), so an unrecognized function is reported before
    // any run, with the identity-fallback outputSchema like every other
    // validation failure.
    "window — an unrecognized function is now reported as a validationError at analyze time" in {
      val steps  = Vector(step("window", """{"partitionBy":["order_id"],"orderBy":[],"function":"median","outputColumn":"m"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe defined
      result(0).validationError.get should include("median")
      result(0).outputSchema shouldBe baseSchema
    }

    "window — outputColumn replaces an existing field of the same name (collision rule)" in {
      val steps  = Vector(step("window", """{"partitionBy":["order_id"],"orderBy":[],"function":"rank","outputColumn":"amount"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(field("order_id", "string"), field("created_at", "string"), field("amount", "integer"))
    }

    "window — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("window", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }


    "unpivot — output schema is idVars + varName(string) + valueName(common type), no false validation error" in {
      val steps  = Vector(step("unpivot", """{"idVars":["order_id"],"valueVars":["amount"],"varName":"month","valueName":"value"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(field("order_id", "string"), field("month", "string"), field("value", "float"))
    }

    "unpivot — mixed valueVars types fall back to string for valueName" in {
      val steps  = Vector(step("unpivot", """{"idVars":[],"valueVars":["amount","created_at"],"varName":"variable","valueName":"value"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(field("variable", "string"), field("value", "string"))
    }

    "unpivot — unknown idVars field yields a real validation error" in {
      val steps  = Vector(step("unpivot", """{"idVars":["nonexistent"],"valueVars":["amount"],"varName":"variable","valueName":"value"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).validationError.get should include ("nonexistent")
      result(0).outputSchema shouldBe baseSchema
    }

    "unpivot — unknown valueVars field yields a real validation error" in {
      val steps  = Vector(step("unpivot", """{"idVars":[],"valueVars":["missingCol"],"varName":"variable","valueName":"value"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).validationError.get should include ("missingCol")
      result(0).outputSchema shouldBe baseSchema
    }

    "unpivot — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("unpivot", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }


    "stringops — overwrite case: outputColumn == field retypes in place, no duplicate" in {
      val steps  = Vector(step("stringops", """{"operation":"trim","field":"order_id","outputColumn":"order_id"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(field("amount", "float"), field("created_at", "string"), field("order_id", "string"))
      result(0).outputSchema.count(_.name == "order_id") shouldBe 1
    }

    "stringops — new outputColumn is appended, typed string" in {
      val steps  = Vector(step("stringops", """{"operation":"concat","fields":["order_id","created_at"],"separator":" ","outputColumn":"fullName"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema :+ field("fullName", "string")
    }

    "stringops — outputColumn replaces an existing field of a different name (collision rule)" in {
      val steps  = Vector(step("stringops", """{"operation":"upper","field":"order_id","outputColumn":"amount"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe Vector(field("order_id", "string"), field("created_at", "string"), field("amount", "string"))
    }

    "stringops — malformed config produces validationError and identity outputSchema" in {
      val steps  = Vector(step("stringops", "NOT_JSON"))
      val result = analyze(steps, baseSchema)

      result(0).validationError should not be empty
      result(0).outputSchema shouldBe baseSchema
    }

    // HEL-859 (tasks.md 5.3): the ticket's own repro — the analyze surface
    // must catch an unsupported stringops operation BEFORE any run is
    // attempted, naming both the rejected value and the supported name the
    // reporter actually needed.
    "stringops — analyze-time validation: unsupported operation is reported before any run" in {
      val steps  = Vector(step("stringops", """{"operation":"regexExtract","field":"order_id","pattern":"(a)","outputColumn":"x"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe defined
      result(0).validationError.get should include("regexExtract")
      result(0).validationError.get should include("extractRegex")
      result(0).outputSchema shouldBe baseSchema
    }

    // HEL-859 (tasks.md 5.4): a valid stringops step is unaffected by the new
    // validation hook — it still reports no validationError and the
    // previously inferred outputSchema (not the identity fallback).
    "stringops — analyze-time validation: a valid operation still infers its outputSchema" in {
      val steps  = Vector(step("stringops", """{"operation":"extractRegex","field":"order_id","pattern":"(a)","outputColumn":"extracted"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe None
      result(0).outputSchema shouldBe baseSchema :+ field("extracted", "string")
    }

    // HEL-859 (tasks.md 5.5): proves the analyze-time validation hook is not
    // a stringops special case — fillnull's `strategy` is validated too.
    "fillnull — analyze-time validation: unsupported strategy is reported before any run" in {
      val steps  = Vector(step("fillnull", """{"columns":["amount"],"strategy":"bogus"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe defined
      result(0).validationError.get should include("bogus")
      result(0).validationError.get should include("mean")
      result(0).outputSchema shouldBe baseSchema
    }

    "fillnull — analyze-time validation: constant strategy without value is reported" in {
      val steps  = Vector(step("fillnull", """{"columns":["amount"],"strategy":"constant"}"""))
      val result = analyze(steps, baseSchema)

      result(0).validationError shouldBe defined
      result(0).validationError.get should include("requires 'value'")
      result(0).outputSchema shouldBe baseSchema
    }


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


    "unknown op produces validationError and identity outputSchema" in {
      val steps  = Vector(step("explode", """{}"""))
      val result = analyze(steps, baseSchema)
      result(0).validationError.map(_.toLowerCase) should not be empty
      result(0).outputSchema shouldBe baseSchema
    }
  }

  "PipelineAnalyzeService.analyzeNodes" should {

    def nodeStep(id: String, parentStepId: Option[String], op: String, config: String, position: Int = 0): NodeStepInput =
      NodeStepInput(id = id, parentStepId = parentStepId, position = position, op = op, config = config)

    "project a tail's schema independently of the trunk -- a tail's select drops a column the trunk keeps" in {
      // Trunk: source -> trunk-1 (rename, keeps all 3 columns).
      // Tail:  branches off trunk-1 (position >= 1) with a select that drops "created_at".
      val trunkStep = nodeStep("trunk-1", None, "rename", """{"mapping":{"order_id":"order_id"}}""", position = 0)
      val tailStep  = nodeStep("tail-1", Some("trunk-1"), "select", """{"fields":["order_id","amount"]}""", position = 1)

      val result = analyzeNodes(Vector(trunkStep, tailStep), baseSchema)

      result should have size 2
      val trunkProjection = result("trunk-1").outputSchema
      val tailProjection  = result("tail-1").outputSchema

      // The trunk keeps every column (rename is a no-op shape-wise); the tail's select drops
      // "created_at" -- the two projections must genuinely differ, not just be independently
      // computed copies of the same schema.
      trunkProjection shouldBe baseSchema
      tailProjection shouldBe Vector(field("order_id", "string"), field("amount", "float"))
      tailProjection should not equal trunkProjection
    }

    "a tail's input schema is its own parent's output schema, not the pipeline's raw source" in {
      val trunkStep = nodeStep("trunk-1", None, "select", """{"fields":["order_id","amount"]}""", position = 0)
      val tailStep  = nodeStep("tail-1", Some("trunk-1"), "rename", """{"mapping":{"amount":"amount"}}""", position = 1)

      val result = analyzeNodes(Vector(trunkStep, tailStep), baseSchema)

      result("tail-1").inputSchema shouldBe result("trunk-1").outputSchema
      result("tail-1").inputSchema should not equal baseSchema
    }

    "returns an empty map for an empty step list" in {
      analyzeNodes(Vector.empty, baseSchema) shouldBe empty
    }

    // HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3, cycle 2): the
    // shipped `pipeline-analyze-api` delta's own scenario, exercised for real -- "Rejoin
    // schema is projected from both lanes", asserting the MERGED schema, not the parent
    // lane alone (which is what `secondarySchema = None`'s best-effort passthrough would
    // have produced pre-fix).
    "union rejoin: a lane-kind secondaryInput's schema is projected alongside the parent lane's (both inputs, not the parent alone)" in {
      // laneA (parent lane): baseSchema unchanged. laneB: select projects only order_id +
      // created_at (drops amount) -- a genuinely DIFFERENT schema from laneA's.
      val laneA = nodeStep("laneA", None, "rename", """{"mapping":{"order_id":"order_id"}}""", position = 0)
      val laneB = nodeStep("laneB", None, "select", """{"fields":["order_id","created_at"]}""", position = 1)
      val rejoin = nodeStep(
        "rejoin", Some("laneA"), "union",
        """{"mode":"byName","secondaryInput":{"kind":"lane","stepId":"laneB"}}""",
        position = 0
      )

      val result = analyzeNodes(Vector(laneA, laneB, rejoin), baseSchema)

      result("laneB").outputSchema shouldBe Vector(field("order_id", "string"), field("created_at", "string"))
      // Parent lane alone (laneA's own outputSchema) is baseSchema (order_id/amount/created_at)
      // -- laneB adds nothing new by name (all three of its fields already exist on laneA), so
      // the union is exactly laneA's own schema. The NEXT test proves a genuinely NEW field
      // gets pulled in, which this one alone can't distinguish from "ignored the secondary
      // entirely".
      result("rejoin").outputSchema shouldBe result("laneA").outputSchema
    }

    "union rejoin genuinely merges a field the parent lane does not have (proves both-input derivation, not passthrough)" in {
      val laneA = nodeStep("laneA", None, "select", """{"fields":["order_id"]}""", position = 0)
      val laneB = nodeStep(
        "laneB", None, "compute", """{"column":"discount","expression":"1","type":"integer"}""", position = 1
      )
      val rejoin = nodeStep(
        "rejoin", Some("laneA"), "union",
        """{"mode":"byName","secondaryInput":{"kind":"lane","stepId":"laneB"}}""",
        position = 0
      )

      val result = analyzeNodes(Vector(laneA, laneB, rejoin), baseSchema)

      // laneA alone projects only order_id. If the rejoin ignored the secondary input (the
      // pre-fix behavior), its outputSchema would be identical to laneA's. It is not:
      // laneB's own fields (including "discount", which laneA never had) are merged in.
      result("laneA").outputSchema shouldBe Vector(field("order_id", "string"))
      result("rejoin").outputSchema.map(_.name) should contain("discount")
      result("rejoin").outputSchema should not equal result("laneA").outputSchema
    }

    "join rejoin: schema is the union of both inputs, secondary side wins on a name collision (mirrors runtime right-hand-wins)" in {
      val laneA = nodeStep("laneA", None, "rename", """{"mapping":{"order_id":"order_id"}}""", position = 0)
      // laneB redeclares "amount" (present on laneA too, as float) as a string-typed field
      // via a cast step -- proves the SECONDARY side's type wins on the collision, not the
      // parent's.
      val laneB = nodeStep(
        "laneB", None, "cast", """{"casts":{"amount":"string"}}""", position = 1
      )
      val rejoin = nodeStep(
        "rejoin", Some("laneA"), "join",
        """{"joinKey":"order_id","joinType":"inner","secondaryInput":{"kind":"lane","stepId":"laneB"}}""",
        position = 0
      )

      val result = analyzeNodes(Vector(laneA, laneB, rejoin), baseSchema)

      val rejoinFields = result("rejoin").outputSchema.map(f => f.name -> f.`type`).toMap
      rejoinFields("order_id") shouldBe "string"
      rejoinFields("created_at") shouldBe "string" // carried through from laneA, untouched
      rejoinFields("amount") shouldBe "string" // secondary (laneB) wins the collision
    }

    "join with no dispatch case before this ticket now projects a schema instead of 'Unknown op' (evaluation-1.md CR3)" in {
      val laneA = nodeStep("laneA", None, "select", """{"fields":["order_id"]}""", position = 0)
      val join  = nodeStep(
        "join1", Some("laneA"), "join",
        """{"joinKey":"order_id","joinType":"inner","secondaryInput":{"kind":"source","dataSourceId":""}}""",
        position = 0
      )
      val result = analyzeNodes(Vector(laneA, join), baseSchema)
      result("join1").validationError shouldBe None
      result("join1").outputSchema shouldBe result("laneA").outputSchema
    }

    "lookup rejoin: a requested column's REAL type is pulled from the resolved lane schema, not the 'string' placeholder" in {
      val laneA  = nodeStep("laneA", None, "rename", """{"mapping":{"order_id":"order_id"}}""", position = 0)
      val laneB  = nodeStep("laneB", None, "select", """{"fields":["amount"]}""", position = 1) // amount: float
      val rejoin = nodeStep(
        "rejoin", Some("laneA"), "lookup",
        """{"sourceKey":"order_id","lookupKey":"order_id","columns":["amount"],"secondaryInput":{"kind":"lane","stepId":"laneB"}}""",
        position = 0
      )

      val result = analyzeNodes(Vector(laneA, laneB, rejoin), baseSchema)

      result("rejoin").outputSchema.find(_.name == "amount").map(_.`type`) shouldBe Some("float")
    }

    "a lane reference the config never resolves (source-kind secondaryInput) still degrades to the documented best-effort passthrough" in {
      val laneA = nodeStep("laneA", None, "select", """{"fields":["order_id"]}""", position = 0)
      val union = nodeStep(
        "union1", Some("laneA"), "union",
        """{"mode":"byName","secondaryInput":{"kind":"source","dataSourceId":"ds-1"}}""",
        position = 0
      )
      val result = analyzeNodes(Vector(laneA, union), baseSchema)
      result("union1").outputSchema shouldBe result("laneA").outputSchema
    }
  }
}
