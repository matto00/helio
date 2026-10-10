package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.infrastructure.persistence.pipelines.NodePayloadHistoryRepository
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.OutputHistoryRepository
import com.helio.testsupport.OutputHistoryFixtures
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.{Duration, Instant}
import scala.concurrent.ExecutionContext

/** HEL-1272: the retention purge runs on the privileged (BYPASSRLS) pool. Real two-role topology as
 *  in `RlsPrivilegedDmlSpec`: the app pool is `helio_app_test` (NOSUPERUSER, non-BYPASSRLS), the
 *  privileged pool is `helio_privileged`. helio_privileged is deliberately NOT re-granted anything
 *  here (C1), so a missing grant for the `pipelines`/`users` join or the history table is a real
 *  failure rather than masked. Seeding uses the superuser datasource. */
class OutputHistoryRetentionPrivilegedSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var superDb: JdbcBackend.Database      = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _

  override protected def seedDb: JdbcBackend.Database = superDb

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    val c = superDs.getConnection
    try {
      val st = c.createStatement()
      st.execute("""DO $$ BEGIN
                   |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
                   |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
                   |  END IF;
                   |END $$""".stripMargin)
      st.execute("GRANT helio_app_test TO postgres")
      st.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      st.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      st.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      st.close()
    } finally c.close()

    def pool(role: String): JdbcBackend.Database = {
      val cfg = new HikariConfig()
      cfg.setDataSource(superDs); cfg.setMaximumPoolSize(4); cfg.setConnectionInitSql(s"SET ROLE $role")
      JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(4))
    }
    privilegedDb = pool("helio_privileged")
    appDb        = pool("helio_app_test")
    superDb      = JdbcBackend.Database.forDataSource(superDs, Some(4))
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); superDb.close(); embeddedPostgres.close() }

  private val now = Instant.parse("2026-06-30T00:00:00Z")
  private object FixedClock extends Clock { override def now(): Instant = OutputHistoryRetentionPrivilegedSpec.this.now }

  private def seedAged(): (String, String) = {
    val (pid, oid) = seedPipelineWithOutput(seedUser("free"))
    val ancient = now.minus(Duration.ofDays(40)) // free cap 30d: purged by age
    val recent  = now.minus(Duration.ofDays(1)).minusSeconds(3600) // in the hour class, alone: kept
    val dupA    = now.minus(Duration.ofMinutes(8)); val dupB = now.minus(Duration.ofMinutes(7)) // same 5m bucket
    awaitDb(superDb.run(new OutputHistoryRepository(new DbContext(superDb, superDb)).insertAction(
      Seq(ancient, recent, dupA, dupB).map(historyEntry(oid, pid, _))
    )))
    (pid, oid)
  }

  "the retention purge" should {

    "run on helio_privileged and delete the expected points, while the app pool is not BYPASSRLS" in {
      awaitDb(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
      awaitDb(privilegedDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe true

      val (_, oid) = seedAged()
      val repo = new OutputHistoryRepository(new DbContext(appDb, privilegedDb))
      val svc  = new OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), FixedClock, new NodePayloadHistoryRepository(new DbContext(appDb, privilegedDb)), PayloadHistoryConfig.Defaults, protectedNewest = 0)
      // one aged-out + one thinned duplicate
      awaitDb(svc.purgeIfDue(now)) shouldBe Some(2)
      historyCount(oid) shouldBe 2
    }

    "delete nothing from history on the app pool with no user context" in {
      val (_, oid) = seedAged()
      val before = historyCount(oid)
      val deleted = awaitDb(appDb.run(
        sqlu"DELETE FROM output_snapshot_history WHERE output_id = $oid"
      ))
      deleted shouldBe 0
      historyCount(oid) shouldBe before
    }
  }
}
