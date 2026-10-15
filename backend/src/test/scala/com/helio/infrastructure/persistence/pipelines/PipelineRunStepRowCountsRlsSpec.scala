package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineRunId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.OutputHistoryFixtures
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1579 (design.md D9, constraint C8): the per-step row-count columns (`pipeline_runs.step_row_counts`,
 *  `pipelines.last_run_step_row_counts`) are written and read through the REAL repositories on a non-BYPASSRLS pool
 *  (`helio_app_test`; a superuser-run assertion would pass vacuously because it bypasses every policy). Covers the
 *  owner run path (`updateRunTerminal` / `updateLastRun`, RLS-enforced), the editor-grantee path (the `*Internal`
 *  variants), a non-owner/non-grantee reading nothing, and a later failed write clearing the counts. */
class PipelineRunStepRowCountsRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var ctx: DbContext                     = _
  private var runRepo: PipelineRunRepository     = _
  private var pipelineRepo: PipelineRepository   = _

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private var owner, editor, stranger: String = _

  private val counts = """{"s1":10,"s2":4}"""

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO helio_app_test")
      stmt.close()
    } finally superConn.close()

    def pool(role: String): JdbcBackend.Database = {
      val cfg = new HikariConfig()
      cfg.setDataSource(superDs)
      cfg.setMaximumPoolSize(5)
      cfg.setConnectionInitSql(s"SET ROLE $role")
      JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(5))
    }
    privilegedDb = pool("helio_privileged")
    appDb        = pool("helio_app_test")
    ctx          = new DbContext(appDb, privilegedDb)
    runRepo      = new PipelineRunRepository(ctx)
    pipelineRepo = new PipelineRepository(ctx, new DataSourceRepository(ctx))

    owner    = seedUser()
    editor   = seedUser()
    stranger = seedUser()
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); embeddedPostgres.close() }

  private def user(id: String) = AuthenticatedUser(UserId(id))

  /** A fresh pipeline owned by `owner`, shared with `editor` as an editor grantee, plus one queued run. */
  private def seedPipelineWithRun(): (PipelineId, PipelineRunId) = {
    val (pid, _) = seedPipelineWithOutput(owner)
    awaitDb(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pid, $editor::uuid, 'editor', now())"""
    ))
    val runId = PipelineRunId(UUID.randomUUID().toString)
    awaitDb(runRepo.insertRunInternal(runId, PipelineId(pid), Instant.now()))
    (PipelineId(pid), runId)
  }

  private def runCountsVisibleTo(who: String, runId: PipelineRunId): Vector[Option[String]] =
    awaitDb(ctx.withUserContext(who)(
      sql"SELECT step_row_counts::text FROM pipeline_runs WHERE id = ${runId.value}".as[Option[String]]
    )).toVector

  private def pipelineCountsVisibleTo(who: String, pid: PipelineId): Vector[Option[String]] =
    awaitDb(ctx.withUserContext(who)(
      sql"SELECT last_run_step_row_counts::text FROM pipelines WHERE id = ${pid.value}".as[Option[String]]
    )).toVector

  private def json(s: Option[String]): Option[String] = s.map(_.replace(" ", ""))

  "the step row-count columns under helio_app_test" should {

    "prove the pool is genuinely non-BYPASSRLS" in {
      awaitDb(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
    }

    "persist the counts on the owner run path (RLS-enforced writes) and let the owner read them" in {
      val (pid, runId) = seedPipelineWithRun()
      awaitDb(runRepo.updateRunTerminal(runId, "succeeded", Instant.now(), Some(14), None, user(owner), Some("""{"reads":[]}"""), Some(counts))) shouldBe true
      awaitDb(pipelineRepo.updateLastRun(pid, "succeeded", Instant.now(), Some(14L), user(owner), Some(false), Some(counts)))

      runCountsVisibleTo(owner, runId).map(json) shouldBe Vector(Some(counts))
      pipelineCountsVisibleTo(owner, pid).map(json) shouldBe Vector(Some(counts))
      val summary = awaitDb(pipelineRepo.findSummaryById(pid, user(owner))).get
      summary.lastRunStepRowCounts.map(_.replace(" ", "")) shouldBe Some(counts)
    }

    "persist the counts on the editor-grantee path (privileged *Internal writes) and let the owner read them" in {
      val (pid, runId) = seedPipelineWithRun()
      awaitDb(runRepo.updateRunTerminalInternal(runId, "succeeded", Instant.now(), Some(14), None, Some("""{"reads":[]}"""), Some(counts))) shouldBe true
      awaitDb(pipelineRepo.updateLastRunInternal(pid, "succeeded", Instant.now(), Some(14L), Some(false), Some(counts)))

      runCountsVisibleTo(owner, runId).map(json) shouldBe Vector(Some(counts))
      pipelineCountsVisibleTo(owner, pid).map(json) shouldBe Vector(Some(counts))
      // the editor grantee reads them through the sharing-aware summary too
      awaitDb(pipelineRepo.findSummaryByIdShared(pid, Some(user(editor)))).flatMap(_.lastRunStepRowCounts).isDefined shouldBe true
    }

    "show a user who neither owns nor was granted the pipeline no run row, pipeline row or counts" in {
      val (pid, runId) = seedPipelineWithRun()
      awaitDb(runRepo.updateRunTerminalInternal(runId, "succeeded", Instant.now(), Some(14), None, Some("""{"reads":[]}"""), Some(counts)))
      awaitDb(pipelineRepo.updateLastRunInternal(pid, "succeeded", Instant.now(), Some(14L), Some(false), Some(counts)))

      runCountsVisibleTo(stranger, runId) shouldBe empty
      pipelineCountsVisibleTo(stranger, pid) shouldBe empty
      awaitDb(pipelineRepo.findSummaryByIdShared(pid, Some(user(stranger)))) shouldBe None
    }

    "clear the pipeline's counts when a later terminal write records none (failed run)" in {
      val (pid, runId) = seedPipelineWithRun()
      awaitDb(runRepo.updateRunTerminal(runId, "succeeded", Instant.now(), Some(14), None, user(owner), Some("""{"reads":[]}"""), Some(counts)))
      awaitDb(pipelineRepo.updateLastRun(pid, "succeeded", Instant.now(), Some(14L), user(owner), Some(false), Some(counts)))
      pipelineCountsVisibleTo(owner, pid).map(json) shouldBe Vector(Some(counts))

      awaitDb(pipelineRepo.updateLastRun(pid, "failed", Instant.now(), None, user(owner), Some(false)))
      pipelineCountsVisibleTo(owner, pid) shouldBe Vector(None)
      awaitDb(pipelineRepo.findSummaryById(pid, user(owner))).get.lastRunStepRowCounts shouldBe None

      val failedRun = PipelineRunId(UUID.randomUUID().toString)
      awaitDb(runRepo.insertRunInternal(failedRun, pid, Instant.now()))
      awaitDb(runRepo.updateRunTerminal(failedRun, "failed", Instant.now(), None, Some("boom"), user(owner), Some("""{"reads":[]}""")))
      runCountsVisibleTo(owner, failedRun) shouldBe Vector(None)
    }

    "write NULL counts for a reaped run and clear the pipeline's counts" in {
      val (pid, stale) = seedPipelineWithRun()
      awaitDb(pipelineRepo.updateLastRunInternal(pid, "succeeded", Instant.now().minusSeconds(7200), Some(14L), Some(false), Some(counts)))
      pipelineCountsVisibleTo(owner, pid).map(json) shouldBe Vector(Some(counts))
      awaitDb(privilegedDb.run(
        sqlu"UPDATE pipeline_runs SET started_at = now() - interval '2 hours', heartbeat_at = now() - interval '1 hour' WHERE id = ${stale.value}"
      ))

      val reaped = awaitDb(runRepo.reapStaleRunsInternal(Instant.now(), 600, 3600, """{"reads":[]}"""))
      reaped.map(_.runId) should contain(stale)
      pipelineCountsVisibleTo(owner, pid) shouldBe Vector(None)
      runCountsVisibleTo(owner, stale) shouldBe Vector(None)
    }
  }
}
