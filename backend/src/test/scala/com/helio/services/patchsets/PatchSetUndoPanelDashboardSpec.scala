package com.helio.services.patchsets

import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.UpdateDataSourceRequest
import com.helio.domain._
import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import spray.json._

/** Service-level coverage for `PatchSetUndoService.undo` restoring panel, dashboard and
 *  output-placement edits (HEL-413, tasks.md 5.3a/5.3b/5.5; HEL-1295). Fixture shared via
 *  `PatchSetUndoServiceFixture`. */
class PatchSetUndoPanelDashboardSpec extends PatchSetUndoServiceFixture {

  "PatchSetUndoService.undo" should {

    // HEL-904 task 3.3: `dataType` dropped from this scenario's edit set --
    // `dataType` is no longer a valid target.kind at all.
    "restore panel/dashboard/dataSource/pipeline/pipelineStep update edits to their pre-apply state (5.3a)" in {
      val dashboard          = seedDashboard(userA, "Dashboard v1")
      val panel               = seedPanel(dashboard.id, userA, "Panel v1")
      val dataSourceId = seedDatasetSource(userA, "Source v1")
      val pipelineSrcId = seedDatasetSource(userA, "Pipeline source v1")
      val pipeline             = seedPipeline(userA, pipelineSrcId, "Pipeline v1")
      // HEL-705 (2.6): seeded DISABLED so the full-revert undo path is asserted to preserve the
      // captured `enabled` state, mirroring 5.3c's delete-and-recreate coverage below.
      val step                  = seedPipelineStep(
        PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("a" -> JsString("b"))), enabled = Some(false)
      )

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Panel v2"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Dashboard v2"), None, None)), None, None, None, None),
        Edit(EditTarget("dataSource", Some(dataSourceId.value)), "update",
          None, None, Some(UpdateDataSourceRequest(name = Some("Source v2"))), None, None, None),
        Edit(EditTarget("pipeline", Some(pipeline.id)), "update",
          None, None, None, Some(UpdatePipelineRequest(name = "Pipeline v2")), None, None),
        Edit(EditTarget("pipelineStep", Some(step.id)), "update",
          None, None, None, None, Some(UpdatePipelineStepRequest(None, Some(JsObject("renames" -> JsObject("x" -> JsString("y")))), None)), None)
      )
      val applicationId = applySuccessfully(edits)

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(response) => response.edits.map(_.status) shouldBe Vector.fill(5)("restored")
        case Left(err)         => fail(s"expected success, got $err")
      }

      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Panel v1")
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Dashboard v1")
      await(dataSourceRepo.findByIdInternal(dataSourceId)).map(_.name) shouldBe Some("Source v1")
      await(pipelineRepo.findByIdInternal(PipelineId(pipeline.id))).map(_.name) shouldBe Some("Pipeline v1")
      val restoredStep = await(pipelineStepRepo.findByIdInternal(PipelineStepId(step.id))).getOrElse(fail("step missing"))
      restoredStep.asInstanceOf[RenameStep].config.renames shouldBe Map("a" -> "b")
      // HEL-705 (2.6): the full-revert undo must NOT silently come back enabled.
      restoredStep.enabled shouldBe false
    }


    "restore a panel create edit by deleting the created panel, and a panel delete edit by recreating it under a new id (5.3b)" in {
      val dashboard     = seedDashboard(userA)
      val panelToDelete = seedPanel(dashboard.id, userA, "Delete me")

      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("Created by patch set"),
        "type"        -> JsString("divider")
      )
      val edits = Vector(
        Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(createPatch)),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None)
      )
      val applyResponse = await(applyService.apply(PatchSet(None, edits), userA)) match {
        case Right(r) if r.applicationId.isDefined => r
        case other                                  => fail(s"expected a successful, journaled apply, got $other")
      }
      val createdPanelId = applyResponse.edits.find(_.index == 0).flatMap(_.newId).getOrElse(fail("expected newId"))
      val applicationId  = applyResponse.applicationId.get

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      val createUndo = undoResponse.edits.find(_.index == 0).getOrElse(fail("missing outcome"))
      createUndo.status shouldBe "restored"
      // skeptic-final-2.md CR1: `newId` carries the just-deleted resource's OWN id (not a
      // freshly-minted one -- nothing new was created) so a caller can still identify which
      // resource was removed once `resultingState`/`priorState` are both unavailable.
      createUndo.newId shouldBe Some(createdPanelId)
      val deleteUndo = undoResponse.edits.find(_.index == 1).getOrElse(fail("missing outcome"))
      deleteUndo.status shouldBe "recreated"
      val recreatedId = deleteUndo.newId.getOrElse(fail("expected newId"))
      recreatedId should not be panelToDelete.id.value

      await(panelRepo.findByIdInternal(PanelId(createdPanelId))) shouldBe None
      await(panelRepo.findByIdInternal(panelToDelete.id)) shouldBe None
      await(panelRepo.findByIdInternal(PanelId(recreatedId))).map(_.title) shouldBe Some("Delete me")
    }

    // HEL-907 tasks.md 5.5 -- a "placement" is an output-kind Panel (design.md's own naming:
    // "placement = panel"); its ONLY payload beyond the common identity/appearance fields every
    // Panel carries is `config.outputId` (OutputPanelConfig, replacing the five retired bound-
    // panel configs' fieldMapping/aggregation/etc -- see OutputPanel.scala's own doc). This test
    // proves that field specifically survives BOTH directions of undo: a create edit's undo
    // (delete) and a delete edit's undo (recreate) -- the panel/dashboard/pipelineStep tests
    // above never exercise an "output"-kind panel at all, only "divider"/generic ones, so this
    // was a real, previously-unverified gap (flagged explicitly in tasks.md's own 5.5 entry).
    // `panelService` is wired with the real `outputRepo` (HEL-1295), so the outputId-existence
    // check runs for real -- both Outputs below are genuine persisted rows. The test is about
    // placement-field PRESERVATION through undo, not Output existence validation (see the next
    // test for the undo-time rejection).
    "restore an output-kind placement panel's create/delete-undo, preserving config.outputId (5.5)" in {
      val dashboard    = seedDashboard(userA)
      val sourceId      = seedDatasetSource(userA, "Placement-preservation source")
      val pipeline      = seedPipeline(userA, sourceId, "Placement-preservation pipeline")
      val outputToDelete = seedOutput(pipeline, userA, "Output to delete's panel")
      val outputToCreate = seedOutput(pipeline, userA, "Output the new panel binds to")
      val panelToDelete = await(panelService.create(
        CreatePanelRequest(
          Some(dashboard.id.value),
          Some("Existing placement"),
          Some("output"),
          Some(JsObject("outputId" -> JsString(outputToDelete.id.value)))
        ),
        userA
      )) match {
        case Right((p, _)) => p
        case Left(e)  => fail(s"seed output panel failed: $e")
      }

      val createPatch = JsObject(
        "dashboardId" -> JsString(dashboard.id.value),
        "title"       -> JsString("New placement"),
        "type"        -> JsString("output"),
        "config"      -> JsObject("outputId" -> JsString(outputToCreate.id.value))
      )
      val edits = Vector(
        Edit(EditTarget("panel", None), "create", None, None, None, None, None, Some(createPatch)),
        Edit(EditTarget("panel", Some(panelToDelete.id.value)), "delete", None, None, None, None, None, None)
      )
      val applyResponse = await(applyService.apply(PatchSet(None, edits), userA)) match {
        case Right(r) if r.applicationId.isDefined => r
        case other                                  => fail(s"expected a successful, journaled apply, got $other")
      }
      val createdPanelId = applyResponse.edits.find(_.index == 0).flatMap(_.newId).getOrElse(fail("expected newId"))
      val applicationId  = applyResponse.applicationId.get

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      val deleteUndo = undoResponse.edits.find(_.index == 1).getOrElse(fail("missing outcome"))
      deleteUndo.status shouldBe "recreated"
      val recreatedId = deleteUndo.newId.getOrElse(fail("expected newId"))

      await(panelRepo.findByIdInternal(PanelId(createdPanelId))) shouldBe None
      val recreatedPanel = await(panelRepo.findByIdInternal(PanelId(recreatedId))).getOrElse(fail("recreated panel missing"))
      recreatedPanel.asInstanceOf[OutputPanel].config.outputId.value shouldBe outputToDelete.id.value
    }

    // HEL-1295: undo-path counterpart of `PanelServiceOutputBindingSpec`. Recreating a deleted
    // output panel re-runs `PanelService`'s outputId check; once the Output is gone, undo must be
    // refused (the check is no longer skippable for lack of a repository) rather than recreating
    // a panel bound to nothing. NOTE: a regression guard, not a mutation proof -- with the app-level
    // check removed the `panels.output_id` FK still refuses the recreate, so this stays green; the
    // check itself is pinned by `PanelServiceOutputBindingSpec`.
    "refuse to recreate a deleted output panel whose Output no longer resolves (HEL-1295)" in {
      val dashboard = seedDashboard(userA)
      val sourceId  = seedDatasetSource(userA, "Undo-missing-output source")
      val pipeline  = seedPipeline(userA, sourceId, "Undo-missing-output pipeline")
      val output    = seedOutput(pipeline, userA, "Soon-gone Output")
      val panel = await(panelService.create(
        CreatePanelRequest(Some(dashboard.id.value), Some("Bound panel"), Some("output"),
          Some(JsObject("outputId" -> JsString(output.id.value)))),
        userA
      )) match {
        case Right((p, _)) => p
        case Left(e)       => fail(s"seed output panel failed: $e")
      }
      val applicationId = applySuccessfully(Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "delete", None, None, None, None, None, None)
      ))
      await(outputRepo.deleteInternal(output.id)) shouldBe true

      val undone = await(undoService.undo(PatchSetApplicationId(applicationId), userA))

      val statuses = undone.toOption.toVector.flatMap(_.edits.map(_.status))
      statuses should not contain "recreated"
      await(panelRepo.findByIdInternal(panel.id)) shouldBe None
      await(panelRepo.findAllByDashboardId(dashboard.id, Some(userA), Page.Default)).items shouldBe empty
    }

    // skeptic-final-2.md CR1: a `dashboard` `create` edit's undo has no parent id to fall back
    // to on the frontend (unlike a panel create, whose original patch still carries a
    // `dashboardId`) -- `newId` on the `EditUndoOutcome` itself is the ONLY surviving way to
    // identify which dashboard was removed once `resultingState`/`priorState` are both absent.
    "restore a dashboard create edit by deleting the created dashboard, with newId populated on the undo outcome (5.3b-dashboard)" in {
      val createPatch = JsObject("name" -> JsString("Created by patch set"))
      val edit = Edit(EditTarget("dashboard", None), "create", None, None, None, None, None, Some(createPatch))
      val applyResponse = await(applyService.apply(PatchSet(None, Vector(edit)), userA)) match {
        case Right(r) if r.applicationId.isDefined => r
        case other                                  => fail(s"expected a successful, journaled apply, got $other")
      }
      val createdDashboardId = applyResponse.edits.head.newId.getOrElse(fail("expected newId"))
      val applicationId      = applyResponse.applicationId.get

      val undoResponse = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      val outcome = undoResponse.edits.head
      outcome.status shouldBe "restored"
      outcome.newId shouldBe Some(createdDashboardId)
      outcome.resultingState shouldBe None

      await(dashboardRepo.findByIdInternal(DashboardId(createdDashboardId))) shouldBe None
    }
  }
}
