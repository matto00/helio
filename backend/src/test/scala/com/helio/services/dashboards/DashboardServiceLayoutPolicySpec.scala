package com.helio.services.dashboards

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.api.protocols.dashboards.{DashboardLayoutItemPayload, DashboardLayoutPatchPayload, UpdateDashboardRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.dashboards.{DashboardRepository, DashboardWriteResult, LayoutCas}
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.panels.LayoutWritePolicy
import org.mockito.Mockito.mock
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1071 (D7, task 3.7): `DashboardService.update`'s layout policy at the service seam. The
 *  patch-set rollback/undo paths pass `RestorePriorStored` — they write back a value that was once
 *  stored (possibly stored-bad), so they must not 400 — while every route-reachable call validates. */
class DashboardServiceLayoutPolicySpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val owner = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val id    = DashboardId(UUID.randomUUID().toString)
  private val now   = Instant.parse("2026-01-01T00:00:00Z")

  private def item(p: String, x: Int, y: Int, w: Int = 1, h: Int = 2) = DashboardLayoutItem(PanelId(p), x, y, w, h)
  private def payloads(items: Vector[DashboardLayoutItem]) =
    Some(items.map(i => DashboardLayoutItemPayload(i.panelId.value, i.x, i.y, i.w, i.h)))

  private val storedBadXs = Vector(item("a", 0, 0), item("b", 0, 0))
  private val storedGood  = Vector(item("a", 0, 0), item("b", 1, 0))

  /** Records every `writeFields` call; the value classes in its signature cannot be matched with Mockito's `any()`. */
  private final class RecordingRepo(dashboard: Dashboard) extends DashboardRepository(null) {
    var writes: Vector[Option[LayoutCas]] = Vector.empty
    override def findById(i: DashboardId, caller: Option[AuthenticatedUser]): Future[Option[Dashboard]] = Future.successful(Some(dashboard))
    // HEL-1456: a layout write keeps only items of panels on the dashboard; `a` and `b` are the live ones here.
    override def panelIdsInternal(i: DashboardId): Future[Set[PanelId]] = Future.successful(Set(PanelId("a"), PanelId("b")))
    override def writeFields(
        i: DashboardId, o: UserId, layout: Option[LayoutCas], name: Option[String], appearance: Option[DashboardAppearance], at: Instant
    ): Future[DashboardWriteResult] = {
      writes :+= layout
      Future.successful(DashboardWriteResult.Written(layout.fold(dashboard)(cas => dashboard.copy(layout = cas.next))))
    }
  }

  private def serviceStoring(layout: DashboardLayout): (DashboardService, RecordingRepo) = {
    val dashboard = Dashboard(id, "D", ResourceMeta(owner.id.value, now, now), DashboardAppearance.Default, layout, owner.id)
    val repo      = new RecordingRepo(dashboard)
    (new DashboardService(repo, mock(classOf[AccessChecker]), outputRepo = mock(classOf[OutputRepository])), repo)
  }

  // The stored dashboard has a good xs; the value being "restored" is a previously stored-bad one.
  private val restoreBad = UpdateDashboardRequest(None, None, Some(DashboardLayoutPatchPayload(xs = payloads(storedBadXs))))

  "DashboardService.update" should {
    "reject writing back a stored-bad breakpoint under the default Validate policy, writing nothing" in {
      val (service, repo) = serviceStoring(DashboardLayout(Vector.empty, Vector.empty, Vector.empty, storedGood))
      val result = await(service.update(id, restoreBad, owner))
      result.left.toOption.get shouldBe a[ServiceError.BadRequest]
      repo.writes shouldBe empty
    }

    "write the stored-bad prior value back under RestorePriorStored (the rollback/undo exemption)" in {
      val (service, repo) = serviceStoring(DashboardLayout(Vector.empty, Vector.empty, Vector.empty, storedGood))
      val result = await(service.update(id, restoreBad, owner, LayoutWritePolicy.RestorePriorStored))
      result.isRight shouldBe true
      repo.writes.last.get.next.xs shouldBe storedBadXs
    }

    "skip validation of a breakpoint identical to stored even under Validate (grandfathering)" in {
      val (service, repo) = serviceStoring(DashboardLayout(Vector.empty, Vector.empty, Vector.empty, storedBadXs))
      val request = UpdateDashboardRequest(None, None, Some(DashboardLayoutPatchPayload(lg = payloads(Vector(item("a", 0, 0, 6))), xs = payloads(storedBadXs.reverse))))
      await(service.update(id, request, owner)).isRight shouldBe true
      repo.writes.last.get.next.xs shouldBe storedBadXs
      repo.writes.last.get.next.lg shouldBe Vector(item("a", 0, 0, 6))
    }
  }
}
