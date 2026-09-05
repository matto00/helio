package com.helio.api.protocols.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalStepRequest, PipelineProposal, PipelineProposalProtocol, PipelineProposalSource}
import com.helio.api.protocols.sources.SqlSourceConfigPayload
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Unit tests for [[PipelineProposalSource]]/[[PipelineProposal]]'s custom
 *  reader/writer (HEL-379, retargeted HEL-907 task 1.1) — mirrors
 *  [[DashboardProposalProtocolSpec]]'s structure. Covers: existing-sourceId
 *  round-trip, inline-source round-trip, absent-optional tolerance,
 *  absent-optional write omission, `steps` reusing
 *  `CreatePipelineTransactionalStepRequest` unchanged (single-call
 *  transactional shape, HEL-906), `outputs` optional/defaulting-empty, and
 *  the single-shared-`"config"`-key wire shape for the inline-source branch
 *  (design.md D1/D5). */
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

  private val oneStep = CreatePipelineTransactionalStepRequest(
    clientId = "s1",
    `type`   = "select",
    config   = JsObject("columns" -> JsArray(JsString("id"), JsString("name")))
  )

  private def proposal(
      source: PipelineProposalSource,
      steps: Vector[CreatePipelineTransactionalStepRequest] = Vector(oneStep),
      outputs: Vector[CreatePipelineTransactionalOutputRequest] = Vector.empty
  ): PipelineProposal =
    PipelineProposal(
      pipelineName = "Events pipeline",
      roots        = Vector(source),
      steps        = steps,
      outputs      = outputs
    )


  "PipelineProposal.write/read — existing sourceId" should {
    "round-trip a proposal referencing an existing source" in {
      val p = proposal(existingSourceRef)
      p.toJson.convertTo[PipelineProposal] shouldBe p
    }

    "omit type/name/config keys on the source object when only sourceId is set" in {
      val json = proposal(existingSourceRef).toJson.asJsObject.fields("roots").asInstanceOf[JsArray].elements.head.asJsObject
      json.fields.keySet shouldBe Set("sourceId")
    }
  }


  "PipelineProposal.write/read — inline source" should {
    "round-trip a proposal with an inline sql source" in {
      val p = proposal(inlineSqlSource)
      p.toJson.convertTo[PipelineProposal] shouldBe p
    }

    "serialize the inline source's config under a single shared 'config' key" in {
      val json = proposal(inlineSqlSource).toJson.asJsObject.fields("roots").asInstanceOf[JsArray].elements.head.asJsObject
      json.fields.keySet shouldBe Set("type", "name", "config")
      json.fields("config") shouldBe sqlConfig.toJson
    }

    "not emit csvConfig/restConfig/sqlConfig/staticConfig field names anywhere on the wire" in {
      val json = proposal(inlineSqlSource).toJson.asJsObject.fields("roots").asInstanceOf[JsArray].elements.head.asJsObject
      json.fields.keySet.intersect(Set("csvConfig", "restConfig", "sqlConfig", "staticConfig")) shouldBe empty
    }
  }


  "PipelineProposal.read" should {
    "tolerate every source-level optional field being absent, reading only the required fields" in {
      val json = JsObject(
        "pipelineName" -> JsString("Minimal pipeline"),
        "roots"        -> JsArray(JsObject()),
        "steps"        -> JsArray()
      )
      val decoded = json.convertTo[PipelineProposal]
      decoded.pipelineName shouldBe "Minimal pipeline"
      decoded.steps shouldBe Vector.empty
      decoded.outputs shouldBe Vector.empty
      decoded.roots shouldBe Vector(PipelineProposalSource(None, None, None, None, None, None, None))
    }

    "raise a deserializationError when a required top-level field is missing" in {
      val json = JsObject(
        "roots" -> JsArray(JsObject("sourceId" -> JsString("src-1"))),
        "steps"  -> JsArray()
      )
      an[DeserializationException] should be thrownBy json.convertTo[PipelineProposal]
    }

    "reject a payload carrying the retired singular 'source' field outright, never tolerating it" in {
      val json = JsObject(
        "pipelineName" -> JsString("Legacy pipeline"),
        "source"       -> JsObject("sourceId" -> JsString("src-1")),
        "steps"        -> JsArray()
      )
      an[DeserializationException] should be thrownBy json.convertTo[PipelineProposal]
    }

    "reject an empty 'roots' array" in {
      val json = JsObject(
        "pipelineName" -> JsString("Empty roots"),
        "roots"        -> JsArray(),
        "steps"        -> JsArray()
      )
      an[DeserializationException] should be thrownBy json.convertTo[PipelineProposal]
    }
  }


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

  // ── HEL-907 task 1.1: steps reuse CreatePipelineTransactionalStepRequest verbatim ────

  "PipelineProposal.steps" should {
    "round-trip using the existing CreatePipelineTransactionalStepRequest {clientId, type, config} wire shape unchanged" in {
      val json = proposal(existingSourceRef).toJson.asJsObject.fields("steps").asInstanceOf[JsArray]
      json.elements should have size 1
      val stepJson = json.elements.head.asJsObject
      stepJson.fields.keySet shouldBe Set("clientId", "type", "config")
      stepJson.fields("type") shouldBe JsString("select")
      stepJson shouldBe oneStep.toJson

      json.elements.head.convertTo[CreatePipelineTransactionalStepRequest] shouldBe oneStep
    }

    "preserve multiple steps in order" in {
      val secondStep = CreatePipelineTransactionalStepRequest(clientId = "s2", `type` = "limit", config = JsObject("count" -> JsNumber(10)))
      val p           = proposal(existingSourceRef, steps = Vector(oneStep, secondStep))
      p.toJson.convertTo[PipelineProposal].steps shouldBe Vector(oneStep, secondStep)
    }
  }

  // ── HEL-907 task 1.1: outputs is optional, defaulting to empty when absent ────

  "PipelineProposal.outputs" should {
    "omit the outputs key entirely when empty" in {
      val json = proposal(existingSourceRef).toJson.asJsObject
      json.fields.keySet should not contain "outputs"
    }

    "round-trip a non-empty outputs list" in {
      val output = CreatePipelineTransactionalOutputRequest(nodeStepClientId = Some("s1"), kind = "table", name = "Out")
      val p = proposal(existingSourceRef, outputs = Vector(output))
      p.toJson.convertTo[PipelineProposal] shouldBe p
      p.toJson.asJsObject.fields("outputs") shouldBe JsArray(output.toJson)
    }
  }
}
