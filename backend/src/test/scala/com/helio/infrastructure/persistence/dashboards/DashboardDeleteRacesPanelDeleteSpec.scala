package com.helio.infrastructure.persistence.dashboards

import com.helio.domain.model.{AuthenticatedUser, DashboardId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.panels.LayoutStripDbSupport
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import org.postgresql.util.PSQLException
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.sql.Connection
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
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
class DashboardDeleteRacesPanelDeleteSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LayoutStripDbSupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global
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
    appDb      = pool(None)
    privDb     = pool(Some("SET ROLE helio_privileged"))
    val dbCtx  = new DbContext(appDb, privDb)
    dashboards = new DashboardRepository(dbCtx)
    teardown   = new WorkspaceTeardownRepository(dbCtx)
  }

  override def afterAll(): Unit = {
    Try(appDb.close()); Try(privDb.close()); pg.close(); super.afterAll()
  }

  private def pool(initSql: Option[String]): JdbcBackend.Database = {
    val cfg = new HikariConfig()
    cfg.setJdbcUrl(pg.getJdbcUrl(AppRole, "postgres") + "&stringtype=unspecified")
    cfg.setUsername(AppRole)
    cfg.setPassword("test")
    cfg.setMaximumPoolSize(3)
    initSql.foreach(cfg.setConnectionInitSql)
    JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(3))
  }

  private def backendPid(c: Connection): Int = rows(c, "SELECT pg_backend_pid()")(_.getInt(1)).head

  private def waitingOnLock(su: Connection, excludePid: Int): Boolean =
    rows(su, s"""SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres' AND wait_event_type = 'Lock'
                |AND pid <> $excludePid AND pid <> pg_backend_pid()""".stripMargin)(_.getInt(1)).head > 0

  private def awaitLockWait(excludePid: Int, side: Future[Any]): Unit = {
    val su       = superConn()
    val deadline = System.nanoTime() + 20.seconds.toNanos
    try while (!waitingOnLock(su, excludePid)) {
        require(System.nanoTime() < deadline, s"no session ever waited on a lock: the interleave did not form (dashboard side: ${side.value})")
        Thread.sleep(20)
      }
    finally su.close()
  }

  private def sqlState(f: Future[_]): Option[String] =
    Try(Await.result(f, 30.seconds)).failed.toOption.collect { case e: PSQLException => e.getSQLState }

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

  private def exists(table: String, id: String): Boolean = {
    val su = superConn()
    try rows(su, s"SELECT 1 FROM $table WHERE id = '$id'")(_.getInt(1)).nonEmpty finally su.close()
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
      withClue(s"panel side=$panelState dashboard side=$dashboardState: ") {
        (panelState ++ dashboardState).toSet should not contain "40P01"
      }
      exists("dashboards", d) shouldBe false
      exists("panels", p) shouldBe false
    }

    "complete on both sides with no 40P01 (WorkspaceTeardownRepository.teardown)" in {
      val tag    = s"t-${newId()}"
      val (d, p) = seedPanelsDashboard(Some(tag))
      val user   = AuthenticatedUser(UserId(owner))
      val (panelState, teardownState) = race(p, teardown.teardown(tag, dryRun = false, user))
      withClue(s"panel side=$panelState teardown side=$teardownState: ") {
        (panelState ++ teardownState).toSet should not contain "40P01"
      }
      exists("dashboards", d) shouldBe false
      exists("panels", p) shouldBe false
    }
  }
}
