package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-1493 (owner option B): undo of an applied patch-set `pipeline` `create` also removes the inline root sources
 *  that apply created, only when nothing references them. */
class PatchSetUndoInlineSourceSpec extends PatchSetInlineSourceFixture {

  private val UuidShaped = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}".r

  "undo of a patch-set pipeline create with an inline root" should {

    "remove the unreferenced inline source and report it removed" in {
      val (appId, pipelineId) = applyCreate(CreatePipelineRequest(s"undo-${UUID.randomUUID()}", Vector(datasetRoot())))
      val sourceId = rootSourceIds(pipelineId).head
      sourceCount(sourceId) shouldBe 1
      val outcome = undoOutcome(appId)
      sourceCount(sourceId) shouldBe 0
      val listed = inlineSources(outcome)
      listed.map(_.fields("id")) shouldBe Vector(JsString(sourceId))
      listed.map(_.fields("result")) shouldBe Vector(JsString("removed"))
    }

    "keep a source another pipeline references since the apply, undo still succeeds, and report it kept with a reason" in {
      val (appId, pipelineId) = applyCreate(CreatePipelineRequest(s"undo-ref-${UUID.randomUUID()}", Vector(datasetRoot())))
      val sourceId = rootSourceIds(pipelineId).head
      val other = await(pipelineService.create(CreatePipelineRequest("Holder of inline source", Vector(CreatePipelineRootRequest(Some(sourceId)))), user))
        .fold(e => fail(s"setup failed: $e"), identity)
      val outcome = undoOutcome(appId)
      sourceCount(sourceId) shouldBe 1
      await(pipelineService.findSummaryById(PipelineId(pipelineId), user)).isLeft shouldBe true
      await(pipelineService.findSummaryById(PipelineId(other.id), user)).isRight shouldBe true
      val listed = inlineSources(outcome)
      listed.map(_.fields("result")) shouldBe Vector(JsString("kept"))
      // HEL-1493 C6: UI-safe wording -- names the visible pipeline, no id, no delete-flow remediation.
      listed.head.fields("reason") shouldBe JsString("""still used by pipeline "Holder of inline source".""")
      listed.head.fields("reason").toString should not include "Remove each reference"
      UuidShaped.findFirstIn(listed.head.fields("reason").toString) shouldBe None
    }

    "never delete a sourceId root, and delete only the inline root of a mixed create" in {
      val existing = await(dataSourceService.createStatic(
        StaticDataSourceRequest(s"existing-${UUID.randomUUID()}", "static",
          Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))), user)).fold(e => fail(s"setup: $e"), identity)
      val (appId, pipelineId) = applyCreate(CreatePipelineRequest(s"undo-mixed-${UUID.randomUUID()}",
        Vector(CreatePipelineRootRequest(Some(existing.id.value)), datasetRoot())))
      val inlineId = rootSourceIds(pipelineId).filterNot(_ == existing.id.value).head
      val outcome = undoOutcome(appId)
      sourceCount(existing.id.value) shouldBe 1
      sourceCount(inlineId) shouldBe 0
      inlineSources(outcome).map(_.fields("id")) shouldBe Vector(JsString(inlineId))
    }

    "remove the implicit Auto: Connector with a bare-url REST inline source" in {
      val sourcesBefore = count("data_sources"); val connectorsBefore = count("connectors")
      val (appId, _) = applyCreate(CreatePipelineRequest(s"undo-rest-${UUID.randomUUID()}", Vector(bareUrlRestRoot())))
      count("data_sources") shouldBe sourcesBefore + 1
      count("connectors") shouldBe connectorsBefore + 1
      undoOutcome(appId)
      count("data_sources") shouldBe sourcesBefore
      count("connectors") shouldBe connectorsBefore
    }

    "report nothing when every root names an existing source (guard: green before the fix)" in {
      val existing = await(dataSourceService.createStatic(
        StaticDataSourceRequest(s"existing2-${UUID.randomUUID()}", "static",
          Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))), user)).fold(e => fail(s"setup: $e"), identity)
      val (appId, _) = applyCreate(CreatePipelineRequest(s"undo-none-${UUID.randomUUID()}", Vector(CreatePipelineRootRequest(Some(existing.id.value)))))
      val outcome = undoOutcome(appId)
      outcome.fields.contains("inlineSources") shouldBe false
      sourceCount(existing.id.value) shouldBe 1
    }
  }

  "undo of a legacy journal entry with no recorded inline sources (guard: green before the fix)" should {
    "parse the literal pre-change row, delete only the pipeline, keep the source and report no inlineSources" in {
      val created = await(pipelineService.create(CreatePipelineRequest(s"legacy-${UUID.randomUUID()}", Vector(datasetRoot())), user))
        .fold(e => fail(s"setup: $e"), identity)
      val sourceId = created.roots.head.dataSourceId
      val legacyRow =
        s"""{"index":0,"targetKind":"pipeline","op":"create","newId":"${created.id}","resultingState":${pipelineSummaryResponseFormat.write(created).compactPrint}}""".parseJson
      val edit = PatchSetApplicationRepository.journaledEditFormat.read(legacyRow)
      val now  = Instant.now()
      val record = await(applicationRepo.create(PatchSetApplicationRepository.PatchSetApplicationRecord(
        PatchSetApplicationId(UUID.randomUUID().toString), user.id, now, Vector(edit), now)))
      val outcome = undoOutcome(record.id.value)
      sourceCount(sourceId) shouldBe 1
      await(pipelineService.findSummaryById(PipelineId(created.id), user)).isLeft shouldBe true
      outcome.fields.contains("inlineSources") shouldBe false
    }
  }
}
