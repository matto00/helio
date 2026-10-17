package com.helio.api.protocols

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.{DraftCascadeImpactResponse, DraftCascadeRequiredResponse, DraftRunNotStarted, DraftRunStarted, DraftSaveRequest, DraftSaveResponse, DraftSavedDefinitionResponse, DraftSavedResponse, PipelineStepResponse}
import com.helio.domain.model.{NodeRef, Output, OutputId, OutputKind, PipelineId, PipelineStepId, UserId}
import com.helio.domain.steps.{LimitConfig, LimitStep}
import com.helio.testsupport.JsonSchemaValidation
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}
import java.time.Instant

/** HEL-1629 task 5.2 (the server half of the draft-save wire seam, same discipline as HEL-1628's sample seam): every body
 *  validated here is produced by the REAL production serializer, and the committed shared fixtures
 *  (`shared-test-fixtures/draft-save/`, read by the frontend's seam test too) must equal that output exactly, so the client
 *  half is fed real serializer output, never hand-built JSON. The request fixture is what the client sends: it must parse
 *  with the production reader, round-trip unchanged, and validate against the committed schema. Regenerate the response
 *  fixtures with `HEL1629_WRITE_FIXTURE=1 sbt "testOnly *DraftSaveSeamSpec"`. */
class DraftSaveSeamSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private val requestSchema  = JsonSchemaValidation.compile("pipelines/draft-save-request.schema.json")
  private val responseSchema = JsonSchemaValidation.compile("pipelines/draft-save-response.schema.json")
  private val cascadeSchema  = JsonSchemaValidation.compile("pipelines/draft-cascade-required-response.schema.json")
  private val staleSchema    = JsonSchemaValidation.compile("shared/patch-set-stale-response.schema.json")
  private val summarySchema  = JsonSchemaValidation.compile("pipelines/pipeline-summary.schema.json")
  private val dir            = Paths.get("../shared-test-fixtures/draft-save")

  private val at = Instant.parse("2026-10-16T12:00:00Z")
  private val fingerprint = "v1:" + "0123456789abcdef" * 4

  private val step: PipelineStepResponse = PipelineStepResponse.fromDomain(
    LimitStep(PipelineStepId("s1"), PipelineId("p1"), 0, LimitConfig(10), at, at, None, enabled = true), Map("s1" -> "r1")
  )
  private val output = outputResponseFrom(
    Output(OutputId("o1"), "Out", UserId("00000000-0000-0000-0000-0000000000a1"), NodeRef(PipelineId("p1"), Some(PipelineStepId("s1")), None), OutputKind.Table, at, at),
    JsObject.empty
  )
  private def saved = DraftSavedResponse(fingerprint, DraftSavedDefinitionResponse(Vector(step), Vector(output)), "application-1")

  private val noRun    = DraftSaveResponse(saved, None).toJson
  private val started  = DraftSaveResponse(saved, Some(DraftRunStarted(Some("run-1"), "succeeded"))).toJson
  private val rejected = DraftSaveResponse(saved, Some(DraftRunNotStarted(429, Some(12), "Pipeline-run rate limit exceeded"))).toJson
  private val stale = PatchSetStaleResponse(
    "Nothing was applied: changed since the preview: edit 0 (pipeline p1). Preview the patch set again before applying.",
    "PATCH_SET_STALE", Vector(StaleTargetResponse(0, "pipeline", "p1")), Some(fingerprint)
  ).toJson
  private val cascade = DraftCascadeRequiredResponse(
    "The draft removes more than was confirmed; nothing was saved.", "CASCADE_CONFIRMATION_REQUIRED",
    DraftCascadeImpactResponse(Vector("s2"), Vector("o2"), Vector("panel-1"), Vector("rule-1"), Vector("Removes 1 step(s).", "Removes 1 Output(s)."))
  ).toJson

  private def fixture(name: String, produced: JsValue): JsValue = {
    val path = dir.resolve(name)
    if (sys.env.contains("HEL1629_WRITE_FIXTURE")) {
      Files.createDirectories(dir)
      Files.writeString(path, produced.prettyPrint + "\n")
    }
    Files.readString(path).parseJson
  }

  private def errors(schema: com.networknt.schema.JsonSchema, j: JsValue): Vector[String] = JsonSchemaValidation.validationErrors(schema, j.compactPrint)

  "the draft-save request the client sends" should {
    "parse with the production reader, round-trip unchanged and validate against the committed schema" in {
      val request = Files.readString(dir.resolve("draft-save-request.json")).parseJson
      errors(requestSchema, request) shouldBe empty
      val parsed = request.convertTo[DraftSaveRequest]
      parsed.steps.map(s => s.id.orElse(s.clientId).get) shouldBe Vector("s1", "n1")
      parsed.confirmCascade.map(_.stepIds) shouldBe Some(Vector("s9"))
      parsed.toJson shouldBe request
    }

    "be rejected by the schema when a step names neither an id nor a clientId, or an Output has an unknown kind" in {
      val request = Files.readString(dir.resolve("draft-save-request.json")).parseJson.asJsObject
      val steps = request.fields("steps").convertTo[Vector[JsObject]]
      errors(requestSchema, JsObject(request.fields + ("steps" -> JsArray(steps.map(s => JsObject(s.fields - "id" - "clientId")))))) should not be empty
      errors(requestSchema, JsObject(request.fields - "baseFingerprint")) should not be empty
      errors(requestSchema, JsObject(request.fields + ("force" -> JsTrue))) should not be empty
      errors(requestSchema, JsObject(request.fields + ("runAfterSave" -> JsString("always")))) should not be empty
    }
  }

  "the draft-save responses the server sends" should {
    "validate against the committed schemas, with `run` always present (null when none was requested)" in {
      Seq(noRun, started, rejected).foreach(r => errors(responseSchema, r) shouldBe empty)
      noRun.asJsObject.fields("run") shouldBe JsNull
      errors(staleSchema, stale) shouldBe empty
      errors(cascadeSchema, cascade) shouldBe empty
    }

    "equal the committed shared fixtures exactly" in {
      fixture("draft-save-response.json", noRun) shouldBe noRun
      fixture("draft-save-response-run-started.json", started) shouldBe started
      fixture("draft-save-response-run-rejected.json", rejected) shouldBe rejected
      fixture("draft-save-stale-409.json", stale) shouldBe stale
      fixture("draft-save-cascade-422.json", cascade) shouldBe cascade
    }

    "be rejected by the schema when `run` is missing, a refused run has no code, or the fingerprint is malformed" in {
      val base = noRun.asJsObject
      errors(responseSchema, JsObject(base.fields - "run")) should not be empty
      errors(responseSchema, JsObject(base.fields + ("run" -> JsObject("started" -> JsFalse, "reason" -> JsString("x"))))) should not be empty
      val savedObj = base.fields("saved").asJsObject
      errors(responseSchema, JsObject(base.fields + ("saved" -> JsObject(savedObj.fields + ("fingerprint" -> JsString("v1:abc")))))) should not be empty
    }
  }

  "GET /api/pipelines/:id" should {
    "validate with a fingerprint and a definition, and without them (the list shape)" in {
      val base = JsObject(
        "id" -> JsString("p1"), "name" -> JsString("n"), "roots" -> JsArray(), "createdAt" -> JsString("t"), "updatedAt" -> JsString("t")
      )
      errors(summarySchema, base) shouldBe empty
      errors(summarySchema, JsObject(base.fields + ("fingerprint" -> JsString(fingerprint)) + ("definition" -> JsObject("steps" -> JsArray(step.toJson), "outputs" -> JsArray(output.toJson))))) shouldBe empty
      errors(summarySchema, JsObject(base.fields + ("fingerprint" -> JsString("nope")))) should not be empty
    }
  }
}
