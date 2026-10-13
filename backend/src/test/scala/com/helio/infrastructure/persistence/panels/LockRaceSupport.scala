package com.helio.infrastructure.persistence.panels

import com.helio.infrastructure.persistence.DbContext
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import org.postgresql.util.PSQLException
import slick.jdbc.JdbcBackend

import java.sql.Connection
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Shared harness for the panel-lock-order race specs (HEL-1485 / HEL-1498): the pools, the observed-lock-wait
 *  interleave driver and the strict SQLSTATE reader. Built on [[LayoutStripDbSupport]] (a NOSUPERUSER /
 *  NOBYPASSRLS app role, so RLS and FORCE RLS apply exactly as in production).
 *
 *  Interleave model (`gateRace`): a "gate" session stands in for the already-correct dashboard delete paused
 *  after it locked the LOWEST panel id (the HEL-1485 order, panel rows by id). The writer under test starts and is
 *  observed blocked on a lock; only then does the gate run the real `DELETE FROM dashboards`, whose FK cascade
 *  wants every other panel. A writer that took a higher panel id first forms the 40P01 cycle; a writer that locks
 *  in id order simply waits and then skips the rows the gate deleted. The interleave is driven by observed lock
 *  waits, never sleeps. */
trait LockRaceSupport extends LayoutStripDbSupport {

  protected implicit val raceEc: ExecutionContext = ExecutionContext.global

