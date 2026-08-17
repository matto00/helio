package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.PanelRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Regression coverage for beta UI-audit finding F-004: `toDashboardEntry` used to derive
 *  `panelCount` from `Dashboard.layout` (`distinctPanelCount`), which undercounts (down to 0) any
 *  panel the client's default auto-layout placed without ever being manually dragged/resized —
 *  `dashboard.layout` is written only by that debounce-gated drag/resize persist path
 *  (`PanelGrid`'s 250ms layout-change debounce). The fix threads a real
 *  `PanelRepository.findAllByDashboardId(..., Page(0, 1)).total` read through a new
 *  `Option`-guarded `panelRepoOpt` constructor param, mirroring
 *  `agentPreferencesServiceOpt`/`agentMemoryServiceOpt`'s existing default-`None` precedent.
 *
 *  Mirrors `WorkspaceContextServiceComputeJoinHintsSpec`'s no-DB-fixture, stubbed-collaborator
 *  pattern — `toDashboardEntry`/`panelCountFor` never touch `dashboardService`/`dataSourceService`/
 *  `dataTypeService`/`pipelineService`, so those four are `null` here, same as that spec. The
 *  `PanelRepository` stub below is a plain anonymous subclass (not a mock) overriding only
 *  `findAllByDashboardId` — `PanelRepository(ctx = null)`'s own field initializers
 *  (`TableQuery[...]`) never touch `ctx`, so this is safe. */
class WorkspaceContextServicePanelCountSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now  = Instant.parse("2026-01-01T00:00:00Z")
  private val user = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  /** Dashboard whose `layout` is EMPTY — reproduces the audit's exact repro: 3 panels created via
   *  "Add panel" and never dragged/resized, so `dashboard.layout` never got an entry written for
   *  any of them. */
  private val dashboardWithUndraggedPanels = Dashboard(
    id         = DashboardId(UUID.randomUUID().toString),
    name       = "SWEEP-undragged-panels",
    meta       = ResourceMeta(user.id.value, now, now),
    appearance = DashboardAppearance.Default,
    layout     = DashboardLayout.Default,
    ownerId    = user.id
  )

  /** Stub whose `findAllByDashboardId` always answers `total = realPanelCount`, ignoring its
   *  arguments — sufficient to prove `panelCountFor` reads `.total` rather than deriving from
   *  `layout`. */
  private def stubPanelRepo(realPanelCount: Int): PanelRepository =
    new PanelRepository(null) {
      override def findAllByDashboardId(
          dashboardId: DashboardId,
          callerOpt: Option[AuthenticatedUser],
          page: Page
      ): Future[PagedResult[Panel]] =
        Future.successful(PagedResult(Vector.empty[Panel], total = realPanelCount, offset = page.offset, limit = page.limit))
    }

  "toDashboardEntry" should {
    "report the real panel count from PanelRepository when panelRepoOpt is wired, even though layout is empty (F-004)" in {
      val service = new WorkspaceContextService(null, null, null, null, None, None, Some(stubPanelRepo(3)))

      val entry = await(service.toDashboardEntry(dashboardWithUndraggedPanels, user))

      entry.panelCount shouldBe 3
      entry.id shouldBe dashboardWithUndraggedPanels.id.value
      entry.name shouldBe dashboardWithUndraggedPanels.name
    }

    "report 0 from PanelRepository, not merely from an empty layout, when the dashboard truly has no panels" in {
      val service = new WorkspaceContextService(null, null, null, null, None, None, Some(stubPanelRepo(0)))

      await(service.toDashboardEntry(dashboardWithUndraggedPanels, user)).panelCount shouldBe 0
    }

    "fall back to the legacy layout-derived heuristic when panelRepoOpt is not wired (pre-fix fixture compatibility)" in {
      val service = new WorkspaceContextService(null, null, null, null)

      await(service.toDashboardEntry(dashboardWithUndraggedPanels, user)).panelCount shouldBe 0
    }
  }
}
