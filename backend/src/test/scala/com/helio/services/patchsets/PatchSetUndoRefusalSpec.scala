package com.helio.services.patchsets

import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.panels.UpdatePanelRequest
import com.helio.api.protocols.patchsets.{Edit, EditTarget}
import com.helio.domain.model._
import com.helio.services.ServiceError

import java.util.UUID

/** Service-level coverage for `PatchSetUndoService.undo` whole-undo refusals, Phase-2 failure
 *  reporting and 404 access (HEL-413, tasks.md 5.3d-5.3g). Fixture shared via
 *  `PatchSetUndoServiceFixture`. */
class PatchSetUndoRefusalSpec extends PatchSetUndoServiceFixture {

  "PatchSetUndoService.undo" should {

    // ── 5.3d: structurally-unrecoverable delete-kind blocks the WHOLE undo ──

    "refuse the whole undo when the application contains a structurally-unrecoverable delete edit, restoring nothing else in that application (5.3d)" in {
      val dashboard      = seedDashboard(userA)
      val panel            = seedPanel(dashboard.id, userA, "Before")
      val sourceId = seedDatasetSource(userA, "Unrecoverable pipeline source")
      val pipeline          = seedPipeline(userA, sourceId, "To delete")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("After"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("pipeline", Some(pipeline.id)), "delete", None, None, None, None, None, None)
      )
      val applicationId = applySuccessfully(edits)

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Left(ServiceError.Conflict(msg)) => msg.toLowerCase should include("unrecoverable")
        case other                              => fail(s"expected Conflict, got $other")
      }
      // Nothing was restored -- the panel-update edit's undo never ran.
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("After")
    }


    "refuse the whole undo when a touched resource conflicts, restoring none of the application's edits (5.3e)" in {
      val dashboard = seedDashboard(userA, "Conflict dashboard v1")
      val panel     = seedPanel(dashboard.id, userA, "Conflict panel v1")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panel.id.value)), "update",
          Some(UpdatePanelRequest(Some("Conflict panel v2"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update",
          None, Some(UpdateDashboardRequest(Some("Conflict dashboard v2"), None, None)), None, None, None, None)
      )
      val applicationId = applySuccessfully(edits)

      // Independent change since the apply -- a genuine conflict on the panel's title.
      await(panelService.update(panel.id, UpdatePanelRequest(Some("Changed by someone else"), None, None, None), userA)) match {
        case Right(_) => ()
        case Left(err) => fail(s"setup failed: $err")
      }

      await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Left(ServiceError.Conflict(_)) => succeed
        case other                            => fail(s"expected Conflict, got $other")
      }
      // Neither edit was restored -- the dashboard-update edit's undo never ran either.
      await(dashboardRepo.findByIdInternal(dashboard.id)).map(_.name) shouldBe Some("Conflict dashboard v2")
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Changed by someone else")
    }

    // ── 5.3f: an unforeseeable Phase-2 failure reports an honest mixed outcome ─

    "report a Phase-2 runtime failure honestly: the failed edit failed, earlier-index edits notAttempted, later-index edits still restored (5.3f)" in {
      val dashboardMain = seedDashboard(userA, "Main dashboard")
      val panelA          = seedPanel(dashboardMain.id, userA, "Panel A v1")
      val dashboardDoomed = seedDashboard(userA, "Doomed dashboard")
      val panelB            = seedPanel(dashboardDoomed.id, userA, "Panel B")
      val panelC              = seedPanel(dashboardMain.id, userA, "Panel C v1")

      val edits = Vector(
        Edit(EditTarget("panel", Some(panelA.id.value)), "update",
          Some(UpdatePanelRequest(Some("Panel A v2"), None, None, None)), None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelB.id.value)), "delete", None, None, None, None, None, None),
        Edit(EditTarget("panel", Some(panelC.id.value)), "update",
          Some(UpdatePanelRequest(Some("Panel C v2"), None, None, None)), None, None, None, None, None)
      )
      val applicationId = applySuccessfully(edits)

      // Independently delete panel B's dashboard AFTER the apply -- Phase 1 can't detect this
      // (a delete edit's undo is always "eligible", no live state to check), but Phase 2's
      // recreate (which targets the original dashboardId) now genuinely fails.
      await(dashboardService.delete(dashboardDoomed.id, userA)) match {
        case Right(_)  => ()
        case Left(err) => fail(s"setup failed: $err")
      }

      val response = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected a 200 with a mixed outcome (design.md D4), got $err")
      }
      response.edits.find(_.index == 2).map(_.status) shouldBe Some("restored")
      response.edits.find(_.index == 1).map(_.status) shouldBe Some("failed")
      response.edits.find(_.index == 0).map(_.status) shouldBe Some("notAttempted")

      // Panel C (higher index, restored earlier in the reverse walk) really was reverted...
      await(panelRepo.findByIdInternal(panelC.id)).map(_.title) shouldBe Some("Panel C v1")
      // ...but panel A (lower index, notAttempted) was NOT compensated back -- still at its
      // post-apply value, per design.md D4's documented narrower guarantee.
      await(panelRepo.findByIdInternal(panelA.id)).map(_.title) shouldBe Some("Panel A v2")
    }


    "reject undoing another user's application (404), touching nothing (5.3g)" in {
      val dashboard = seedDashboard(userA)
      val panel     = seedPanel(dashboard.id, userA, "Owner only")
      val edit = Edit(EditTarget("panel", Some(panel.id.value)), "update",
        Some(UpdatePanelRequest(Some("Should never apply"), None, None, None)), None, None, None, None, None)
      val applicationId = applySuccessfully(Vector(edit))

      await(undoService.undo(PatchSetApplicationId(applicationId), userB)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound, got $other")
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Should never apply")
    }

    "reject undoing a nonexistent applicationId (404) -- the same behavior a pruned id would exhibit (5.3g)" in {
      await(undoService.undo(PatchSetApplicationId(UUID.randomUUID().toString), userA)) match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                            => fail(s"expected NotFound, got $other")
      }
    }


    // HEL-904 task 4.5: metric-bound raw-override conflict detection (5.3h) AND its negative
    // counterpart ("NOT treat an unrelated metric deprecation...") both removed -- metrics no
    // longer exist.
  }
}
