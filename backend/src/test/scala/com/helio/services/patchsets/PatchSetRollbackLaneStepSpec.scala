package com.helio.services.patchsets

import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.CreatePipelineStepRequest
import com.helio.domain.model._
import spray.json._

/** HEL-1523 (characterization, no behaviour change): what a patch-set rollback does when the failed apply had
 *  deleted a lane referrer that was a tail SIBLING of its lane target. Rollback recreates a deleted step through
 *  `PipelineService.addStep` WITHOUT `attachAsTail` (the captured prior state does not record it), so the
 *  recreate is a trunk splice that would re-parent the lane target under the referrer; HEL-1515's descendant
 *  rejection refuses it. The pins below assert what the code ACTUALLY does. */
class PatchSetRollbackLaneStepSpec extends PatchSetUndoServiceFixture {

  "PatchSetApplyService rollback" should {
    "leave a deleted tail-adjacent lane referrer deleted and report it unrecoverable, never re-parenting its lane target" in {
      val sourceId = seedDatasetSource(userA, "Rollback-lane source")
      val pipeline = seedPipeline(userA, sourceId, "Rollback-lane pipeline")
      val pid      = PipelineId(pipeline.id)
      val dashboard = seedDashboard(userA, "Rollback-lane dashboard")
      val anchor   = seedPipelineStep(pid, userA, "limit", JsObject("count" -> JsNumber(100)))
      val lane     = seedPipelineStep(pid, userA, "limit", JsObject("count" -> JsNumber(50)), parentStepId = Some(anchor.id))
      val referrerConfig = JsObject(
        "secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString(lane.id)),
        "mode"           -> JsString("byPosition")
      )
      val referrer = await(pipelineService.addStep(
        pid, CreatePipelineStepRequest("union", referrerConfig, parentStepId = Some(anchor.id), attachAsTail = Some(true)), userA
      )) match {
        case Right(s) => s
        case Left(e)  => fail(s"referrer seed failed: $e")
      }

      val edits = Vector(
        Edit(EditTarget("pipelineStep", Some(referrer.id)), "delete", None, None, None, None, None, None),
        // A blank dashboard name passes pre-validation and fails at DashboardService.update: a genuine mid-apply failure.
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update", None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      )
      val response = await(applyService.apply(PatchSet(None, edits), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected Right with failure reported, got Left($err)")
      }

      response.failure shouldBe defined
      response.edits.find(_.index == 0).map(_.status) shouldBe Some("unrecoverable")
      // Nothing restored the referrer, in either form...
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(referrer.id))) shouldBe None
      val remaining = await(pipelineStepRepo.listByPipelineInternal(pid))
      remaining.map(_.id.value).toSet shouldBe Set(anchor.id, lane.id)
      // ...and the lane target kept its parent: the graph is still the runnable one it was before the apply.
      remaining.find(_.id.value == lane.id).get.parentStepId shouldBe Some(PipelineStepId(anchor.id))
    }
  }
}
