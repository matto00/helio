package com.helio.services.patchsets

import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.patchsets.{Edit, EditTarget}
import com.helio.domain._
import com.helio.domain.model._
import com.helio.services.ServiceError
import spray.json._

/** Service-level coverage for `PatchSetUndoService.undo` restoring pipelineStep (lane)
 *  create/delete edits (HEL-413 5.3c; HEL-914 5.6-5.8; HEL-766). Fixture shared via
 *  `PatchSetUndoServiceFixture`. */
class PatchSetUndoLaneSpec extends PatchSetUndoServiceFixture {

  "PatchSetUndoService.undo" should {

    "restore a pipelineStep delete edit by recreating it with its content restored (5.3c)" in {
      val sourceId = seedDatasetSource(userA, "Step-delete pipeline source")
      val pipeline        = seedPipeline(userA, sourceId, "Step-delete pipeline")
      // HEL-705: seeded DISABLED so the delete-and-recreate undo path is asserted to preserve
      // (not silently drop) the captured `enabled` state.
      val step              = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("old" -> JsString("new"))), enabled = Some(false)
      )

      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "delete", None, None, None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit))

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      undoResponse.edits.head.status shouldBe "recreated"
      val recreatedId = undoResponse.edits.head.newId.getOrElse(fail("expected newId"))

      await(pipelineStepRepo.findByIdInternal(PipelineStepId(step.id))) shouldBe None
      val recreated = await(pipelineStepRepo.findByIdInternal(PipelineStepId(recreatedId))).getOrElse(fail("recreated step missing"))
      recreated.asInstanceOf[RenameStep].config.renames shouldBe Map("old" -> "new")
      // HEL-705: the recreated step must NOT silently come back enabled.
      recreated.enabled shouldBe false
    }

    // HEL-914 task 5.8 (patch-set-lane-edits spec): "Removing a lane by patch set and undoing
    // it restores its Outputs and placements".
    "restore a pipelineStep delete edit's bound Output AND that Output's placement (5.8)" in {
      val sourceId = seedDatasetSource(userA, "Step-delete-with-output pipeline source")
      val pipeline = seedPipeline(userA, sourceId, "Step-delete-with-output pipeline")
      val step = seedPipelineStep(PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("old" -> JsString("new"))))
      val output = await(outputRepo.insertInternal(
        PipelineId(pipeline.id), Some(PipelineStepId(step.id)), userA.id, "Lane output", OutputKind.Table, explicitRootId = None
      ))
      val dashboard = seedDashboard(userA)
      val panel = await(panelService.create(
        CreatePanelRequest(Some(dashboard.id.value), Some("Lane panel"), Some("output"), Some(JsObject("outputId" -> JsString(output.id.value)))), userA
      )) match {
        case Right((p, _)) => p
        case Left(e)         => fail(s"panel create failed: $e")
      }

      val edit = Edit(EditTarget("pipelineStep", Some(step.id)), "delete", None, None, None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit))

      // The delete cascaded the Output and its placement (V94 ON DELETE CASCADE).
      await(outputRepo.findByIdInternal(output.id)) shouldBe None
      await(panelRepo.findByIdInternal(panel.id)) shouldBe None

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      undoResponse.edits.head.status shouldBe "recreated"
      val recreatedStepId = undoResponse.edits.head.newId.getOrElse(fail("expected newId"))

      val restoredOutputs = await(outputRepo.listByPipelineInternal(PipelineId(pipeline.id)))
        .filter(_.node.stepId.contains(PipelineStepId(recreatedStepId)))
      restoredOutputs should have size 1
      restoredOutputs.head.name shouldBe "Lane output"

      val restoredPanels = await(panelRepo.findByOutputIdInternal(restoredOutputs.head.id.value))
      restoredPanels should have size 1
      restoredPanels.head.title shouldBe "Lane panel"
    }

    // HEL-914 task 5.6: undoing an "add lane" (pipelineStep create) removes the step, its
    // bound Output, AND that Output's placement (panel) atomically via the same cascade a real
    // delete already relies on -- and reports the placement count.
    "restore a pipelineStep create edit ('add lane') by removing the step AND cascading its Output/placement, reporting the placement count" in {
      val sourceId = seedDatasetSource(userA, "Lane-create pipeline source")
      val pipeline = seedPipeline(userA, sourceId, "Lane-create pipeline")
      val createPatch = JsObject("type" -> JsString("limit"), "config" -> JsObject("count" -> JsNumber(1)))
      val edit = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))
      val applicationId = applySuccessfully(Vector(edit))

      val application = await(applicationRepo.findById(PatchSetApplicationId(applicationId), userA)).getOrElse(fail("application missing"))
      val createdStepId = application.edits.head.newId.getOrElse(fail("expected newId"))

      // Bind an Output to the new lane, and a panel placement to that Output -- the SAME
      // cascade chain a real pipelineStep delete already relies on (V94's
      // outputs.node_step_id/panels.output_id ON DELETE CASCADE).
      val output = await(outputRepo.insertInternal(
        PipelineId(pipeline.id), Some(PipelineStepId(createdStepId)), userA.id, "Lane output", OutputKind.Table, explicitRootId = None
      ))
      val dashboard = seedDashboard(userA)
      val panel = await(panelService.create(
        CreatePanelRequest(Some(dashboard.id.value), Some("Lane panel"), Some("output"), Some(JsObject("outputId" -> JsString(output.id.value)))), userA
      )) match {
        case Right((p, _)) => p
        case Left(e)         => fail(s"panel create failed: $e")
      }

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      undoResponse.edits.head.status shouldBe "restored"
      undoResponse.edits.head.resultingState.map(_.asJsObject.fields("removedPlacementCount")) shouldBe Some(JsNumber(1))

      await(pipelineStepRepo.findByIdInternal(PipelineStepId(createdStepId))) shouldBe None
      await(outputRepo.findByIdInternal(output.id)) shouldBe None
      await(panelRepo.findByIdInternal(panel.id)) shouldBe None
    }

    // HEL-914 task 5.7: refuses the undo (rather than deleting a node still relied on) when a
    // step added LATER carries a lane-kind secondaryInput referencing the node being undone.
    "refuse to undo a pipelineStep create when a later step's lane secondaryInput references it" in {
      val sourceId = seedDatasetSource(userA, "Lane-conflict pipeline source")
      val pipeline = seedPipeline(userA, sourceId, "Lane-conflict pipeline")
      // A trunk anchor BOTH the lane (created by the patch-set edit) and the later referencing
      // step branch off of, as SIBLINGS -- neither an ancestor of the other, so the lane
      // reference below is a genuine cross-lane reference, not a (rejected) self-ancestor cycle.
      val anchor = seedPipelineStep(PipelineId(pipeline.id), userA, "limit", JsObject("count" -> JsNumber(100)))
      val createPatch = JsObject("type" -> JsString("limit"), "config" -> JsObject("count" -> JsNumber(1)), "parentStepId" -> JsString(anchor.id))
      val edit = Edit(EditTarget("pipelineStep", None, Some(pipeline.id)), "create", None, None, None, None, None, Some(createPatch))
      val applicationId = applySuccessfully(Vector(edit))

      val application = await(applicationRepo.findById(PatchSetApplicationId(applicationId), userA)).getOrElse(fail("application missing"))
      val createdStepId = application.edits.head.newId.getOrElse(fail("expected newId"))

      // A later SIBLING step (also branching off `anchor`) whose union config's secondaryInput
      // is `lane`-kind, referencing the lane this application created.
      seedPipelineStep(
        PipelineId(pipeline.id), userA, "union",
        JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString(createdStepId)), "mode" -> JsString("byPosition")),
        parentStepId = Some(anchor.id)
      )

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Left(ServiceError.Conflict(msg)) => msg should include(createdStepId)
        case other                              => fail(s"expected Conflict, got $other")
      }
      // Nothing restored -- the lane and its (nonexistent, in this test) Output are untouched.
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(createdStepId))) shouldBe defined
    }

    "restore a pipelineStep delete edit by recreating it under its original parentStepId, not silently re-parenting it to the trunk (HEL-766)" in {
      val sourceId = seedDatasetSource(userA, "Step-delete branch pipeline source")
      val pipeline = seedPipeline(userA, sourceId, "Step-delete branch pipeline")
      val rootStep = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("a" -> JsString("b")))
      )
      // Extend the trunk with a SECOND trunk step, so `rootStep` is NOT the trunk-last step by
      // the time the branched step below is deleted-and-undone -- this is the load-bearing part
      // of the fixture (evaluator-final-2): `addStep`'s own default ("parentStepId absent" ->
      // splice onto the CURRENT trunk-last step) would attach a wrongly-defaulted recreate onto
      // `trunkTail`, not `rootStep` -- a DIFFERENT, and therefore assertion-failable, target. The
      // ORIGINAL version of this test branched off the pipeline's ONLY trunk step, which made the
      // default-trunk-append target and the real branch-point target coincide -- the assertion
      // passed whether or not `parentStepId` was actually threaded through the undo path at all.
      val trunkTail = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("c" -> JsString("d"))),
        parentStepId = Some(rootStep.id)
      )
      // Branch a THIRD step off `rootStep` specifically (not off `trunkTail`, the trunk-last step).
      val branchedStep = seedPipelineStep(
        PipelineId(pipeline.id),
        userA,
        "rename",
        JsObject("renames" -> JsObject("old" -> JsString("new"))),
        parentStepId = Some(rootStep.id)
      )

      val edit = Edit(EditTarget("pipelineStep", Some(branchedStep.id)), "delete", None, None, None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit))

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      undoResponse.edits.head.status shouldBe "recreated"
      val recreatedId = undoResponse.edits.head.newId.getOrElse(fail("expected newId"))

      val recreated = await(pipelineStepRepo.findByIdInternal(PipelineStepId(recreatedId))).getOrElse(fail("recreated step missing"))
      // HEL-766: must remain branched off rootStep specifically, not silently reparented onto
      // trunkTail (the trunk-last step `addStep`'s own default would target).
      recreated.parentStepId shouldBe Some(PipelineStepId(rootStep.id))
      recreated.parentStepId should not be Some(PipelineStepId(trunkTail.id))
    }
  }
}
