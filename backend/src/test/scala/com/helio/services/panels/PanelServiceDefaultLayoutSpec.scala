package com.helio.services.panels

import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.domain.model._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, verify, never, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-909 CR1 (decision-15, epic spec
 *  `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`
 *  lines 44/140/224): `POST /api/panels` must compute a server-owned default
 *  grid size from the referenced Output's `kind` and persist it to
 *  `dashboards.layout` — the evaluator's cycle-1 finding was that this never
 *  happened at all (`GET /api/dashboards/:id/panels` returned no `layout`,
 *  and `dashboards.layout` stayed `{"lg":[],...}`).
 *
 *  Mocked-repository style, mirroring `PanelServiceBatchUpdateErrorSpec` —
 *  exercises the SIZE `PanelService.create` hands the repository (decision-15 for an Output, the
 *  content default for everything else, HEL-1260) without a real database. The mocked
 *  `insertPlaced` applies the real [[CreatePlacement]] to the seeded dashboard layout, standing in
 *  for the atomic repository write that `PanelCreatePlacementSpec` proves end to end. */
class PanelServiceDefaultLayoutSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now       = Instant.parse("2026-01-01T00:00:00Z")
  private val ownerId   = UserId(UUID.randomUUID().toString)
  private val user      = AuthenticatedUser(ownerId)
  private val dashboardId = DashboardId(UUID.randomUUID().toString)

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  private def emptyDashboard(): Dashboard =
    Dashboard(
      id     = dashboardId,
      name   = "Dash",
      meta   = ResourceMeta(ownerId.value, now, now),
      appearance = DashboardAppearance.Default,
      layout = DashboardLayout(lg = Vector.empty, md = Vector.empty, sm = Vector.empty, xs = Vector.empty),
      ownerId = ownerId
    )

  /** A dashboard whose md/sm/xs layouts are DISTINCT from each other and
   *  from `lg` (HEL-909 CR1 cycle-2 regression fixture, evaluation-2.md
   *  finding 1) — pre-existing, independently-customized per-breakpoint
   *  arrangements that a new Output placement must survive untouched. */
  private def dashboardWithDistinctLayouts(): Dashboard = {
    val existingPanelId = PanelId(UUID.randomUUID().toString)
    emptyDashboard().copy(
      layout = DashboardLayout(
        lg = Vector(DashboardLayoutItem(existingPanelId, x = 8, y = 0, w = 4, h = 5)),
        md = Vector(DashboardLayoutItem(existingPanelId, x = 3, y = 1, w = 7, h = 9)),
        sm = Vector(DashboardLayoutItem(existingPanelId, x = 1, y = 2, w = 5, h = 3)),
        xs = Vector(DashboardLayoutItem(existingPanelId, x = 0, y = 0, w = 2, h = 7))
      )
    )
  }

  /** Wires one `create` call. `panelRepo.insertPlaced` applies [[CreatePlacement]] to `dashboard`'s
   *  layout and records the layout it would have stored. */
  private def buildServiceWithDashboard(output: Output, dashboard: Dashboard): (PanelService, AtomicReference[DashboardLayout]) = {
    val panelRepo     = mock(classOf[PanelRepository])
    val dashboardRepo = mock(classOf[DashboardRepository])
    val outputRepo    = mock(classOf[OutputRepository])
    val stored        = new AtomicReference[DashboardLayout]()

    when(panelRepo.insertPlaced(any(), any())).thenAnswer { inv =>
      val panel = inv.getArgument[Panel](0)
      val (next, placed) = CreatePlacement.append(dashboard.layout, Vector(panel.id -> inv.getArgument[PlacementSizes](1)))
      stored.set(next)
      Future.successful(Option(placed.head))
    }
    when(outputRepo.findByIdOwned(output.id, user)).thenReturn(Future.successful(Some(output)))
    when(outputRepo.findByIdInternal(output.id)).thenReturn(Future.successful(Some(output)))

    val service = new PanelService(panelRepo, stubAccess, dashboardRepo, auditService = null, outputRepo = outputRepo)
    (service, stored)
  }

  private def outputOf(kind: OutputKind): Output =
    Output(
      id      = OutputId(UUID.randomUUID().toString),
      name    = "Out",
      ownerId = ownerId,
      node    = NodeRef(PipelineId(UUID.randomUUID().toString), None),
      kind    = kind,
      createdAt = now,
      updatedAt = now
    )

  private def buildService(output: Output): (PanelService, AtomicReference[DashboardLayout]) =
    buildServiceWithDashboard(output, emptyDashboard())

  private def createRequest(output: Output): CreatePanelRequest =
    CreatePanelRequest(
      dashboardId = Some(dashboardId.value),
      title       = None,
      `type`      = Some("output"),
      config      = Some(JsObject("outputId" -> JsString(output.id.value)))
    )

  "PanelService.create" should {
    "place a metric Output at the decision-15 default 3x2" in {
      val output = outputOf(OutputKind.Metric)
      val (service, stored) = buildService(output)
      val (_, layout) = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))
      layout.lg.w shouldBe 3
      layout.lg.h shouldBe 2
      stored.get.lg should have size 1
      stored.get.lg.head.w shouldBe 3
      stored.get.lg.head.h shouldBe 2
    }

    "place a chart Output at the decision-15 default 6x4" in {
      val output = outputOf(OutputKind.Chart)
      val (service, _) = buildService(output)
      val (_, layout) = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))
      (layout.lg.w, layout.lg.h) shouldBe (6, 4)
    }

    "place a table Output at the decision-15 default 6x6" in {
      val output = outputOf(OutputKind.Table)
      val (service, _) = buildService(output)
      val (_, layout) = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))
      (layout.lg.w, layout.lg.h) shouldBe (6, 6)
    }

    "place a collection Output at the decision-15 default 6x4" in {
      val output = outputOf(OutputKind.Collection)
      val (service, _) = buildService(output)
      val (_, layout) = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))
      (layout.lg.w, layout.lg.h) shouldBe (6, 4)
    }

    "place a timeline Output at the decision-15 default 4x6" in {
      val output = outputOf(OutputKind.Timeline)
      val (service, _) = buildService(output)
      val (_, layout) = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))
      (layout.lg.w, layout.lg.h) shouldBe (4, 6)
    }

    "place a markdown Output at the decision-15 default 4x4" in {
      val output = outputOf(OutputKind.Markdown)
      val (service, _) = buildService(output)
      val (_, layout) = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))
      (layout.lg.w, layout.lg.h) shouldBe (4, 4)
    }

    "preserve each breakpoint's existing layout and append a correctly-scaled item (HEL-909 CR1 cycle-2)" in {
      val output               = outputOf(OutputKind.Chart) // decision-15 default 6x4 at lg
      val seededDashboard       = dashboardWithDistinctLayouts()
      val (service, stored)     = buildServiceWithDashboard(output, seededDashboard)
      val (_, layout)           = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))
      (layout.lg.w, layout.lg.h) shouldBe (6, 4)

      val persisted = stored.get

      // (a) the pre-existing md/sm/xs items must be UNCHANGED, not
      // overwritten by lg's array (the pre-fix bug: `md = nextLayout` where
      // `nextLayout` was built from `lg` alone).
      persisted.md.head shouldBe seededDashboard.layout.md.head
      persisted.sm.head shouldBe seededDashboard.layout.sm.head
      persisted.xs.head shouldBe seededDashboard.layout.xs.head

      // Each breakpoint keeps its own ORIGINAL item count plus exactly one
      // newly-appended item — proves append, not replace.
      persisted.lg should have size (seededDashboard.layout.lg.size + 1)
      persisted.md should have size (seededDashboard.layout.md.size + 1)
      persisted.sm should have size (seededDashboard.layout.sm.size + 1)
      persisted.xs should have size (seededDashboard.layout.xs.size + 1)

      // (b) the appended item is scaled per breakpoint's own column count
      // (lg 12 / md 10 / sm 6 / xs 2), not the raw lg w/x copied verbatim.
      val lgItem = persisted.lg.last
      lgItem.w shouldBe 6
      lgItem.x shouldBe 0

      val mdItem = persisted.md.last
      mdItem.w shouldBe 5 // round(6 * 10/12)
      mdItem.x shouldBe 0
      mdItem.w should not be lgItem.w

      val smItem = persisted.sm.last
      smItem.w shouldBe 3 // round(6 * 6/12)
      smItem.x shouldBe 0
      smItem.w should not be lgItem.w

      val xsItem = persisted.xs.last
      xsItem.w shouldBe 1 // round(6 * 2/12), clamped to >= 1 and to the 2-col grid
      xsItem.w should be <= 2
      xsItem.x shouldBe 0
      xsItem.w should not be lgItem.w
    }

    "start each breakpoint below THAT breakpoint's own bottom, so md extending below lg and a stored-bad xs never overlap or block (HEL-1071)" in {
      val output = outputOf(OutputKind.Chart)
      val a      = PanelId(UUID.randomUUID().toString)
      val b      = PanelId(UUID.randomUUID().toString)
      val seeded = emptyDashboard().copy(
        layout = DashboardLayout(
          lg = Vector(DashboardLayoutItem(a, 0, 0, 6, 2)),
          md = Vector(DashboardLayoutItem(a, 0, 0, 5, 9)), // md reaches y=9, lg only y=2
          sm = Vector.empty,
          xs = Vector(DashboardLayoutItem(a, 0, 0, 2, 3), DashboardLayoutItem(b, 0, 0, 2, 3)) // stored-bad (same cell)
        )
      )
      val (service, stored) = buildServiceWithDashboard(output, seeded)
      val (_, placed)       = await(service.create(createRequest(output), user)).getOrElse(fail("create failed"))

      val persisted = stored.get
      persisted.lg.last.y shouldBe 2
      persisted.md.last.y shouldBe 9
      persisted.sm.last.y shouldBe 0
      persisted.xs.last.y shouldBe 3
      (placed.lg.y, placed.md.y, placed.sm.y, placed.xs.y) shouldBe ((2, 9, 0, 3))
      // The appended item never overlaps anything already in its own breakpoint.
      def newItemClear(items: Vector[DashboardLayoutItem]): Boolean =
        items.init.forall(o => !LayoutValidator.rectsOverlap(LayoutValidator.toRect(o), LayoutValidator.toRect(items.last)))
      List(persisted.lg, persisted.md, persisted.sm, persisted.xs).foreach(items => newItemClear(items) shouldBe true)
    }

    "place a non-Output panel at the content default size per breakpoint (HEL-1260)" in {
      val panelRepo     = mock(classOf[PanelRepository])
      val dashboardRepo = mock(classOf[DashboardRepository])
      when(panelRepo.insertPlaced(any(), any())).thenAnswer { inv =>
        val panel = inv.getArgument[Panel](0)
        Future.successful(Option(CreatePlacement.append(emptyDashboard().layout, Vector(panel.id -> inv.getArgument[PlacementSizes](1)))._2.head))
      }
      val service = new PanelService(panelRepo, stubAccess, dashboardRepo, auditService = null, outputRepo = null)
      val request = CreatePanelRequest(Some(dashboardId.value), None, Some("divider"), None)
      val (_, layout) = await(service.create(request, user)).getOrElse(fail("create failed"))
      (layout.lg.w, layout.md.w, layout.sm.w, layout.xs.w) shouldBe ((4, 4, 3, 2))
      List(layout.lg.h, layout.md.h, layout.sm.h, layout.xs.h) shouldBe List(5, 5, 5, 5)
      verify(dashboardRepo, never()).update(any())
    }

    "answer 404 and place nothing when the repository could not see the dashboard" in {
      val panelRepo = mock(classOf[PanelRepository])
      when(panelRepo.insertPlaced(any(), any())).thenReturn(Future.successful(None))
      val service = new PanelService(panelRepo, stubAccess, mock(classOf[DashboardRepository]), auditService = null, outputRepo = null)
      val request = CreatePanelRequest(Some(dashboardId.value), None, Some("divider"), None)
      await(service.create(request, user)) shouldBe Left(ServiceError.NotFound("Dashboard not found"))
    }
  }
}
