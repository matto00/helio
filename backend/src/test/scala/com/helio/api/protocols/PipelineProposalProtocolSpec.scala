package com.helio.api.protocols

import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineProposal, PipelineProposalProtocol, PipelineProposalSource}
import com.helio.api.protocols.sources.SqlSourceConfigPayload
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Unit tests for [[PipelineProposalSource]]/[[PipelineProposal]]'s custom
 *  reader/writer (HEL-379) — mirrors [[DashboardProposalProtocolSpec]]'s
 *  structure. Covers: existing-sourceId round-trip, inline-source round-trip,
 *  absent-optional tolerance, absent-optional write omission, steps reusing
 *  `CreatePipelineStepRequest` unchanged, and the single-shared-`"config"`-key
 *  wire shape for the inline-source branch (design.md D1/D5). */
class PipelineProposalProtocolSpec extends AnyWordSpec with Matchers with PipelineProposalProtocol {

  private val existingSourceRef = PipelineProposalSource(
    sourceId     = Some("src-1"),
    `type`       = None,
    name         = None,
    csvConfig    = None,
    restConfig   = None,
    sqlConfig    = None,
    staticConfig = None
  )

  private val sqlConfig = SqlSourceConfigPayload(
    dialect  = "postgres",
    host     = "db.internal",
    port     = 5432,
    database = "analytics",
    user     = "reader",
    password = "s3cret",
    query    = "SELECT * FROM events"
  )

  private val inlineSqlSource = PipelineProposalSource(
    sourceId     = None,
    `type`       = Some("sql"),
    name         = Some("Events DB"),
    csvConfig    = None,
    restConfig   = None,
    sqlConfig    = Some(sqlConfig),
    staticConfig = None
  )

  private val oneStep = CreatePipelineStepRequest(
    `type` = "select",
    config = JsObject("columns" -> JsArray(JsString("id"), JsString("name")))
  )

  private def proposal(source: PipelineProposalSource, steps: Vector[CreatePipelineStepRequest] = Vector(oneStep)): PipelineProposal =
    PipelineProposal(
      pipelineName       = "Events pipeline",
      source             = source,
      outputDataTypeName = "Events",
      steps              = steps
    )

  // ── HEL-379: round-trip — existing sourceId ───────────────────────────────

  "PipelineProposal.write/read — existing sourceId" should {
    "round-trip a proposal referencing an existing source" in {
      val p = proposal(existingSourceRef)
      p.toJson.convertTo[PipelineProposal] shouldBe p
    }

    "omit type/name/config keys on the source object when only sourceId is set" in {
      val json = proposal(existingSourceRef).toJson.asJsObject.fields("source").asJsObject
      json.fields.keySet shouldBe Set("sourceId")
    }
  }

  // ── HEL-379: round-trip — inline source ───────────────────────────────────

  "PipelineProposal.write/read — inline source" should {
    "round-trip a proposal with an inline sql source" in {
      val p = proposal(inlineSqlSource)
      p.toJson.convertTo[PipelineProposal] shouldBe p
    }

    "serialize the inline source's config under a single shared 'config' key" in {
      val json = proposal(inlineSqlSource).toJson.asJsObject.fields("source").asJsObject
      json.fields.keySet shouldBe Set("type", "name", "config")
      json.fields("config") shouldBe sqlConfig.toJson
    }

    "not emit csvConfig/restConfig/sqlConfig/staticConfig field names anywhere on the wire" in {
      val json = proposal(inlineSqlSource).toJson.asJsObject.fields("source").asJsObject
      json.fields.keySet.intersect(Set("csvConfig", "restConfig", "sqlConfig", "staticConfig")) shouldBe empty
    }
  }

  // ── HEL-379: absent-optional tolerance ────────────────────────────────────

  "PipelineProposal.read" should {
    "tolerate every source-level optional field being absent, reading only the required fields" in {
      val json = JsObject(
        "pipelineName"       -> JsString("Minimal pipeline"),
        "source"             -> JsObject(),
        "outputDataTypeName" -> JsString("Minimal"),
        "steps"              -> JsArray()
      )
      val decoded = json.convertTo[PipelineProposal]
      decoded.pipelineName shouldBe "Minimal pipeline"
      decoded.outputDataTypeName shouldBe "Minimal"
      decoded.steps shouldBe Vector.empty
      decoded.source shouldBe PipelineProposalSource(None, None, None, None, None, None, None)
    }

    "raise a deserializationError when a required top-level field is missing" in {
      val json = JsObject(
        "pipelineName" -> JsString("X"),
        "source"       -> JsObject("sourceId" -> JsString("src-1")),
        "steps"        -> JsArray()
      )
      an[DeserializationException] should be thrownBy json.convertTo[PipelineProposal]
    }
  }

  // ── HEL-379: absent-optional write omission ───────────────────────────────

  "PipelineProposalSource.write" should {
    "omit the sourceId key when absent" in {
      val json = inlineSqlSource.toJson.asJsObject
      json.fields.keySet should not contain "sourceId"
    }

    "omit the config key entirely when no per-kind config is populated" in {
      val json = existingSourceRef.toJson.asJsObject
      json.fields.keySet should not contain "config"
    }

    "emit no null values for any absent optional field" in {
      val json = existingSourceRef.toJson.asJsObject
      json.fields.values.toList should not contain JsNull
    }
  }

  // ── HEL-379: steps reuse CreatePipelineStepRequest verbatim ───────────────

  "PipelineProposal.steps" should {
    "round-trip using the existing CreatePipelineStepRequest {type, config} wire shape unchanged" in {
      val json = proposal(existingSourceRef).toJson.asJsObject.fields("steps").asInstanceOf[JsArray]
      json.elements should have size 1
      val stepJson = json.elements.head.asJsObject
      stepJson.fields.keySet shouldBe Set("type", "config")
      stepJson.fields("type") shouldBe JsString("select")
      stepJson shouldBe oneStep.toJson

      json.elements.head.convertTo[CreatePipelineStepRequest] shouldBe oneStep
    }

    "preserve multiple steps in order" in {
      val secondStep = CreatePipelineStepRequest(`type` = "limit", config = JsObject("count" -> JsNumber(10)))
      val p           = proposal(existingSourceRef, steps = Vector(oneStep, secondStep))
      p.toJson.convertTo[PipelineProposal].steps shouldBe Vector(oneStep, secondStep)
    }
  }
}
