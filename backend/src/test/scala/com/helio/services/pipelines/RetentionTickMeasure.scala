package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model._
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, OutputHistoryRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.audit.AuditService
import com.helio.spark.PipelineRunCache
import org.flywaydb.core.Flyway
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1477 measurement driver (NOT a spec; run by hand with `sbt "Test/runMain ...RetentionTickMeasure <mode> ..."`).
 *  Talks only to the literal JDBC URL it is given, which must be the local `hel1477` scratch database; reads no
 *  environment and no `.env`. Output lines start with `@@` and are committed raw under `evidence/` of the change.
 *
 *  Modes (url = jdbc:postgresql://127.0.0.1:55477/helio_hel1477_scratch):
 *   migrate <url>
 *   setup <url>                                              idempotent: one user, one static pipeline (no schedule)
 *   loop <url> <tag> <retention on|off> <tickMs> <ticks> <dueOffsetMs> <scheduleInterval e.g. 20s>
 *       drives the REAL PipelineSchedulerService exactly like PipelineSchedulerActor (next tick armed `tickMs` after
 *       the previous tick COMPLETES), with the real OutputHistoryRetentionService (instrumented subclass), on a clock
 *       that is the seed anchor plus real elapsed time. One interval schedule, first due `dueOffsetMs` after start. */
object RetentionTickMeasure {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T = Await.result(f, 6.hours)

  private val Scratch = "jdbc:postgresql://127.0.0.1:55477/helio_hel1477_scratch"
  private val OwnerId = "00000000-0000-4000-8000-000000001477"
  private val PipelineIdStr = "hel1477-pipe"

  private def open(url: String): JdbcBackend.Database =
    JdbcBackend.Database.forURL(s"$url?stringtype=unspecified", user = "postgres", driver = "org.postgresql.Driver", executor = AsyncExecutor("hel1477", 5, 5, 1000, 5))

  private val fileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]  = Future.successful(())
    def read(path: String): Future[Array[Byte]]                 = Future.successful("col\n1\n".getBytes("UTF-8"))
    def delete(path: String): Future[Unit]                      = Future.successful(())
    def exists(path: String): Future[Boolean]                   = Future.successful(true)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] =
      Future.successful(ListPage(Seq.empty, None))
  }

  def main(args: Array[String]): Unit = {
    require(args.length >= 2 && args(1) == Scratch, s"refusing: url must be exactly $Scratch")
    args(0) match {
      case "migrate" =>
        val r = Flyway.configure().dataSource(args(1), "postgres", "").locations("classpath:db/migration").load().migrate()
        println(s"@@RESULT migrations=${r.migrationsExecuted} success=${r.success} target=${r.targetSchemaVersion}")
      case "setup" => setup(args(1))
      case "loop"  => loop(args)
      case other   => sys.error(s"unknown mode $other")
    }
  }

  private def setup(url: String): Unit = {
    val db = open(url)
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($OwnerId::uuid, 'hel1477@perf.invalid', now()) ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ('hel1477-ds', 'ds', 'dataset', '{"columns":[],"rows":[]}', $OwnerId::uuid, now(), now()) ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($PipelineIdStr, 'pipe', $OwnerId::uuid, now(), now()) ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($PipelineIdStr, $PipelineIdStr, 'hel1477-ds', 0) ON CONFLICT DO NOTHING"""
    )))
    println("@@SETUP ok")
    db.close()
  }

  private def loop(args: Array[String]): Unit = {
    val Array(_, url, tag, retention, tickMsS, ticksS, dueS, interval) = args
    val (tickMs, ticks, dueMs) = (tickMsS.toLong, ticksS.toInt, dueS.toLong)
    val db     = open(url)
    val anchor = await(db.run(sql"SELECT (SELECT t FROM perf_anchor)".as[Timestamp].head)).toInstant
    val startEpoch = System.currentTimeMillis()
    def offsetMs(epoch: Long): Long = epoch - startEpoch
    val clock: Clock = new Clock { def now(): Instant = anchor.plusMillis(System.currentTimeMillis() - startEpoch) }

    val ctx            = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val stepRepo       = new PipelineStepRepository(ctx)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    val scheduleRepo   = new PipelineScheduleRepository(ctx)
    val runRepo        = new PipelineRunRepository(ctx)
    val runService = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null, fileSystem,
      auditService = new AuditService(new AuditEventRepository(ctx)), outputRepo = new OutputRepository(ctx)
    )
    // The real retention service with prod defaults; the subclass only timestamps each pass.
    val retentionService: OutputHistoryRetentionService =
      new OutputHistoryRetentionService(
        new OutputHistoryRepository(ctx), OutputHistoryRetentionConfig.fromEnv(Map.empty), clock,
        new NodePayloadHistoryRepository(ctx), PayloadHistoryConfig.Defaults
      ) {
        override def purgeIfDue(now: Instant): Future[Option[Int]] = {
          val t0 = System.currentTimeMillis()
          super.purgeIfDue(now).map { r =>
            val t1 = System.currentTimeMillis()
            // A skipped call (not due / guard busy) returns immediately; a started pass takes longer. Both are logged.
            println(s"@@PASS tag=$tag start_ms=${offsetMs(t0)} end_ms=${offsetMs(t1)} dur_ms=${t1 - t0} result=$r")
            r
          }
        }
      }
    val service = new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, stepRepo, runRepo, runService, clock,
      outputHistoryRetentionService = if (retention == "on") retentionService else null
    )

    // Replace any previous schedule: due `dueMs` after start.
    await(db.run(sqlu"DELETE FROM pipeline_runs WHERE pipeline_id = $PipelineIdStr"))
    await(db.run(sqlu"DELETE FROM pipeline_schedules WHERE pipeline_id = $PipelineIdStr"))
    val nowI = Instant.now()
    val sched = PipelineSchedule(
      PipelineScheduleId(UUID.randomUUID().toString), PipelineId(PipelineIdStr), ScheduleKind.Interval, interval, enabled = true,
      timezone = "UTC", nextRunAt = Some(anchor.plusMillis(dueMs)), lastRunAt = None, createdAt = nowI, updatedAt = nowI
    )
    await(scheduleRepo.upsert(sched, AuthenticatedUser(UserId(OwnerId))))
    println(s"@@LOOP tag=$tag retention=$retention tick_ms=$tickMs ticks=$ticks due_offset_ms=$dueMs interval=$interval anchor=$anchor")

    var lastRuns = 0
    for (i <- 1 to ticks) {
      val nextRun = await(db.run(sql"SELECT next_run_at FROM pipeline_schedules WHERE pipeline_id = $PipelineIdStr".as[Timestamp].head)).toInstant
      val dueOff  = nextRun.toEpochMilli - anchor.toEpochMilli // offset in "clock ms since start"
      val t0 = System.currentTimeMillis()
      await(service.tick())
      val t1 = System.currentTimeMillis()
      val runs = await(db.run(sql"SELECT count(*) FROM pipeline_runs WHERE pipeline_id = $PipelineIdStr".as[Int].head))
      val fired = runs > lastRuns; lastRuns = runs
      // fire_delay_ms: how late the fired schedule was relative to the instant it was due (tick start - due instant).
      val delay = if (fired) offsetMs(t0) - dueOff else -1L
      println(s"@@TICK tag=$tag n=$i start_ms=${offsetMs(t0)} end_ms=${offsetMs(t1)} dur_ms=${t1 - t0} due_ms=$dueOff fired=$fired fire_delay_ms=$delay runs=$runs")
      if (i < ticks) Thread.sleep(tickMs) // the actor's `scheduleOnce(tickInterval)` armed after TickCompleted
    }
    val runTimes = await(db.run(sql"SELECT extract(epoch from (completed_at - started_at)) * 1000 FROM pipeline_runs WHERE pipeline_id = $PipelineIdStr ORDER BY started_at".as[Double]))
    println(s"@@RUNDUR tag=$tag run_ms=${runTimes.map(d => f"$d%.1f").mkString(",")}")
    db.close()
  }
}