  /** `appName` tags the pool's connections (`pg_stat_activity.application_name`), so one racer's lock wait can be
   *  told apart from another's (`awaitLockWaitOf`). */
  protected def racePool(initSql: Option[String], appName: Option[String] = None): JdbcBackend.Database = {
    val cfg = new HikariConfig()
    cfg.setJdbcUrl(pg.getJdbcUrl(AppRole, "postgres") + "&stringtype=unspecified" + appName.fold("")(n => s"&ApplicationName=$n"))
    cfg.setUsername(AppRole)
    cfg.setPassword("test")
    cfg.setMaximumPoolSize(3)
    initSql.foreach(cfg.setConnectionInitSql)
    JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(3))
  }

  /** The production shape: an app pool (RLS applies) and a `SET ROLE helio_privileged` pool (BYPASSRLS). */
  protected def raceDbContext(app: JdbcBackend.Database, priv: JdbcBackend.Database): DbContext = new DbContext(app, priv)

  protected def backendPid(c: Connection): Int = rows(c, "SELECT pg_backend_pid()")(_.getInt(1)).head

  private def waitingOnLock(su: Connection, excludePid: Int): Boolean =
    rows(su, s"""SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres' AND wait_event_type = 'Lock'
                |AND pid <> $excludePid AND pid <> pg_backend_pid()""".stripMargin)(_.getInt(1)).head > 0

  /** Blocks until some session other than `excludePid` is waiting on a lock. */
  protected def awaitLockWait(excludePid: Int, side: Future[Any]): Unit = {
    val su       = superConn()
    val deadline = System.nanoTime() + 20.seconds.toNanos
    try while (!waitingOnLock(su, excludePid)) {
        require(System.nanoTime() < deadline, s"no session ever waited on a lock: the interleave did not form (writer: ${side.value})")
        Thread.sleep(20)
      }
    finally su.close()
  }

  /** Blocks until a session whose `application_name` starts with `appNamePrefix` is waiting on a lock: per-racer
   *  detection, so a third session's wait is never mistaken for this racer's. */
  protected def awaitLockWaitOf(appNamePrefix: String, side: Future[Any]): Unit = {
    val su       = superConn()
    val deadline = System.nanoTime() + 20.seconds.toNanos
    def waiting  = rows(su, s"""SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres' AND wait_event_type = 'Lock'
                               |AND application_name LIKE '$appNamePrefix%'""".stripMargin)(_.getInt(1)).head > 0
    try while (!waiting) {
        require(System.nanoTime() < deadline, s"racer '$appNamePrefix' never waited on a lock: the interleave did not form (${side.value})")
        Thread.sleep(20)
      }
    finally su.close()
  }

  /** The SQLSTATE of a failed future, `None` if it succeeded. Anything that is not a `PSQLException` is a
   *  harness or product defect and is rethrown, never read as "no deadlock". */
  protected def sqlState(f: Future[_]): Option[String] =
    sqlStateAllowing(f)(_ => false)

  /** As [[sqlState]], but a non-PSQL failure for which `allowed` holds counts as a clean (`None`) outcome. */
  protected def sqlStateAllowing(f: Future[_])(allowed: Throwable => Boolean): Option[String] =
    Try(Await.result(f, 30.seconds)) match {
      case Success(_)                              => None
      case Failure(e: PSQLException)               => Some(e.getSQLState)
      case Failure(e) if allowed(e)                => None
      case Failure(e)                              => throw e
    }

  /** Seeds `dashboardId` (owned by `owner`, valid appearance) with the given panels INSERTED IN THE GIVEN ORDER
   *  (heap/scan order), optionally bound to `outputId`. */
  protected def seedDashboardWithPanels(owner: String, dashboardId: String, panelsInInsertOrder: Seq[String], outputId: Option[String] = None): Unit = {
    val su = superConn()
    try {
      seedDashboard(su, dashboardId, owner, layout(panelsInInsertOrder))
      // Row decoding (replaceContents, teardown) cannot read the shared fixture's '{}' appearance.
      exec(su, s"UPDATE dashboards SET appearance = '{\"background\":\"transparent\",\"gridBackground\":\"transparent\"}'::jsonb WHERE id = '$dashboardId'")
      panelsInInsertOrder.foreach { p =>
        seedPanel(su, p, dashboardId, owner, outputId)
        exec(su, s"UPDATE panels SET appearance = '{\"background\":\"transparent\",\"color\":\"inherit\",\"transparency\":0.0}'::jsonb WHERE id = '$p'")
      }
    } finally su.close()
  }

  /** Two panel ids with `lo < hi` in the byte order Postgres sorts text by. */
  protected def twoPanelIds(): (String, String) = {
    val Seq(a, b) = Seq(newId(), newId()).sorted
    (a, b)
  }

  protected def exists(table: String, id: String): Boolean = {
    val su = superConn()
    try rows(su, s"SELECT 1 FROM $table WHERE id = '$id'")(_.getInt(1)).nonEmpty finally su.close()
  }

  /** Gate holds `lowPanel` (`FOR UPDATE`, as `gateUser`), the writer starts and is observed blocked, then the gate
   *  deletes `dashboardId` and commits. Returns `(gateState, writerState)`; `writerState` reads the writer's
   *  failure through `writerAllowed` (default: only a PSQLException is a failure). */
  protected def gateRace(gateUser: String, lowPanel: String, dashboardId: String)(writer: => Future[Any])(
      writerAllowed: Throwable => Boolean = _ => false
  ): (Option[String], Option[String]) = {
    val gate = appConn(gateUser)
    try {
      gate.setAutoCommit(false)
      val gatePid = backendPid(gate)
      exec(gate, s"SELECT id FROM panels WHERE id = '$lowPanel' FOR UPDATE")
      val writerSide = writer
      awaitLockWait(gatePid, writerSide)
      val gateDelete = Future(exec(gate, s"DELETE FROM dashboards WHERE id = '$dashboardId'"))
      val gateState  = sqlState(gateDelete)
      if (Try(gate.commit()).isFailure) Try(gate.rollback())
      (gateState, sqlStateAllowing(writerSide)(writerAllowed))
    } finally gate.close()
  }

  protected def seedTwoRootPipeline(owner: String, tag: Option[String] = None): TwoRootPipeline = {
    val (pl, root1, root2, src1, src2) = (newId(), newId(), newId(), newId(), newId())
    val su = superConn()
    try {
      Seq(src1, src2).foreach(s =>
        exec(su, s"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                    |VALUES ('$s', 's-$s', 'dataset', '{}'::jsonb, '$owner'::uuid, now(), now())""".stripMargin))
      exec(su, s"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at, tag) VALUES ('$pl', 'p', '$owner'::uuid, now(), now(), ${tag.fold("NULL")(t => s"'$t'")})")
      exec(su, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('$root1', '$pl', '$src1', 0), ('$root2', '$pl', '$src2', 1)")
    } finally su.close()
    TwoRootPipeline(pl, root1, root2, src1, src2)
  }

  /** An Output attached to a root (`stepId` None) or to a step; returns its id. */
  protected def seedOutput(owner: String, pipelineId: String, rootId: Option[String], stepId: Option[String]): String = {
    val out = newId()
    val su  = superConn()
    try exec(su, s"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, schema, position, created_at, updated_at, root_id)
                    |VALUES ('$out', '$pipelineId', ${stepId.fold("NULL")(s => s"'$s'")}, '$owner'::uuid, 'o', 'table', '{}'::jsonb, '[]'::jsonb, 0, now(), now(),
                    |        ${rootId.fold("NULL")(r => s"'$r'")})""".stripMargin)
    finally su.close()
    out
  }

  /** A root-level step on `rootId`; returns its id. */
  protected def seedRootStep(pipelineId: String, rootId: String): String = {
    val id = newId()
    val su = superConn()
    try exec(su, s"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
                    |VALUES ('$id', '$pipelineId', 0, 'filter', '{}'::jsonb, true, now(), now(), NULL, '$rootId')""".stripMargin)
    finally su.close()
    id
  }

  protected final case class TwoRootPipeline(pipelineId: String, root1: String, root2: String, source1: String, source2: String)
}
