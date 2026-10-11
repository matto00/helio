package com.helio.services.patchsets

import com.helio.api.protocols.dashboards.{DashboardLayoutItemPayload, DashboardLayoutPatchPayload, UpdateDashboardRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.domain.model._

/** HEL-1456: V122 strips a deleted panel from its dashboard's layout, so patch-set undo has to (D7) not read
 *  that as a conflict on the dashboard, and (D5) never restore a pre-delete layout that resurrects the ghost. */
class PatchSetUndoGhostLayoutSpec extends PatchSetUndoServiceFixture {

  private def item(id: PanelId, x: Int, y: Int) = DashboardLayoutItemPayload(id.value, x, y, 2, 2)

  private def layoutEdit(dashboard: Dashboard, lg: Vector[DashboardLayoutItemPayload]): Edit =
    Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update", None,
      Some(UpdateDashboardRequest(None, None, Some(DashboardLayoutPatchPayload(lg = Some(lg))))), None, None, None, None)

  private def deleteEdit(panel: Panel): Edit =
    Edit(EditTarget("panel", Some(panel.id.value)), "delete", None, None, None, None, None, None)

  private def undone(applicationId: String): Vector[String] =
    await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
      case Right(r)  => r.edits.map(_.status)
      case Left(err) => fail(s"undo refused: $err")
    }

  private def lgIds(dashboard: Dashboard): Vector[PanelId] =
    await(dashboardRepo.findByIdInternal(dashboard.id)).get.layout.lg.map(_.panelId)

  "undo of a patch set that updated a dashboard and deleted one of its panels (D7)" should {
    "not be refused as a conflict on the dashboard" in {
      val dashboard = seedDashboard(userA)
      val (p, q)    = (seedPanel(dashboard.id, userA, "p"), seedPanel(dashboard.id, userA, "q"))
      val applicationId = applySuccessfully(Vector(
        layoutEdit(dashboard, Vector(item(p.id, 0, 0), item(q.id, 2, 0))),
        deleteEdit(p)
      ))
      undone(applicationId) should not contain "conflict"
    }

    "not be refused after a later, unrelated delete of another panel on the dashboard" in {
      val dashboard = seedDashboard(userA)
      val (p, q)    = (seedPanel(dashboard.id, userA, "p"), seedPanel(dashboard.id, userA, "q"))
      val applicationId = applySuccessfully(Vector(layoutEdit(dashboard, Vector(item(p.id, 0, 0), item(q.id, 2, 0)))))
      await(panelService.delete(q.id, userA)) shouldBe Right(())
      undone(applicationId) should not contain "conflict"
    }

    "still refuse when a live item of the dashboard moved since apply" in {
      val dashboard = seedDashboard(userA)
      val (p, q)    = (seedPanel(dashboard.id, userA, "p"), seedPanel(dashboard.id, userA, "q"))
      val applicationId = applySuccessfully(Vector(layoutEdit(dashboard, Vector(item(p.id, 0, 0), item(q.id, 2, 0)))))
      await(dashboardService.update(dashboard.id,
        UpdateDashboardRequest(None, None, Some(DashboardLayoutPatchPayload(lg = Some(Vector(item(p.id, 0, 4), item(q.id, 2, 0)))))), userA))
        .isRight shouldBe true
      await(undoService.undo(PatchSetApplicationId(applicationId), userA)).isLeft shouldBe true
    }
  }

  "restoring a pre-delete dashboard layout (D5)" should {
    "store no item for a panel deleted in the same patch set when undone" in {
      val dashboard = seedDashboard(userA)
      val (p, q)    = (seedPanel(dashboard.id, userA, "p"), seedPanel(dashboard.id, userA, "q"))
      val applicationId = applySuccessfully(Vector(deleteEdit(p), layoutEdit(dashboard, Vector(item(q.id, 0, 0)))))
      undone(applicationId)
      lgIds(dashboard) should not contain p.id
    }
  }

  "rolling back a failed patch set that deleted a panel (D5)" should {
    "store no item for the deleted panel when the dashboard layout edit is rolled back" in {
      val dashboard = seedDashboard(userA)
      val (p, q)    = (seedPanel(dashboard.id, userA, "p"), seedPanel(dashboard.id, userA, "q"))
      // A blank name passes the apply service's pre-validation and fails at DashboardService.update: a genuine mid-set failure.
      val failing = Edit(EditTarget("dashboard", Some(dashboard.id.value)), "update", None, Some(UpdateDashboardRequest(Some(""), None, None)), None, None, None, None)
      val response = await(applyService.apply(PatchSet(None, Vector(layoutEdit(dashboard, Vector(item(p.id, 0, 0), item(q.id, 2, 0))), deleteEdit(p), failing)), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected a reported failure, got Left($err)")
      }
      response.failure shouldBe defined
      response.edits.map(_.status).toSet shouldBe Set("rolledBack", "recreated")
      lgIds(dashboard) should not contain p.id
    }
  }
}
