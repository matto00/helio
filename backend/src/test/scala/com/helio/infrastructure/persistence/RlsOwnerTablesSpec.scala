package com.helio.infrastructure.persistence

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.agents.{AgentMemoryRepository, AgentPreferencesRepository}
import com.helio.infrastructure.persistence.sources.ImageUploadRepository
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Integration test proving that V35 RLS policies enforce per-owner row isolation
 *  across all six protected tables (data_sources, data_types, pipelines,
 *  pipeline_steps, pipeline_runs, data_type_rows).
 *
 *  Strategy
 *  --------
 *  EmbeddedPostgres starts as the `postgres` superuser (BYPASSRLS).  To
 *  observe real RLS filtering we create a non-superuser `helio_app_test` role
 *  and connect a second JDBC pool with that role as the login user.  The
 *  app-pool `DbContext` uses this non-privileged pool, while the privileged
 *  pool stays on the `postgres` superuser and carries the
 *  `helio_privileged` BYPASSRLS role.
 *
 *  Test invariants
 *  ---------------
 *  - `withUserContext(ownerA)` on the app pool sees only ownerA's rows.
 *  - `withUserContext(ownerB)` sees only ownerB's rows; cannot see ownerA's.
 *  - `withSystemContext` (privileged pool, BYPASSRLS) sees all rows.
 *  - `withUserContext` with no SET LOCAL (simulated by omitting the variable)
 *    sees zero rows because `current_setting('app.current_user_id')::uuid`
 *    raises an error — the fail-closed property.
 */
class RlsOwnerTablesSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _   // postgres superuser
  private var appDb:        JdbcBackend.Database = _   // helio_app_test (non-superuser)
  private var ctx: DbContext = _
  private var imageUploadRepo: ImageUploadRepository = _   // HEL-246
  private var agentPreferencesRepo: AgentPreferencesRepository = _   // HEL-472 (420-A)
  private var agentMemoryRepo: AgentMemoryRepository = _   // HEL-478 (420-B)

  /** Two synthetic owner UUIDs whose rows must never bleed across user contexts. */
  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    // Run Flyway as postgres superuser — creates helio_privileged + RLS policies.
    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
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

    // Create helio_app_test: a NOLOGIN, non-BYPASSRLS role the app pool will SET ROLE into.
    // Also grant helio_privileged the table-level access it needs for withSystemContext.
    // We do this via a direct JDBC connection to the superuser before HikariCP pools start.
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
      // Allow postgres (the login user) to SET ROLE helio_app_test.
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      // helio_privileged also needs explicit table access since SET ROLE drops postgres superuser privs.
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    // App pool — connects as postgres but immediately sets ROLE helio_app_test.
    // helio_app_test is NOT BYPASSRLS, so the V35 policies are evaluated.
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)
    imageUploadRepo = new ImageUploadRepository(ctx)
    agentPreferencesRepo = new AgentPreferencesRepository(ctx)
    agentMemoryRepo = new AgentMemoryRepository(ctx)

    // Seed user rows so pipelines.owner_id FK references are satisfied.
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerA.value}::uuid, ${s"${ownerA.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerB.value}::uuid, ${s"${ownerB.value}@test.local"}, now())
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

  /** Truncate all tables touched by this spec between tests.  Uses the
   *  privileged pool so RLS does not interfere with the cleanup. */
  private def cleanDb(): Unit =
    await(ctx.withSystemContext(
      sqlu"TRUNCATE TABLE data_sources, pipeline_steps, pipeline_runs, pipelines, image_uploads, agent_preferences, agent_memory CASCADE"
    ))

  // ── Helper: seed via withSystemContext (BYPASSRLS) so setup is never ──────
  // ── gated by RLS.                                                     ──────

  /** Seed a data_source row via the privileged pool and return its UUID string. */
  private def seedSource(ownerId: UserId): String = {
    val id   = UUID.randomUUID().toString
    val name = s"src-${ownerId.value.take(8)}"
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($id::uuid, $name, 'csv', '{"path":"csv/test.csv"}'::jsonb,
                     ${ownerId.value}::uuid, now(), now())"""
    ))
    id
  }

  "RLS on data_sources" should {

    "withUserContext(ownerA) returns only ownerA's sources" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val srcB = seedSource(ownerB)

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id::text FROM data_sources".as[String]
      ))

      rows.toSet shouldBe Set(srcA)
      rows should not contain srcB
    }

    "withUserContext(ownerB) cannot see ownerA's sources" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      seedSource(ownerB)

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id::text FROM data_sources".as[String]
      ))

      rows should not contain srcA
    }

    "withSystemContext sees all sources (BYPASSRLS)" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val srcB = seedSource(ownerB)

      val rows = await(ctx.withSystemContext(
        sql"SELECT id::text FROM data_sources".as[String]
      ))

      rows.toSet should contain allOf (srcA, srcB)
    }
  }


  // HEL-904 task 2.10: the "RLS on data_types" describe-block is deleted
  // outright, not adapted -- `data_types` is dropped; `outputs`
  // (its RLS replacement) doesn't yet have dedicated coverage in this spec
  // (a tracked gap, not this task's job to close).

  "RLS on pipelines" should {

    "withUserContext(ownerA) returns only ownerA's pipelines" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val srcB = seedSource(ownerB)
      val pidA = UUID.randomUUID().toString
      val pidB = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pidA::uuid, 'pipe-a', ${ownerA.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pidA::uuid, $pidA::uuid, $srcA::uuid, 0)""",
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pidB::uuid, 'pipe-b', ${ownerB.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pidB::uuid, $pidB::uuid, $srcB::uuid, 0)"""
      )))

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id::text FROM pipelines".as[String]
      ))

      rows.toSet shouldBe Set(pidA)
      rows should not contain pidB
    }

    "withSystemContext sees all pipelines (BYPASSRLS)" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val srcB = seedSource(ownerB)
      val pidA = UUID.randomUUID().toString
      val pidB = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pidA::uuid, 'pipe-a', ${ownerA.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pidA::uuid, $pidA::uuid, $srcA::uuid, 0)""",
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pidB::uuid, 'pipe-b', ${ownerB.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pidB::uuid, $pidB::uuid, $srcB::uuid, 0)"""
      )))

      val rows = await(ctx.withSystemContext(
        sql"SELECT id::text FROM pipelines".as[String]
      ))

      rows.toSet should contain allOf (pidA, pidB)
    }
  }


  /** Seed via `ImageUploadRepository.insert` (not raw SQL like the helpers
   *  above) — this is the real write path, so the assertions below prove
   *  the repository's `withUserContext` call actually goes through the
   *  owner RLS policy rather than merely asserting the policy exists. */
  private def seedImageUpload(ownerId: UserId): String = {
    val upload = ImageUpload(
      id         = ImageUploadId(UUID.randomUUID().toString),
      ownerId    = ownerId,
      storageKey = s"images/${UUID.randomUUID().toString}.png",
      mimeType   = "image/png",
      filename   = "photo.png",
      sizeBytes  = 123L,
      createdAt  = Instant.now()
    )
    await(imageUploadRepo.insert(upload))
    upload.id.value
  }

  "RLS on image_uploads" should {

    "ImageUploadRepository.insert runs in the uploading user's context — ownerA sees only their own upload" in {
      cleanDb()
      val idA = seedImageUpload(ownerA)
      val idB = seedImageUpload(ownerB)

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id FROM image_uploads".as[String]
      ))

      rows.toSet shouldBe Set(idA)
      rows should not contain idB
    }

    "withUserContext(ownerB) cannot see ownerA's uploads" in {
      cleanDb()
      val idA = seedImageUpload(ownerA)
      seedImageUpload(ownerB)

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id FROM image_uploads".as[String]
      ))

      rows should not contain idA
    }

    "withSystemContext (privileged pool) sees all uploads regardless of owner" in {
      cleanDb()
      val idA = seedImageUpload(ownerA)
      val idB = seedImageUpload(ownerB)

      val rows = await(ctx.withSystemContext(
        sql"SELECT id FROM image_uploads".as[String]
      ))

      rows.toSet should contain allOf (idA, idB)
    }
  }


  /** Seed via `AgentPreferencesRepository.put` (not raw SQL like the `seedSource`/`seedDataType`
   *  helpers above) — this is the real write path, so the assertions below prove the
   *  repository's `withUserContext` call actually goes through the V81 owner RLS policy rather
   *  than merely asserting the policy exists (mirrors `seedImageUpload` above). */
  private def seedAgentPreferences(ownerId: UserId, note: String): AgentPreferences = {
    val prefs = AgentPreferences(
      userId              = ownerId,
      defaultSeriesColors = Some(Vector("#123456")),
      defaultPanelStyle   = Some(JsObject("background" -> JsString("dark"))),
      namingConventions   = None,
      extras              = JsObject("note" -> JsString(note)),
      memoryEnabled       = true
    )
    await(agentPreferencesRepo.put(ownerId, prefs))
  }

  "RLS on agent_preferences" should {

    "AgentPreferencesRepository.put runs in the caller's own context — ownerA sees only their own row" in {
      cleanDb()
      seedAgentPreferences(ownerA, "a")
      seedAgentPreferences(ownerB, "b")

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT user_id::text FROM agent_preferences".as[String]
      ))

      rows.toSet shouldBe Set(ownerA.value)
      rows should not contain ownerB.value
    }

    "withUserContext(ownerB) cannot see ownerA's row" in {
      cleanDb()
      seedAgentPreferences(ownerA, "a")
      seedAgentPreferences(ownerB, "b")

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT user_id::text FROM agent_preferences".as[String]
      ))

      rows should not contain ownerA.value
    }

    "ownerA's context cannot overwrite ownerB's row via AgentPreferencesRepository.put" in {
      cleanDb()
      seedAgentPreferences(ownerB, "original")

      // ownerA attempts to upsert a row keyed to ownerB's user_id, but put() always runs under
      // withUserContext(the userId argument) — so this exercises the RLS policy from ownerB's
      // own write context, which is the only context AgentPreferencesRepository.put ever uses
      // (design.md Decision 3: never withSystemContext). A genuine cross-user overwrite attempt
      // (ownerA's SESSION writing a row claiming ownerB's user_id) is rejected by the USING
      // clause's implicit WITH CHECK when attempted directly against the app pool.
      val attempted = intercept[Exception] {
        Await.result(
          appDb.run(DBIO.seq(
            sql"SELECT set_config('app.current_user_id', ${ownerA.value}, true)".as[String],
            sqlu"""INSERT INTO agent_preferences (user_id, preferences, updated_at)
                   VALUES (${ownerB.value}::uuid, '{"extras":{"note":"hijacked"}}'::jsonb, now())
                   ON CONFLICT (user_id) DO UPDATE SET preferences = EXCLUDED.preferences"""
          ).transactionally),
          10.seconds
        )
      }
      attempted should not be null

      val stillOwnerBs = await(ctx.withSystemContext(
        sql"SELECT preferences::text FROM agent_preferences WHERE user_id = ${ownerB.value}::uuid".as[String].head
      ))
      stillOwnerBs should include("original")
    }

    "withSystemContext (privileged pool) sees all rows regardless of owner" in {
      cleanDb()
      seedAgentPreferences(ownerA, "a")
      seedAgentPreferences(ownerB, "b")

      val rows = await(ctx.withSystemContext(
        sql"SELECT user_id::text FROM agent_preferences".as[String]
      ))

      rows.toSet should contain allOf (ownerA.value, ownerB.value)
    }
  }


  /** Seed via `AgentMemoryRepository.add` (not raw SQL like the `seedSource`/`seedDataType`
   *  helpers above) — this is the real write path, so the assertions below prove the
   *  repository's `withUserContext` call actually goes through the V82 owner RLS policy rather
   *  than merely asserting the policy exists (mirrors `seedImageUpload`/`seedAgentPreferences`
   *  above). */
  private def seedAgentMemory(ownerId: UserId, content: String): AgentMemoryEntry = {
    val entry = AgentMemoryEntry(
      id         = AgentMemoryId(UUID.randomUUID().toString),
      ownerId    = ownerId,
      kind       = AgentMemoryKind.Fact,
      content    = content,
      createdAt  = Instant.now(),
      lastUsedAt = None
    )
    await(agentMemoryRepo.add(entry, cap = 100, retentionDays = 36500))
  }

  "RLS on agent_memory" should {

    "AgentMemoryRepository.add runs in the caller's own context — ownerA sees only their own entries" in {
      cleanDb()
      val entryA = seedAgentMemory(ownerA, "a")
      val entryB = seedAgentMemory(ownerB, "b")

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id::text FROM agent_memory".as[String]
      ))

      rows.toSet shouldBe Set(entryA.id.value)
      rows should not contain entryB.id.value
    }

    "withUserContext(ownerB) cannot see ownerA's entries" in {
      cleanDb()
      val entryA = seedAgentMemory(ownerA, "a")
      seedAgentMemory(ownerB, "b")

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id::text FROM agent_memory".as[String]
      ))

      rows should not contain entryA.id.value
    }

    "ownerA's context cannot delete ownerB's entry via AgentMemoryRepository.delete" in {
      cleanDb()
      val entryB = seedAgentMemory(ownerB, "b")

      val deleted = await(agentMemoryRepo.delete(entryB.id, AuthenticatedUser(ownerA)))
      deleted shouldBe false

      val stillThere = await(ctx.withSystemContext(
        sql"SELECT id::text FROM agent_memory WHERE id = ${entryB.id.value}::uuid".as[String]
      ))
      stillThere shouldBe Seq(entryB.id.value)
    }

    "ownerA's context cannot clear ownerB's entries via AgentMemoryRepository.clear" in {
      cleanDb()
      seedAgentMemory(ownerA, "a")
      seedAgentMemory(ownerB, "b")

      val clearedByA = await(agentMemoryRepo.clear(AuthenticatedUser(ownerA)))
      clearedByA shouldBe 1

      val ownerBCount = await(ctx.withSystemContext(
        sql"SELECT COUNT(*) FROM agent_memory WHERE owner_id = ${ownerB.value}::uuid".as[Int].head
      ))
      ownerBCount shouldBe 1
    }

    "withSystemContext (privileged pool) sees all entries regardless of owner" in {
      cleanDb()
      val entryA = seedAgentMemory(ownerA, "a")
      val entryB = seedAgentMemory(ownerB, "b")

      val rows = await(ctx.withSystemContext(
        sql"SELECT id::text FROM agent_memory".as[String]
      ))

      rows.toSet should contain allOf (entryA.id.value, entryB.id.value)
    }
  }

  // ── fail-closed: missing session var raises error on app pool ─────────────

  "RLS fail-closed property" should {

    /** When `app.current_user_id` has never been SET in the session,
     *  `current_setting('app.current_user_id')::uuid` in the USING clause
     *  raises `ERROR: unrecognized configuration parameter`.  The fail-closed
     *  contract is that no rows are visible without an explicit user context. */
    "SELECT on data_sources without app.current_user_id set raises an error" in {
      cleanDb()
      seedSource(ownerA)

      // Run directly on the app pool — no SET LOCAL, no helio_app_test setup.
      // The RLS USING clause evaluates current_setting without missing_ok,
      // which raises ERROR when the GUC has never been set.
      val future = appDb.run(sql"SELECT id FROM data_sources".as[String])
      val thrown = intercept[Exception] {
        Await.result(future, 5.seconds)
      }
      // PostgreSQL error text varies across versions; we confirm it is an exception.
      thrown should not be null
    }
  }
}
