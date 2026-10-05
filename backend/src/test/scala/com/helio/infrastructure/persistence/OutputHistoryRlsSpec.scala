package com.helio.infrastructure.persistence

import com.helio.testsupport.OutputHistoryFixtures
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.ExecutionContext

/** HEL-1271: RLS proof for `output_snapshot_history`, run as `helio_app_test` (NOSUPERUSER, not
 *  BYPASSRLS) -- a superuser-run assertion would pass vacuously because it bypasses every policy.
 *  The grantee case uses a `resource_permissions` row with `resource_type = 'pipeline'`. */
class OutputHistoryRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var ctx: DbContext                     = _

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private var owner, grantee, stranger: String = _
  private var pipelineId, outputId: String     = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
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
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
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

    owner    = seedUser()
    grantee  = seedUser()
    stranger = seedUser()
    val (pid, oid) = seedPipelineWithOutput(owner)
    pipelineId = pid
    outputId = oid
    awaitDb(privilegedDb.run(DBIO.seq(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pid, $grantee::uuid, 'viewer', now())""",
      sqlu"""INSERT INTO output_snapshot_history (output_id, pipeline_id, root_id, run_id, trigger_source, captured_at, row_count, summary)
             VALUES ($oid, $pid, $pid, 'r1', 'manual', now(), 1, '{"v":1}'::jsonb)"""
    )))
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); embeddedPostgres.close() }

  private def visibleTo(user: String): Int =
    awaitDb(ctx.withUserContext(user)(sql"SELECT count(*) FROM output_snapshot_history WHERE output_id = $outputId".as[Int].head))

  "output_snapshot_history under helio_app_test" should {

    "prove the pool is genuinely non-BYPASSRLS" in {
      awaitDb(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
    }

    "let the pipeline owner SELECT" in { visibleTo(owner) shouldBe 1 }

    "let a user the pipeline is shared with SELECT" in { visibleTo(grantee) shouldBe 1 }

    "show a non-grantee zero rows" in { visibleTo(stranger) shouldBe 0 }

    "reject an INSERT with no user context, by the row-level security policy itself" in {
      val ex = the[Exception] thrownBy awaitDb(appDb.run(
        sqlu"""INSERT INTO output_snapshot_history (output_id, pipeline_id, trigger_source, captured_at, row_count, summary)
               VALUES ($outputId, $pipelineId, 'manual', now(), 1, '{}'::jsonb)"""
      ))
      ex.getMessage should include("row-level security policy")
    }

    "accept an INSERT by a user who can access the pipeline" in {
      awaitDb(ctx.withUserContext(owner)(
        sqlu"""INSERT INTO output_snapshot_history (output_id, pipeline_id, trigger_source, captured_at, row_count, summary)
               VALUES ($outputId, $pipelineId, 'manual', now(), 2, '{}'::jsonb)"""
      )) shouldBe 1
    }

    "reject an INSERT by a non-grantee" in {
      val ex = the[Exception] thrownBy awaitDb(ctx.withUserContext(stranger)(
        sqlu"""INSERT INTO output_snapshot_history (output_id, pipeline_id, trigger_source, captured_at, row_count, summary)
               VALUES ($outputId, $pipelineId, 'manual', now(), 3, '{}'::jsonb)"""
      ))
      ex.getMessage should include("row-level security policy")
    }
  }
}
