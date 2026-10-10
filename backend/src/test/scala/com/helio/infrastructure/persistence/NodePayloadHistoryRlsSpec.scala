package com.helio.infrastructure.persistence

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, RetentionPassOutcome}
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
import spray.json.{JsNumber, JsObject}

import java.time.Instant
import scala.concurrent.ExecutionContext

/** HEL-1276 task 6.5: RLS proof for `node_payload_history` on the REAL two-role topology -- the app
 *  pool runs as `helio_app_test` (NOSUPERUSER, not BYPASSRLS) and writes/purges run as the separate
 *  `helio_privileged` role (BYPASSRLS, explicit table grant only). A superuser-run assertion would
 *  pass vacuously because a superuser bypasses every policy.
 *
 *  The two RED mutations below prove the assertions can fail. Dropping the SELECT policy is NOT a
 *  "stranger sees the row" mutation: with RLS forced and no SELECT policy Postgres denies everyone
 *  (V94OutputsMigrationSpec's shape), so that one asserts the OWNER and GRANTEE go blind; the
 *  `USING (true)` mutation is the one that lets the stranger in. */
class NodePayloadHistoryRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var superDb: JdbcBackend.Database      = _
  private var ctx: DbContext                     = _

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private var owner, grantee, stranger: String = _
  private var pipelineId: String               = _
  private var payloadRepo: NodePayloadHistoryRepository = _

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
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      // After Flyway, so it covers node_payload_history; helio_privileged gets ONLY V116's own explicit grant.
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
    superDb      = JdbcBackend.Database.forDataSource(superDs, Some(3))
    ctx          = new DbContext(appDb, privilegedDb)
    payloadRepo  = new NodePayloadHistoryRepository(ctx)

    owner    = seedUser("beta")
    grantee  = seedUser()
    stranger = seedUser()
    val (pid, _) = seedPipelineWithOutput(owner)
    pipelineId = pid
    awaitDb(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pid, $grantee::uuid, 'viewer', now())"""
    ))
    // Written the production way: writeAction on the privileged pool (no extra grants), beta tier allows it.
    awaitDb(ctx.withSystemContext(payloadRepo.writeAction(
      pid, None, Some(pid), Some("r1"), "manual", Instant.now(), Vector(JsObject("a" -> JsNumber(1))), PayloadHistoryConfig.Defaults
    ))) should not be empty
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); superDb.close(); embeddedPostgres.close() }

  private def visibleTo(user: String): Int =
    awaitDb(ctx.withUserContext(user)(sql"SELECT count(*) FROM node_payload_history WHERE pipeline_id = $pipelineId".as[Int].head))

  private def insertAs(user: Option[String]) = {
    val q = sqlu"""INSERT INTO node_payload_history (pipeline_id, root_id, trigger_source, captured_at, row_count, byte_size, rows)
                   VALUES ($pipelineId, $pipelineId, 'manual', now(), 1, 7, '[{"a":2}]'::jsonb)"""
    awaitDb(user.fold(appDb.run(q))(u => ctx.withUserContext(u)(q)))
  }

  private def ddl(sql: String): Unit = awaitDb(superDb.run(sqlu"#$sql"))

  private val selectPolicy =
    "CREATE POLICY node_payload_history_select ON node_payload_history FOR SELECT USING (helio_can_access_pipeline(pipeline_id))"

  "node_payload_history under the two-role topology" should {

    "prove the app role is genuinely NOSUPERUSER and non-BYPASSRLS, and the privileged role is a different, BYPASSRLS role" in {
      awaitDb(appDb.run(sql"SELECT (rolsuper OR rolbypassrls) FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
      awaitDb(appDb.run(sql"SELECT current_user".as[String].head)) shouldBe "helio_app_test"
      awaitDb(privilegedDb.run(sql"SELECT current_user".as[String].head)) shouldBe "helio_privileged"
      awaitDb(privilegedDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe true
    }

    "let the pipeline owner SELECT" in { visibleTo(owner) shouldBe 1 }
    "let a user the pipeline is shared with SELECT" in { visibleTo(grantee) shouldBe 1 }
    "show a non-grantee zero rows" in { visibleTo(stranger) shouldBe 0 }

    "reject an INSERT with no user context, by the row-level security policy itself" in {
      (the[Exception] thrownBy insertAs(None)).getMessage should include("row-level security policy")
    }
    "accept an INSERT by a user who can access the pipeline" in { insertAs(Some(owner)) shouldBe 1 }
    "reject an INSERT by a non-grantee" in {
      (the[Exception] thrownBy insertAs(Some(stranger))).getMessage should include("row-level security policy")
    }
  }

  "the RLS assertions" should {

    "go RED when the SELECT policy is dropped (owner and grantee lose the row), and green again once restored" in {
      val rows = visibleTo(owner)
      rows should be >= 1
      ddl("DROP POLICY node_payload_history_select ON node_payload_history")
      try {
        info(s"MUTATION policy dropped: owner=${visibleTo(owner)} grantee=${visibleTo(grantee)} stranger=${visibleTo(stranger)}")
        visibleTo(owner) shouldBe 0      // the "owner SELECT = 1" assertion would now FAIL
        visibleTo(grantee) shouldBe 0
      } finally ddl(selectPolicy)
      visibleTo(owner) shouldBe rows
      visibleTo(grantee) shouldBe rows
      visibleTo(stranger) shouldBe 0
    }

    "go RED when the SELECT policy is replaced by USING (true) (the stranger now sees the row), and green again once restored" in {
      val rows = visibleTo(owner)
      rows should be >= 1
      visibleTo(stranger) shouldBe 0
      ddl("DROP POLICY node_payload_history_select ON node_payload_history")
      ddl("CREATE POLICY node_payload_history_select ON node_payload_history FOR SELECT USING (true)")
      try {
        info(s"MUTATION USING (true): owner=${visibleTo(owner)} grantee=${visibleTo(grantee)} stranger=${visibleTo(stranger)}")
        visibleTo(stranger) should be >= 1 // the "non-grantee sees zero" assertion would now FAIL
      } finally {
        ddl("DROP POLICY node_payload_history_select ON node_payload_history")
        ddl(selectPolicy)
      }
      visibleTo(owner) shouldBe rows
      visibleTo(grantee) shouldBe rows
      visibleTo(stranger) shouldBe 0
    }
  }

  // Last: the purge deletes the seeded (unreferenced) payload the tests above read.
  "the privileged role" should {
    "write and purge with only V116's own grant" in {
      val pid2 = seedPipelineWithOutput(seedUser("beta"))._1
      awaitDb(ctx.withSystemContext(payloadRepo.writeAction(
        pid2, None, Some(pid2), None, "manual", Instant.now(), Vector(JsObject("a" -> JsNumber(1))), PayloadHistoryConfig.Defaults
      ))) should not be empty
      // No summary point references it, so the purge removes it (on the privileged pool, RLS bypassed).
      awaitDb(payloadRepo.purge(Instant.now(), PayloadHistoryConfig.Defaults)) should matchPattern { case RetentionPassOutcome.Purged(n) if n >= 1 => }
      awaitDb(privilegedDb.run(sql"SELECT count(*) FROM node_payload_history WHERE pipeline_id = $pid2".as[Int].head)) shouldBe 0
    }
  }
}
