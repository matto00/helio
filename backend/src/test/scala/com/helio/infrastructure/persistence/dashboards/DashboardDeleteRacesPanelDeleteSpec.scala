package com.helio.infrastructure.persistence.dashboards

import com.helio.domain.model.{AuthenticatedUser, DashboardId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.panels.LockRaceSupport
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import scala.concurrent.Future
import scala.util.Try

/** HEL-1485 item 2: a dashboard delete racing a delete of one of its panels. These specs prove the lock cycle
 *  CAN form (and that it is closed), not how often it occurs in production.
 *
 *  Roles: the panel-deleting side is a raw session as the NOSUPERUSER / NOBYPASSRLS schema owner with the RLS
 *  user GUC set (the app pool's shape). The dashboard-deleting side runs the real production repository code:
 *  `DashboardRepository.delete` on a pool that `SET ROLE`s `helio_privileged` (a NOLOGIN BYPASSRLS role in this
 *  fixture, reachable by SET ROLE exactly as the production privileged pool reaches it), and
 *  `WorkspaceTeardownRepository.teardown` on the app pool under the owner's RLS context.
 *
 *  Modelling: one DELETE of panel P takes P's row lock and then (V122 trigger, end of statement) wants the
 *  dashboard row. Landing a dashboard delete exactly between those two instants is a microsecond window, so the
 *  panel side holds P with `SELECT ... FOR UPDATE` first (the lock the DELETE would hold), the dashboard delete
 *  is started and observed waiting on a lock, and only then the real `DELETE FROM panels` fires the real V122
 *  trigger. The interleave is driven by observed lock waits, never sleeps. */
class DashboardDeleteRacesPanelDeleteSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LockRaceSupport {

  private val owner                         = newId()
  private var appDb: JdbcBackend.Database   = _
  private var privDb: JdbcBackend.Database  = _
  private var dashboards: DashboardRepository = _
  private var teardown: WorkspaceTeardownRepository = _

  override def beforeAll(): Unit = {
    startPostgres()
    flyway(None).migrate()
    val su = superConn()
    try seedUser(su, owner) finally su.close()
    appDb      = racePool(None)
    privDb     = racePool(Some("SET ROLE helio_privileged"))
    val dbCtx  = new DbContext(appDb, privDb)
    dashboards = new DashboardRepository(dbCtx)
    teardown   = new WorkspaceTeardownRepository(dbCtx)
  }

  override def afterAll(): Unit = {
    Try(appDb.close()); Try(privDb.close()); pg.close(); super.afterAll()
  }

  private def seedPanelsDashboard(tag: Option[String] = None): (String, String) = {
    val (d, p) = (newId(), newId())
    val su     = superConn()
    try {
      seedDashboard(su, d, owner, layout(Vector(p)))
      seedPanel(su, p, d, owner)
      // The teardown path decodes the row into the domain model, which '{}' (the shared fixture default) cannot satisfy.
      exec(su, s"UPDATE dashboards SET appearance = '{\"background\":\"transparent\",\"gridBackground\":\"transparent\"}'::jsonb WHERE id = '$d'")
      tag.foreach(t => exec(su, s"UPDATE dashboards SET tag = '$t' WHERE id = '$d'"))
    } finally su.close()
    (d, p)
  }

  /** Holds P's row lock, starts `dashboardDelete`, waits until it is blocked, then issues the real panel DELETE. */
  private def race(panel: String, dashboardDelete: => Future[Any]): (Option[String], Option[String]) = {
    val panelSide = appConn(owner)
    try {
      panelSide.setAutoCommit(false)
      val panelPid = backendPid(panelSide)
      exec(panelSide, s"SELECT id FROM panels WHERE id = '$panel' FOR UPDATE")
      val dashboardSide = dashboardDelete
      awaitLockWait(panelPid, dashboardSide)
      val panelDelete = Future(exec(panelSide, s"DELETE FROM panels WHERE id = '$panel'"))
      val panelState  = sqlState(panelDelete)
      if (Try(panelSide.commit()).isFailure) Try(panelSide.rollback())
      (panelState, sqlState(dashboardSide))
    } finally panelSide.close()
  }

  "a dashboard delete racing a delete of one of its panels" should {
    "complete on both sides with no 40P01 (DashboardRepository.delete)" in {
      val (d, p) = seedPanelsDashboard()
      val (panelState, dashboardState) = race(p, dashboards.delete(DashboardId(d)))
      (panelState, dashboardState) shouldBe ((None, None))
      exists("dashboards", d) shouldBe false
      exists("panels", p) shouldBe false
    }

    "complete on both sides with no 40P01 (WorkspaceTeardownRepository.teardown)" in {
      val tag    = s"t-${newId()}"
      val (d, p) = seedPanelsDashboard(Some(tag))
      val user   = AuthenticatedUser(UserId(owner))
      val (panelState, teardownState) = race(p, teardown.teardown(tag, dryRun = false, user))
      (panelState, teardownState) shouldBe ((None, None))
      exists("dashboards", d) shouldBe false
      exists("panels", p) shouldBe false
    }
  }
}
