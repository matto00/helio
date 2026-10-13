package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{Edit, EditTarget}
import com.helio.api.protocols.pipelines.CreatePipelineStepRequest
import com.helio.domain.model._
import spray.json._

/** HEL-1515 (assumed product call, change design.md D4 / OWNER REVIEW): a patch-set undo that recreates a deleted
 *  step goes through `PipelineService.addStep`, so it inherits the descendant-lane rejection. A deleted lane
 *  referrer that was a tail SIBLING of its lane target is recreated as a trunk splice (the journal does not record
 *  `attachAsTail`), which would re-parent that target under it; the undo now fails for that edit instead of
 *  silently restoring an unrunnable pipeline. */
class PatchSetUndoLaneDescendantsSpec extends PatchSetUndoServiceFixture {

  "PatchSetUndoService.undo" should {
    "fail the recreate of a deleted lane referrer whose sibling lane target the recreate would re-parent under it, leaving the graph runnable" in {
      val sourceId = seedDatasetSource(userA, "Undo-lane-descendants source")
      val pipeline = seedPipeline(userA, sourceId, "Undo-lane-descendants pipeline")
      val pid      = PipelineId(pipeline.id)
      val anchor   = seedPipelineStep(pid, userA, "limit", JsObject("count" -> JsNumber(100)))
      val lane     = seedPipelineStep(pid, userA, "limit", JsObject("count" -> JsNumber(50)), parentStepId = Some(anchor.id))
      // A tail sibling of `lane` under `anchor`: nothing is re-parented, so the lane reference is legal.
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
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(lane.id))).get.parentStepId shouldBe Some(PipelineStepId(anchor.id))

      val applicationId = applySuccessfully(Vector(Edit(EditTarget("pipelineStep", Some(referrer.id)), "delete", None, None, None, None, None, None)))
      val undoResponse  = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected a (partial) undo response, got $err")
      }
      undoResponse.edits.head.status shouldBe "failed"
      // The lane target was never re-parented under a recreated referrer.
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(lane.id))).get.parentStepId shouldBe Some(PipelineStepId(anchor.id))
    }
  }
}
