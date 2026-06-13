package com.helio.infrastructure

import com.helio.domain._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import scala.util.{Failure, Success, Try}

/** Integration test for V39 pipeline sharing grants RLS.
 *
 *  Covers the owner / editor / viewer / no-grant matrix for pipeline and
 *  resource_permissions table surfaces. Modelled after [[RlsSharingAwareTablesSpec]].
 *
 *  Strategy
 *  --------
 *  EmbeddedPostgres starts as postgres superuser.  A non-superuser
 *  `helio_app_test` role is used for the app pool (RLS active).
 *  The privileged pool uses `helio_privileged` (BYPASSRLS).
 *
 *  Actors
 *  ------
 *  - ownerA    : owns the pipeline under test
 *  - editorUser: holds an editor grant on ownerA's pipeline
 *  - viewerUser: holds a viewer grant on ownerA's pipeline
 *  - unrelated : has no grant whatsoever
 */
class PipelineSharingAclSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb:        JdbcBackend.Database = _
  private var ctx: DbContext                     = _

  private val ownerA      = UserId(UUID.randomUUID().toString)
  private val editorUser  = UserId(UUID.randomUUID().toString)
  private val viewerUser  = UserId(UUID.randomUUID().toString)
  private val unrelated   = UserId(UUID.randomUUID().toString)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    val superDs   = embeddedPostgres.getPostgresDatabase

    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    // Privileged pool — postgres superuser switches to helio_privileged (BYPASSRLS).
    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    // Create helio_app_test role and grant table + function permissions.
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
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_pipeline(TEXT) TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_pipeline(TEXT) TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    // App pool — postgres superuser + immediate SET ROLE helio_app_test (RLS active).
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)

    // Seed users required for pipeline.owner_id FK.
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerA.value}::uuid, ${s"${ownerA.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${editorUser.value}::uuid, ${s"${editorUser.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${viewerUser.value}::uuid, ${s"${viewerUser.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${unrelated.value}::uuid, ${s"${unrelated.value}@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Truncate pipeline-related tables between tests. Uses privileged pool so
   *  RLS does not interfere with cleanup. */
  private def cleanDb(): Unit =
    await(ctx.withSystemContext(
      sqlu"TRUNCATE TABLE resource_permissions, pipeline_steps, pipeline_runs, pipelines CASCADE"
    ))

  // ── Seed helpers (always via withSystemContext) ───────────────────────────

  private def seedPipeline(ownerId: UserId): String = {
    val id   = UUID.randomUUID().toString
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}',
                      ${ownerId.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types
               (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, ${ownerId.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($id, 'pipeline', $dsId, $dtId, ${ownerId.value}::uuid, now(), now())"""
    )))
    id
  }

  private def grantRole(pipelineId: String, granteeId: UserId, role: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions
               (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('pipeline', $pipelineId, ${granteeId.value}::uuid, $role, now())
             ON CONFLICT (resource_type, resource_id, grantee_id) DO UPDATE SET role = EXCLUDED.role"""
    ))

  // ── helio_can_access_pipeline function ───────────────────────────────────

  "helio_can_access_pipeline" should {

    "return TRUE for the pipeline owner" in {
      cleanDb()
      val pid = seedPipeline(ownerA)

      val result = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT helio_can_access_pipeline($pid)".as[Boolean]
      ))
      result.head shouldBe true
    }

    "return TRUE for an editor grantee" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, editorUser, "editor")

      val result = await(ctx.withUserContext(editorUser.value)(
        sql"SELECT helio_can_access_pipeline($pid)".as[Boolean]
      ))
      result.head shouldBe true
    }

    "return TRUE for a viewer grantee" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, viewerUser, "viewer")

      val result = await(ctx.withUserContext(viewerUser.value)(
        sql"SELECT helio_can_access_pipeline($pid)".as[Boolean]
      ))
      result.head shouldBe true
    }

    "return FALSE for an unrelated user (no grant)" in {
      cleanDb()
      val pid = seedPipeline(ownerA)

      val result = await(ctx.withUserContext(unrelated.value)(
        sql"SELECT helio_can_access_pipeline($pid)".as[Boolean]
      ))
      result.head shouldBe false
    }

    "return FALSE when no user context is set (no anonymous path for pipelines)" in {
      cleanDb()
      val pid = seedPipeline(ownerA)

      // Run directly on appDb with no session variable — simulates anonymous caller.
      val result = Await.result(
        appDb.run(sql"SELECT helio_can_access_pipeline($pid)".as[Boolean]),
        5.seconds
      )
      result.head shouldBe false
    }
  }

  // ── pipelines RLS SELECT ──────────────────────────────────────────────────

  "RLS on pipelines (SELECT)" should {

    "withUserContext(ownerA) sees ownerA's pipeline" in {
      cleanDb()
      val pid = seedPipeline(ownerA)

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id FROM pipelines".as[String]
      ))
      rows should contain(pid)
    }

    "withUserContext(editorUser) sees pipeline when editor grant exists" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, editorUser, "editor")

      val rows = await(ctx.withUserContext(editorUser.value)(
        sql"SELECT id FROM pipelines".as[String]
      ))
      rows should contain(pid)
    }

    "withUserContext(viewerUser) sees pipeline when viewer grant exists" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, viewerUser, "viewer")

      val rows = await(ctx.withUserContext(viewerUser.value)(
        sql"SELECT id FROM pipelines".as[String]
      ))
      rows should contain(pid)
    }

    "withUserContext(unrelated) does NOT see pipeline with no grant (no existence leak)" in {
      cleanDb()
      val pid = seedPipeline(ownerA)

      val rows = await(ctx.withUserContext(unrelated.value)(
        sql"SELECT id FROM pipelines".as[String]
      ))
      rows should not contain pid
    }

    "anonymous (no session var) sees NO pipelines (no public-viewer path)" in {
      cleanDb()
      val pid = seedPipeline(ownerA)

      val rows = Await.result(
        appDb.run(sql"SELECT id FROM pipelines".as[String]),
        5.seconds
      )
      rows should not contain pid
    }

    "withSystemContext (BYPASSRLS) sees all pipelines" in {
      cleanDb()
      val pid  = seedPipeline(ownerA)
      val pid2 = seedPipeline(unrelated)

      val rows = await(ctx.withSystemContext(
        sql"SELECT id FROM pipelines".as[String]
      ))
      rows.toSet should contain allOf (pid, pid2)
    }
  }

  // ── resource_permissions RLS for pipeline grants ──────────────────────────

  "RLS on resource_permissions (pipeline grants)" should {

    "withUserContext(ownerA) sees all pipeline grant rows for ownerA's pipeline" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, editorUser, "editor")
      grantRole(pid, viewerUser, "viewer")

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT resource_id FROM resource_permissions WHERE resource_type = 'pipeline'".as[String]
      ))
      rows.count(_ == pid) shouldBe 2
    }

    "withUserContext(editorUser) sees only their own pipeline grant row" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, editorUser, "editor")
      grantRole(pid, viewerUser, "viewer")

      val rows = await(ctx.withUserContext(editorUser.value)(
        sql"""SELECT grantee_id::text FROM resource_permissions
              WHERE resource_type = 'pipeline' AND grantee_id IS NOT NULL""".as[String]
      ))
      rows.toSet shouldBe Set(editorUser.value)
    }

    "withUserContext(viewerUser) sees only their own pipeline grant row" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, editorUser, "editor")
      grantRole(pid, viewerUser, "viewer")

      val rows = await(ctx.withUserContext(viewerUser.value)(
        sql"""SELECT grantee_id::text FROM resource_permissions
              WHERE resource_type = 'pipeline' AND grantee_id IS NOT NULL""".as[String]
      ))
      rows.toSet shouldBe Set(viewerUser.value)
    }

    "withUserContext(unrelated) sees zero pipeline grant rows" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, editorUser, "editor")

      val rows = await(ctx.withUserContext(unrelated.value)(
        sql"SELECT resource_id FROM resource_permissions WHERE resource_type = 'pipeline'".as[String]
      ))
      rows shouldBe empty
    }

    "withSystemContext sees all pipeline grant rows (BYPASSRLS)" in {
      cleanDb()
      val pid = seedPipeline(ownerA)
      grantRole(pid, editorUser, "editor")
      grantRole(pid, viewerUser, "viewer")

      val rows = await(ctx.withSystemContext(
        sql"SELECT resource_id FROM resource_permissions WHERE resource_type = 'pipeline'".as[String]
      ))
      rows.count(_ == pid) shouldBe 2
    }

    "ownerA cannot INSERT a pipeline grant for a pipeline they do not own" in {
      cleanDb()
      val ownedByUnrelated = seedPipeline(unrelated)

      // ownerA attempts to grant permission on unrelated's pipeline — should be blocked by RLS.
      val result: Try[Int] = Try(
        await(ctx.withUserContext(ownerA.value)(
          sqlu"""INSERT INTO resource_permissions
                   (resource_type, resource_id, grantee_id, role, created_at)
                   VALUES ('pipeline', $ownedByUnrelated, ${editorUser.value}::uuid, 'viewer', now())"""
        ))
      )

      result.isFailure shouldBe true
    }
  }
}
