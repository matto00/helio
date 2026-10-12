package com.helio.services.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.sql.{Connection, DriverManager}
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1511 4.3 -- the reaper is safe across instances (design.md D2, design-gate R2): a deterministic LOCK-WAIT proof,
 *  not a race. A second connection ("instance B") holds an UNCOMMITTED write to the run row; the reap starts, is
 *  observed blocked on B via `pg_blocking_pids`, then B commits and the reap must re-evaluate its WHERE and skip the
 *  row. (i) B refreshed the heartbeat: the run must NOT be reaped. (ii) B reaped it first: the second reap must report
 *  nothing, so exactly one reaper finalizes the run. A SELECT-then-UPDATE-by-id reap (no predicate re-check) fails both. */
class RunReaperConcurrencySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var runRepo: PipelineRunRepository     = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    runRepo = new PipelineRunRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private def conn(autoCommit: Boolean): Connection = {
    val c = DriverManager.getConnection(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
    c.setAutoCommit(autoCommit)
    c
  }

  private def scalar(sql: String): String = {
    val c = conn(autoCommit = true)
    try { val rs = c.createStatement().executeQuery(sql); rs.next(); rs.getString(1) } finally c.close()
  }

  /** A stale run: started 2 h ago, last heartbeat 20 minutes ago (bound 600 s). */
  private def seedStaleRun(): String = {
    import PostgresProfile.api._
    val ownerId = UUID.randomUUID().toString
    val pid     = UUID.randomUUID().toString
    val runId   = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"$ownerId@test.local"}, now())""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source, heartbeat_at)
             VALUES ($runId, $pid, 'queued', now() - interval '2 hours', NULL, 'manual', now() - interval '20 minutes')"""
    )))
    runId
  }

  private def reap(): Future[Int] =
    runRepo.reapStaleRunsInternal(Instant.now().truncatedTo(ChronoUnit.MILLIS), 600L, 3600L, PipelineRunService.EmptyTruncationJson).map(_.size)

  /** Non-vacuity: a bounded wait-for-condition (not a timing assumption) until some backend OTHER than `holderPid` is blocked by it. */
  private def awaitBlockedBy(holderPid: Int): Unit = {
    val deadline = System.nanoTime() + 15.seconds.toNanos
    var blocked  = false
    while (!blocked && System.nanoTime() < deadline) {
      blocked = scalar(s"SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND $holderPid = ANY(pg_blocking_pids(pid))").toInt > 0
      if (!blocked) Thread.sleep(25)
    }
    withClue(s"no reaper backend ever blocked on pid $holderPid -- the case would be vacuous: ") { blocked shouldBe true }
  }

  private def pidOf(c: Connection): Int = {
    val rs = c.createStatement().executeQuery("SELECT pg_backend_pid()"); rs.next(); rs.getInt(1)
  }

  "the reap statement under a concurrent writer (HEL-1511 4.3)" should {

    "not reap a run whose heartbeat another instance refreshed (uncommitted) while the reap waited on it" in {
      val runId = seedStaleRun()
      val b = conn(autoCommit = false)
      try {
        b.createStatement().execute(s"UPDATE pipeline_runs SET heartbeat_at = now() WHERE id = '$runId'")
        val reaping = reap()
        awaitBlockedBy(pidOf(b))
        b.commit()
        await(reaping) shouldBe 0
        scalar(s"SELECT status FROM pipeline_runs WHERE id = '$runId'") shouldBe "queued"
        scalar(s"SELECT (completed_at IS NULL)::text FROM pipeline_runs WHERE id = '$runId'") shouldBe "true"
      } finally b.close()
    }

    "finalize a run exactly once when another instance's reap (uncommitted) is ahead of this one" in {
      val runId = seedStaleRun()
      val b = conn(autoCommit = false)
      try {
        b.createStatement().execute(
          s"UPDATE pipeline_runs SET status = 'failed', completed_at = now(), error_log = 'reaped by instance B' WHERE id = '$runId' AND completed_at IS NULL")
        val reaping = reap()
        awaitBlockedBy(pidOf(b))
        b.commit()
        await(reaping) shouldBe 0
        scalar(s"SELECT error_log FROM pipeline_runs WHERE id = '$runId'") shouldBe "reaped by instance B"
      } finally b.close()
    }

    "reap a stale run when nothing else touches it (control: the blocked cases above are not vacuous)" in {
      val runId = seedStaleRun()
      await(reap()) should be >= 1
      scalar(s"SELECT status FROM pipeline_runs WHERE id = '$runId'") shouldBe "failed"
    }
  }
}
