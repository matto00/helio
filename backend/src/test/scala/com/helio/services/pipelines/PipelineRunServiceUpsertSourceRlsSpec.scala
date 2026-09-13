package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.testsupport.DatasetRowsTestSupport
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1100 evaluation-1.md CR2: a scheduler-fired run and an editor-grantee-triggered run must
 *  BOTH write an `upsertsource` target under RLS AS THE PIPELINE OWNER -- driven end to end
 *  through the real `PipelineSchedulerService.tick`/`PipelineRunService.submit` entry points,
 *  under a real NOBYPASSRLS role (the `RlsSharingAwareTablesSpec`/
 *  `DataSourceRepositoryApplyWriteBacksRlsSpec` two-role harness), not a superuser pool and not
 *  merely a read of `onRunSuccess`'s source. */
class PipelineRunServiceUpsertSourceRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var ctx: DbContext                     = _

  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var runRepo: PipelineRunRepository           = _
  private var scheduleRepo: PipelineScheduleRepository = _
  private var outputRepo: OutputRepository             = _
  private var runService: PipelineRunService           = _
  private var schedulerService: PipelineSchedulerService = _

  private val owner   = UserId(UUID.randomUUID().toString)
  private val grantee = UserId(UUID.randomUUID().toString)

  private class FakeClock(@volatile private var instant: Instant) extends Clock {
    def set(i: Instant): Unit   = instant = i
    override def now(): Instant = instant
  }
  private val fakeClock = new FakeClock(Instant.parse("2026-01-01T00:00:00Z"))

  import PostgresProfile.api._

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure().dataSource(superJdbc, "postgres", "postgres").locations("classpath:db/migration").load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx              = new DbContext(appDb, privilegedDb)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    runRepo          = new PipelineRunRepository(ctx)
    scheduleRepo     = new PipelineScheduleRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
    runService = new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, runRepo,
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      outputRepo = outputRepo, nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    )
    schedulerService = new PipelineSchedulerService(scheduleRepo, pipelineRepo, runRepo, runService, fakeClock)

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${owner.value + "@test.local"}, now()) ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${grantee.value}::uuid, ${grantee.value + "@test.local"}, now()) ON CONFLICT DO NOTHING"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def seedSourceDs(ownerId: UserId, rows: Vector[String]): String = {
    val dsId    = UUID.randomUUID().toString
    val payload = s"""{"columns":[{"name":"name","type":"string"}],"rows":${rows.map(v => s"""["$v"]""").mkString("[", ",", "]")}}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds-source', 'dataset', '{}', ${ownerId.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload)
    )))
    dsId
  }

  private def seedTargetDs(ownerId: UserId): String = {
    val dsId    = UUID.randomUUID().toString
    val payload = """{"columns":[{"name":"name","type":"string"}],"rows":[]}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds-target', 'dataset', '{}', ${ownerId.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload)
    )))
    dsId
  }

  private def seedPipelineWithUpsertStep(ownerId: UserId, sourceDsId: String, targetDsId: String): PipelineId = {
    val pid    = UUID.randomUUID().toString
    val stepId = UUID.randomUUID().toString
    val configJson = s"""{"target":{"kind":"existingSource","dataSourceId":"$targetDsId"},"mode":"append"}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'rls-pipe', ${ownerId.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $sourceDsId, 0)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
             VALUES ($stepId, $pid, 0, 'upsertsource', $configJson::text, now(), now(), $pid)"""
    )))
    PipelineId(pid)
  }

  private def targetRowCount(dsId: String): Int =
    await(ctx.withSystemContext(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $dsId".as[Int].head))

  private def grantEditor(pipelineId: PipelineId, granteeId: UserId): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', ${pipelineId.value}, ${granteeId.value}::uuid, 'editor', now())"""
    ))

  "a scheduler-fired run, under a real NOBYPASSRLS role" should {
    "write the upsertsource target under the pipeline OWNER's tenant" in {
      val sourceId = seedSourceDs(owner, Vector("carol"))
      val targetId = seedTargetDs(owner)
      val pid      = seedPipelineWithUpsertStep(owner, sourceId, targetId)

      val dueAt = fakeClock.now().minusSeconds(60)
      val schedule = PipelineSchedule(
        id = PipelineScheduleId(UUID.randomUUID().toString), pipelineId = pid,
        kind = ScheduleKind.Interval, expression = "30m", enabled = true, timezone = "UTC",
        nextRunAt = Some(dueAt), lastRunAt = None,
        createdAt = fakeClock.now(), updatedAt = fakeClock.now()
      )
      await(scheduleRepo.upsert(schedule, AuthenticatedUser(owner)))

      await(schedulerService.tick())

      // The GUC-scoped RLS write actually landed -- read back under the OWNER's own user
      // context (not the privileged pool) as an additional confirmation that this row is
      // visible under the owner's RLS scope, not merely present via the privileged read.
      targetRowCount(targetId) shouldBe 1
      val visibleUnderOwner = await(ctx.withUserContext(owner.value)(
        sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $targetId".as[Int].head
      ))
      visibleUnderOwner shouldBe 1
    }
  }

  "an editor-grantee-triggered run, under a real NOBYPASSRLS role" should {
    "write the upsertsource target under the pipeline OWNER's tenant, not the grantee's" in {
      val sourceId = seedSourceDs(owner, Vector("dave"))
      val targetId = seedTargetDs(owner)
      val pid      = seedPipelineWithUpsertStep(owner, sourceId, targetId)
      grantEditor(pid, grantee)

      val result = await(runService.submit(pid, isDry = false, AuthenticatedUser(grantee)))
      result shouldBe a[Right[_, _]]

      targetRowCount(targetId) shouldBe 1
      // The write is visible under the OWNER's RLS context...
      val visibleUnderOwner = await(ctx.withUserContext(owner.value)(
        sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $targetId".as[Int].head
      ))
      visibleUnderOwner shouldBe 1
      // ...never under the grantee's own RLS context (FORCE RLS on dataset_rows is owner-only,
      // per V106 -- a sharing grant on the PIPELINE confers no visibility onto the TARGET
      // dataset's rows).
      val visibleUnderGrantee = await(ctx.withUserContext(grantee.value)(
        sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $targetId".as[Int].head
      ))
      visibleUnderGrantee shouldBe 0
    }
  }
}
