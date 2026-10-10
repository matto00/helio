package com.helio.testsupport

import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.jdk.CollectionConverters._

/** HEL-1419: the proposal analyze response schema reuses the persisted analyze response schema's defs by
 *  cross-file `$ref` instead of keeping copies. These guards fail if a copy returns, and prove the refs are
 *  enforced (an unresolved ref degrading to `{}` would still compile, but would accept every negative below). */
class AnalyzeSchemaSharedDefsSpec extends AnyWordSpec with Matchers {
  private val ProposalFile = "pipelines/pipeline-analyze-proposal-response.schema.json"
  private val ResponseFile = "pipelines/pipeline-analyze-response.schema.json"
  private val ResponseBase = "https://helio.local/schemas/pipelines/pipeline-analyze-response.schema.json#/$defs/"
  private val mapper       = new ObjectMapper()

  private def read(rel: String): JsonNode = mapper.readTree(JsonSchemaValidation.schemaFile(rel))
  private def defNames(rel: String): Set[String] = read(rel).path("$defs").fieldNames().asScala.toSet

  private lazy val proposal = JsonSchemaValidation.compile(ProposalFile)

  private val goodStep = """{"id":"s1","position":0,"type":"rename","config":{},"inputSchema":[],"outputSchema":[]}"""
  private def body(sourceSchemas: String = "[]", steps: String = "[]", warnings: String = "[]"): String =
    s"""{"sourceSchemas":$sourceSchemas,"steps":$steps,"outputs":[],"warnings":$warnings}"""
  private def errors(json: String): Vector[String] = JsonSchemaValidation.validationErrors(proposal, json)

  "the proposal schema's defs" should {
    "be disjoint from the response schema's defs and declare no step copy" in {
      val proposalDefs = defNames(ProposalFile)
      (proposalDefs intersect defNames(ResponseFile)) shouldBe empty
      proposalDefs should not contain "AnalyzeProposalStep"
      proposalDefs shouldBe Set("OutputAnalyze")
    }
    "reference the response schema by exact absolute cross-file URI" in {
      val props = read(ProposalFile).path("properties")
      props.path("sourceSchemas").path("items").path("$ref").asText shouldBe ResponseBase + "RootSourceSchema"
      props.path("steps").path("items").path("$ref").asText shouldBe ResponseBase + "AnalyzeStep"
      props.path("warnings").path("items").path("$ref").asText shouldBe ResponseBase + "AnalyzeWarning"
    }
  }

  "the harness" should {
    "compile both analyze schemas and resolve the cross-file refs offline" in {
      noException should be thrownBy JsonSchemaValidation.compile(ResponseFile)
      // refs resolve lazily, on first validation of an item -- force one so a broken mapping throws here
      noException should be thrownBy errors(body(steps = s"[$goodStep]"))
    }
  }

  "the cross-file refs" should {
    "accept a well-formed body" in {
      val warning = """{"stepId":"s1","code":"join-column-renamed","message":"m"}"""
      val root    = """{"rootId":"r1","dataSourceName":"d","sourceSchema":[{"name":"a","type":"string"}]}"""
      errors(body(s"[$root]", s"[$goodStep]", s"[$warning]")) shouldBe empty
    }
    "reject an unknown warning code" in {
      errors(body(warnings = """[{"stepId":"s1","code":"nope","message":"m"}]""")) should not be empty
    }
    "reject a step missing outputSchema" in {
      errors(body(steps = """[{"id":"s1","position":0,"type":"rename","config":{},"inputSchema":[]}]""")) should not be empty
    }
    "reject a step with an empty type" in {
      val emptyType = goodStep.replace("\"rename\"", "\"\"")
      errors(body(steps = s"[$emptyType]")) should not be empty
    }
    "reject an unknown SchemaField type under sourceSchemas" in {
      val root = """{"rootId":"r1","dataSourceName":"d","sourceSchema":[{"name":"a","type":"bogus"}]}"""
      errors(body(sourceSchemas = s"[$root]")) should not be empty
    }
    "reject an unknown SchemaField type under steps[].inputSchema" in {
      val badInput = goodStep.replace("\"inputSchema\":[]", "\"inputSchema\":[{\"name\":\"a\",\"type\":\"bogus\"}]")
      errors(body(steps = s"[$badInput]")) should not be empty
    }
  }
}
