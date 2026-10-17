package com.helio.services.patchsets

import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveHarness}
import spray.json._

/** HEL-1629 task 2.2 (C7): ONE implementation of the pipeline definition behind every fingerprint call site. The same stored
 *  state hashes the same through `ofAction` (the draft save, `GET /api/pipelines/:id`), through `of` (the patch-set preview
 *  and apply path) and through the privileged pool whoever asks, and a rename AFTER an early summary read IS reflected. */
class PatchSetPipelineDefinitionParitySpec extends DraftSaveApiFixture {

  private val owner = AuthenticatedUser(UserId(userA))

  private def viaOf(h: DraftSaveHarness, pipelineId: String, ctx: PatchSetApplyContext, summary: PipelineSummary): String =
    PatchSetTargetFingerprint.of("pipeline", await(PatchSetPipelineDefinition.of(summary, ctx)))

  "the pipeline definition" should {
    "hash identically through of, ofAction and the GET, for the owner and for an editor" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val h = new DraftSaveHarness(ctx)
      val definitionCtx = PatchSetApplyContext.build(h.panelRepo, h.dashboardRepo, h.dataSourceRepo, h.pipelineRepo, h.stepRepo, null, h.outputRepo)
      val summary = await(h.pipelineRepo.findSummaryByIdShared(PipelineId(seed.pipeline), Some(owner))).get
      val viaAction = PatchSetTargetFingerprint.of("pipeline", await(h.pipelineRepo.runPrivileged(PatchSetPipelineDefinition.ofAction(PipelineId(seed.pipeline), definitionCtx))))
      viaOf(h, seed.pipeline, definitionCtx, summary) shouldBe viaAction
      read(seed, userA)._1 shouldBe viaAction
      read(seed, userB)._1 shouldBe viaAction
    }

    "reflect a rename made after the caller's summary read" in {
      val seed = seedPipeline()
      val h = new DraftSaveHarness(ctx)
      val definitionCtx = PatchSetApplyContext.build(h.panelRepo, h.dashboardRepo, h.dataSourceRepo, h.pipelineRepo, h.stepRepo, null, h.outputRepo)
      val staleSummary = await(h.pipelineRepo.findSummaryByIdShared(PipelineId(seed.pipeline), Some(owner))).get
      val before = viaOf(h, seed.pipeline, definitionCtx, staleSummary)
      exec(s"UPDATE pipelines SET name='renamed after the summary read' WHERE id='${seed.pipeline}'")
      val after = viaOf(h, seed.pipeline, definitionCtx, staleSummary)
      after should not be before
      after shouldBe read(seed)._1
    }

    "change when only a panel binding or an alert rule changes (the cascade state is part of it)" in {
      val seed = seedPipeline()
      val base = read(seed)._1
      exec(s"UPDATE alert_rules SET name='renamed' WHERE id='${seed.rb}'")
      val afterRule = read(seed)._1
      afterRule should not be base
      exec(s"DELETE FROM panels WHERE id='${seed.pb}'")
      read(seed)._1 should not be afterRule
    }
  }
}
