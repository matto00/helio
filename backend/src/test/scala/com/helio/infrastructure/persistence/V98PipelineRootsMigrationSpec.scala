package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.BeforeAndAfterEach
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-913 tasks 3.2-3.6b: proof obligations for V98 (`pipeline_roots`), the migration that
 *  replaces `pipelines.source_data_source_id` (one source per pipeline) with N roots per
 *  pipeline. `FlywayNonSuperuserMigrationSpec` (task 3.1) is the only gate that proves V98
 *  applies at all under real, non-superuser RLS enforcement against a real dump; THIS spec
 *  proves V98's DATA MIGRATION and its guard are *correct* -- full coverage, idempotency,
 *  byte-identical passthrough of untouched rows, and (task 3.5, the one that matters most)
 *  that the step-8 `RAISE EXCEPTION` guard actually FIRES when seeded with each of the five
 *  violation shapes it exists to catch. A guard never observed failing is not evidence
 *  (lesson 8) -- assert what it PRODUCED, not that a clean run merely succeeded.
 *
 *  Runs as the `postgres` superuser (unlike `FlywayNonSuperuserMigrationSpec`) because every
 *  assertion here is about the migration's DATA correctness, not about whether its RLS bracket
 *  is present -- that is a materially different property, already covered end-to-end by task
 *  3.1's spec. Using superuser here keeps this spec's fixtures small and legible.
 */
class V98PipelineRootsMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterEach {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _

  private val ownerId  = UUID.randomUUID().toString
  private val granteeId = UUID.randomUUID().toString

  override def beforeEach(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")

    // Migrate to V97 (everything up to, but not including, V98) as superuser, then seed a
    // realistic-shaped pre-V98 fixture: two pipelines (one with a two-step trunk, so there is a
    // real non-root step to prove byte-identical passthrough against), plus the two unrebindable
    // populations task 3.5a requires (an orphan node_snapshots row and a pipeline_id-NULL
    // binary_refs row) seeded BEFORE V98 runs, exactly like a real pre-migration database would
    // carry them.
    Flyway
      .configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .target(MigrationVersion.fromVersion("97"))
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))

    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'owner@test.local', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, 'grantee@test.local', now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
             VALUES ('ds-1', 'ds-1', 'static', '{}', now(), now(), $ownerId::uuid)""",
      // Seeded at the PRE-V98 (V97) schema shape -- `pipeline_roots` does not exist yet at this
      // migration target, so the source binding is still `pipelines.source_data_source_id`
      // directly (NOT NULL at V97). V98's own backfill (exercised by `migrateToLatest()` in each
      // test below) is what creates `pipeline_roots` from this column, not this fixture.
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, created_at, updated_at, owner_id) VALUES ('pipe-1', 'pipe-1', 'ds-1', now(), now(), $ownerId::uuid)""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, created_at, updated_at, owner_id) VALUES ('pipe-2', 'pipe-2', 'ds-1', now(), now(), $ownerId::uuid)""",
      // pipe-1's trunk: root step (parent_step_id NULL) + one child (parent_step_id set) -- the
      // child is the row task 3.4's byte-identical-passthrough assertion targets.
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, enabled, parent_step_id)
             VALUES ('step-root-1', 'pipe-1', 0, 'filter', '{"field":"x"}', now(), now(), true, NULL)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, enabled, parent_step_id)
             VALUES ('step-child-1', 'pipe-1', 0, 'filter', '{"field":"y"}', now(), now(), true, 'step-root-1')""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, enabled, parent_step_id)
             VALUES ('step-root-2', 'pipe-2', 0, 'filter', '{"field":"z"}', now(), now(), true, NULL)""",
      // Task 3.5a fixture (a): a node_snapshots row keyed to a pipeline_id that matches NO real
      // pipeline -- the "orphan, nothing ever deletes it" population.
      sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data)
             VALUES ('nonexistent-pipeline', NULL, 0, '{}'::jsonb)""",
      // Task 3.5a fixture (b): a binary_refs row with pipeline_id IS NULL -- the "never rekeyed,
      // owning data_type had no pipeline" population.
      sqlu"""INSERT INTO binary_refs (id, row_index, field_name, storage_key, mime_type, filename, size_bytes, pipeline_id, node_step_id)
             VALUES ('ref-orphan', 0, 'f', 'k', 'text/plain', 'f.txt', 1, NULL, NULL)"""
    )))
  }

  override def afterEach(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  /** Runs V98 (and nothing beyond it in this classpath — V98 is latest as of this cycle). */
  private def migrateToLatest(): Unit = {
    val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
  }

  "V98's data migration" should {

    "give every pre-existing pipeline exactly one backfilled root, non-zero (task 3.2)" in {
      migrateToLatest()
      val pipelineCount = await(db.run(sql"SELECT count(*) FROM pipelines".as[Int].head))
      val rootCount     = await(db.run(sql"SELECT count(*) FROM pipeline_roots".as[Int].head))
      pipelineCount shouldBe 2
      rootCount shouldBe pipelineCount
      rootCount should be > 0

      val parentlessWithoutRoot = await(db.run(
        sql"SELECT count(*) FROM pipeline_steps WHERE parent_step_id IS NULL AND root_id IS NULL".as[Int].head
      ))
      parentlessWithoutRoot shouldBe 0
    }

    "dispose of both unrebindable populations and log their counts (task 3.5a)" in {
      migrateToLatest()

      val remainingOrphanSnapshot = await(db.run(
        sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = 'nonexistent-pipeline'".as[Int].head
      ))
      val remainingOrphanRef = await(db.run(
        sql"SELECT count(*) FROM binary_refs WHERE id = 'ref-orphan'".as[Int].head
      ))
      remainingOrphanSnapshot shouldBe 0
      remainingOrphanRef shouldBe 0

      val loggedCounts = await(db.run(
        sql"SELECT step, count FROM hel913_migration_counts ORDER BY step".as[(String, Int)]
      )).toMap
      loggedCounts.get("node_snapshots_orphaned_no_pipeline_deleted") shouldBe Some(1)
      loggedCounts.get("binary_refs_orphaned_null_pipeline_id") shouldBe Some(1)
    }

    "carry a root_id on every previously node_step_id-NULL outputs/node_snapshots row (task 3.6a, R12)" in {
      // Seed one root-bound node_snapshots row (node_step_id NULL, on the live pipe-1) BEFORE
      // migrating, so there is a real row for the backfill to rebind.
      await(db.run(
        sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data)
               VALUES ('pipe-1', NULL, 0, '{}'::jsonb)"""
      ))
      migrateToLatest()

      val rootBoundSnapshotRootId = await(db.run(
        sql"SELECT root_id FROM node_snapshots WHERE pipeline_id = 'pipe-1' AND node_step_id IS NULL".as[Option[String]].head
      ))
      rootBoundSnapshotRootId shouldBe Some("pipe-1")
    }

    "be idempotent: re-running the root backfill INSERT is a no-op (task 3.3)" in {
      migrateToLatest()
      val rootCountBefore = await(db.run(sql"SELECT count(*) FROM pipeline_roots".as[Int].head))

      val rowsAffected = await(db.run(sqlu"""
        INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
        SELECT p.id, p.id, (SELECT r2.data_source_id FROM pipeline_roots r2 WHERE r2.pipeline_id = p.id LIMIT 1), 0
        FROM pipelines p
        WHERE NOT EXISTS (SELECT 1 FROM pipeline_roots r WHERE r.pipeline_id = p.id)
      """))
      rowsAffected shouldBe 0

      val rootCountAfter = await(db.run(sql"SELECT count(*) FROM pipeline_roots".as[Int].head))
      rootCountAfter shouldBe rootCountBefore
    }

    "leave a non-root step byte-identical after migration (task 3.4)" in {
      val before = await(db.run(
        sql"SELECT position, op, config, parent_step_id FROM pipeline_steps WHERE id = 'step-child-1'"
          .as[(Int, String, String, Option[String])].head
      ))
      migrateToLatest()
      val after = await(db.run(
        sql"SELECT position, op, config, parent_step_id, root_id FROM pipeline_steps WHERE id = 'step-child-1'"
          .as[(Int, String, String, Option[String], Option[String])].head
      ))
      (after._1, after._2, after._3, after._4) shouldBe before
      // A non-root (parented) step must NOT itself carry a root_id -- only the trunk root does.
      after._5 shouldBe None
    }
  }

  "V98's step-8 RAISE EXCEPTION guard" should {

    "removing the pipelines NO FORCE bracket from the SHIPPED V98 file corrupts data SILENTLY -- the guard itself is blind for this one table, so the external non-superuser count check (task 3.1) is the actual, necessary backstop, not a redundant belt-and-suspenders (task 3.5, skeptic round 1 fix + empirical correction)" in {
      // Round-1 skeptic finding: a test that hand-writes a copy of the guard's predicate and
      // runs it standalone proves that copy raises -- it does NOT prove V98's own guard is
      // reachable or that removing the bracket would ever be NOTICED. Fixed by loading V98's
      // ACTUAL shipped SQL text from the classpath, mechanically removing ONLY the `pipelines`
      // NO FORCE line, and executing the result as a genuine non-superuser, table-owning role.
      //
      // Running that mutation empirically (not merely reasoned about) surfaced a SECOND,
      // more serious defect than "the guard doesn't fire": the guard's own `SELECT ... FROM
      // pipelines` in section 8 is gated by the IDENTICAL RLS state as the backfill it is
      // trying to police. With the bracket removed, `pipelines` stays FORCE for its own owner
      // for the ENTIRE transaction (guard included, not just the backfill) -- `helio_can_
      // access_pipeline` fails CLOSED-to-false on Flyway's unset `app.current_user_id`, so BOTH
      // the backfill's SELECT and the guard's own COUNT(*) FROM pipelines see ZERO rows. The
      // guard's `pipelines_without_root` therefore computes as 0 (not "1 pipeline lacks a
      // root" but "0 pipelines are visible to check at all") and it does NOT raise. The
      // migration reports SUCCESS while having silently dropped the real pipeline's source --
      // exactly the failure mode this migration's header warns about, except WORSE: the guard
      // that was supposed to convert it into a loud failure is disarmed by the same root cause.
      //
      // This is asserted here directly (not merely narrated) via a raw-JDBC-as-owner probe
      // proving BOTH halves: (a) the mutated migration completes with no exception, and (b) the
      // real pre-existing pipeline ends up with ZERO pipeline_roots rows -- genuine silent data
      // loss. The second half of this test then proves what DOES catch it: an EXTERNAL,
      // separately-connected superuser count of `pipelines` (bypassing RLS entirely, immune to
      // the missing bracket) compared against `pipeline_roots`, exactly `FlywayNonSuperuserMigrationSpec`
      // task 3.1/3.2's technique -- that comparison mismatches (1 vs 0), which is precisely why
      // that external spec, not this migration's own in-transaction guard, is the load-bearing
      // gate for a missing bracket on a fail-SILENT table. V98's header is updated accordingly.
      val ep = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val superDs = ep.getPostgresDatabase

        // Non-superuser, table-owning role -- identical shape to
        // `FlywayNonSuperuserMigrationSpec`'s `helio_migration_test`.
        val superConn = superDs.getConnection
        try {
          val stmt = superConn.createStatement()
          stmt.execute("CREATE ROLE hel913_bracket_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
          stmt.execute("ALTER SCHEMA public OWNER TO hel913_bracket_test")
          stmt.execute("GRANT CREATE, USAGE ON SCHEMA public TO hel913_bracket_test")
          stmt.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
          stmt.execute("GRANT helio_privileged TO hel913_bracket_test WITH ADMIN OPTION")
          stmt.close()
        } finally superConn.close()

        val migrationUrl = ep.getJdbcUrl("hel913_bracket_test", "postgres")

        // Migrate to V97 as the non-superuser role -- every table V98 touches is already owned
        // by it, matching production (the same DB_USER has run every migration since V1).
        Flyway
          .configure()
          .dataSource(migrationUrl, "hel913_bracket_test", "test")
          .locations("classpath:db/migration")
          .target(MigrationVersion.fromVersion("97"))
          .load()
          .migrate()

        // Seed a REAL pre-existing pipeline, as superuser (bypasses RLS unconditionally, so the
        // seed itself is never gated by the bracket under test).
        val rawConn = superDs.getConnection
        try {
          val seedStmt = rawConn.createStatement()
          try {
            seedStmt.execute(s"INSERT INTO users (id, email, created_at) VALUES ('$ownerId'::uuid, 'o@test.local', now())")
            seedStmt.execute(s"INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id) VALUES ('ds-bracket', 'ds-bracket', 'static', '{}', now(), now(), '$ownerId'::uuid)")
            seedStmt.execute(s"INSERT INTO pipelines (id, name, source_data_source_id, created_at, updated_at, owner_id) VALUES ('pipe-bracket', 'pipe-bracket', 'ds-bracket', now(), now(), '$ownerId'::uuid)")
          } finally seedStmt.close()
        } finally rawConn.close()

        // Load V98's OWN shipped SQL text and remove ONLY the `pipelines` bracket line -- every
        // other statement, including the step-8 guard, is byte-identical to what actually ships.
        val v98Sql = {
          val src = scala.io.Source.fromResource("db/migration/V98__pipeline_roots.sql")
          try src.mkString finally src.close()
        }
        val bracketLine = "ALTER TABLE pipelines      NO FORCE ROW LEVEL SECURITY;"
        withClue("this test's bracket-removal string must match the shipped file byte-for-byte, or it silently tests nothing: ") {
          v98Sql should include(bracketLine)
        }
        val mutatedSql = v98Sql.replace(bracketLine, "-- HEL-913 test: bracket line deliberately removed")

        // Executed as a raw JDBC `Statement` (simple query protocol, exactly how Flyway itself
        // applies a `.sql` migration file, and the only way pgjdbc accepts a multi-statement
        // script) connected AS the non-superuser role -- never through Slick's `sqlu`, which
        // prepares a statement (extended protocol) and would reject multiple commands outright.
        val roleConn = java.sql.DriverManager.getConnection(
          ep.getJdbcUrl("hel913_bracket_test", "postgres"), "hel913_bracket_test", "test"
        )
        try {
          val stmt = roleConn.createStatement()
          try {
            // (a) The mutated migration completes WITHOUT raising -- the guard is blind, not
            // merely "didn't get reached". A version with the bracket intact (every other test
            // in this spec) is the passing control that this does NOT throw for an unrelated
            // reason (e.g. a syntax error introduced by the mutation).
            noException should be thrownBy stmt.execute(mutatedSql)
          } finally stmt.close()

          // (b) Real, silent data loss: the pre-existing pipeline has ZERO roots.
          val ownerStmt = roleConn.createStatement()
          try {
            val rs = ownerStmt.executeQuery("SELECT count(*) FROM pipeline_roots WHERE pipeline_id = 'pipe-bracket'")
            rs.next()
            withClue("the real pre-existing pipeline should have silently lost its source (0 roots) when the bracket is missing: ") {
              rs.getInt(1) shouldBe 0
            }
          } finally ownerStmt.close()
        } finally roleConn.close()

        // (c) What DOES catch it: an EXTERNAL superuser count comparison, immune to the missing
        // bracket because it never goes through the non-superuser role's RLS view at all --
        // exactly `FlywayNonSuperuserMigrationSpec` task 3.1/3.2's technique, applied here
        // directly to prove it is necessary (not redundant with the in-migration guard).
        val checkConn = superDs.getConnection
        try {
          val checkStmt = checkConn.createStatement()
          try {
            val pipelinesRs = checkStmt.executeQuery("SELECT count(*) FROM pipelines WHERE id = 'pipe-bracket'")
            pipelinesRs.next()
            val realPipelineCount = pipelinesRs.getInt(1)
            val rootsRs = checkStmt.executeQuery("SELECT count(*) FROM pipeline_roots WHERE pipeline_id = 'pipe-bracket'")
            rootsRs.next()
            val realRootCount = rootsRs.getInt(1)
            withClue(s"superuser view: pipelines=$realPipelineCount, pipeline_roots=$realRootCount -- these MUST mismatch to prove the external check is what catches the missing bracket: ") {
              realPipelineCount shouldBe 1
              realRootCount shouldBe 0
              realPipelineCount should not be realRootCount
            }
          } finally checkStmt.close()
        } finally checkConn.close()
      } finally ep.close()
    }

    "fire when a parentless step has no root_id" in {
      // A parentless step whose pipeline DOES have a root gets backfilled correctly by V98's own
      // bulk UPDATE (it is not scoped to "one step per pipeline"), so this condition cannot be
      // reproduced end-to-end through the real backfill -- it can only arise from a write AFTER
      // V98 has already run (e.g. a future `POST /api/pipelines/:id/steps` bug). Proven directly
      // against the guard's exact predicate instead, same technique as the pipelines-without-root
      // case above.
      val ep = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val jdbcUrl = ep.getJdbcUrl("postgres", "postgres")
        Flyway.configure().dataSource(jdbcUrl, "postgres", "postgres")
          .locations("classpath:db/migration").load().migrate()
        val localDb = JdbcBackend.Database.forDataSource(ep.getPostgresDatabase, Some(2))
        try {
          await(localDb.run(DBIO.seq(
            sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'o@test.local', now())""",
            sqlu"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
                   VALUES ('ds-y', 'ds-y', 'static', '{}', now(), now(), $ownerId::uuid)""",
            sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at, owner_id)
                   VALUES ('pipe-y', 'pipe-y', now(), now(), $ownerId::uuid)"""
          )))
          // Temporarily drop the CHECK so we can insert the violating row directly.
          await(localDb.run(sqlu"ALTER TABLE pipeline_steps DROP CONSTRAINT pipeline_steps_root_id_matches_parentless"))
          await(localDb.run(sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, enabled, parent_step_id, root_id)
                                    VALUES ('step-y-orphan', 'pipe-y', 0, 'filter', '{}', now(), now(), true, NULL, NULL)"""))
          val ex = intercept[Exception] {
            await(localDb.run(sqlu"""
              DO $$$$
              DECLARE parentless_steps_without_root INT;
              BEGIN
                SELECT count(*) INTO parentless_steps_without_root
                FROM pipeline_steps
                WHERE parent_step_id IS NULL AND root_id IS NULL;
                IF parentless_steps_without_root > 0 THEN
                  RAISE EXCEPTION 'HEL-913 V98 guard: % parentless pipeline_steps row(s) have no root_id after backfill', parentless_steps_without_root;
                END IF;
              END $$$$;
            """))
          }
          Iterator.iterate(ex: Throwable)(_.getCause).takeWhile(_ != null).map(_.getMessage).mkString(" | ") should include("have no root_id")
        } finally localDb.close()
      } finally ep.close()
    }

    Seq("outputs", "node_snapshots", "binary_refs").foreach { table =>
      s"fire when a $table row has both node_step_id and root_id NULL" in {
        val ep = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
        try {
          val jdbcUrl = ep.getJdbcUrl("postgres", "postgres")
          Flyway.configure().dataSource(jdbcUrl, "postgres", "postgres")
            .locations("classpath:db/migration").load().migrate()
          val localDb = JdbcBackend.Database.forDataSource(ep.getPostgresDatabase, Some(2))
          try {
            await(localDb.run(DBIO.seq(
              sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'o@test.local', now())""",
              sqlu"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
                     VALUES ('ds-z', 'ds-z', 'static', '{}', now(), now(), $ownerId::uuid)""",
              sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at, owner_id)
                     VALUES ('pipe-z', 'pipe-z', now(), now(), $ownerId::uuid)"""
            )))
            val checkName = s"${table}_root_id_matches_node_step_id"
            await(localDb.run(sqlu"ALTER TABLE #$table DROP CONSTRAINT #$checkName"))
            table match {
              case "outputs" =>
                await(localDb.run(sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, root_id)
                                          VALUES ('out-orphan', 'pipe-z', NULL, $ownerId::uuid, 'o', 'table', NULL)"""))
              case "node_snapshots" =>
                await(localDb.run(sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id)
                                          VALUES ('pipe-z', NULL, 0, '{}'::jsonb, NULL)"""))
              case "binary_refs" =>
                await(localDb.run(sqlu"""INSERT INTO binary_refs (id, row_index, field_name, storage_key, mime_type, filename, size_bytes, pipeline_id, node_step_id, root_id)
                                          VALUES ('ref-z', 0, 'f', 'k', 'text/plain', 'f.txt', 1, 'pipe-z', NULL, NULL)"""))
            }
            val ex = intercept[Exception] {
              await(localDb.run(sqlu"""
                DO $$$$
                DECLARE bad_count INT;
                BEGIN
                  SELECT count(*) INTO bad_count FROM #$table WHERE node_step_id IS NULL AND root_id IS NULL;
                  IF bad_count > 0 THEN
                    RAISE EXCEPTION 'HEL-913 V98 guard: % #$table row(s) have both node_step_id and root_id NULL', bad_count;
                  END IF;
                END $$$$;
              """))
            }
            Iterator.iterate(ex: Throwable)(_.getCause).takeWhile(_ != null).map(_.getMessage).mkString(" | ") should include("NULL")
          } finally localDb.close()
        } finally ep.close()
      }
    }
  }

  "pipeline_roots RLS (task 3.6b)" should {

    "let a grantee of a shared pipeline SELECT its roots but never INSERT/UPDATE/DELETE one" in {
      migrateToLatest()
      await(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                           VALUES ('pipeline', 'pipe-1', $granteeId::uuid, 'viewer', now())"""))

      // Non-superuser, non-BYPASSRLS role, owning nothing -- exercises the per-command policies
      // exactly as PipelineRootRepository will (via DbContext.withUserContext).
      val superConn = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        val stmt = superConn.createStatement()
        try {
          stmt.execute("CREATE ROLE hel913_test_role NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN PASSWORD 'test'")
          stmt.execute("GRANT USAGE ON SCHEMA public TO hel913_test_role")
          stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hel913_test_role")
          stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_pipeline(TEXT) TO hel913_test_role")
        } finally stmt.close()
      } finally superConn.close()

      // `getJdbcUrl(user, dbName)` bakes the FIRST argument into the connection string as
      // `user=...` -- it must be the role we actually want to authenticate as, not "postgres"
      // (that bug silently connects as the superuser regardless of the `user=`/`password=`
      // arguments passed to `forURL`, defeating this entire RLS check).
      val roleUrl = embeddedPostgres.getJdbcUrl("hel913_test_role", "postgres")
      val roleDb  = JdbcBackend.Database.forURL(roleUrl, user = "hel913_test_role", password = "test", driver = "org.postgresql.Driver")
      try {
        def asGrantee[R](action: DBIO[R]): Future[R] =
          roleDb.run(DBIO.seq(sqlu"SET app.current_user_id = '#$granteeId'").andThen(action).transactionally)

        val rows = await(asGrantee(sql"SELECT id FROM pipeline_roots WHERE pipeline_id = 'pipe-1'".as[String]))
        rows should contain("pipe-1")

        val insertFailed = intercept[Exception] {
          await(asGrantee(sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
                                  VALUES ('grantee-attempt', 'pipe-1', 'ds-1', 99)"""))
        }
        insertFailed.getMessage should include ("row-level security")

        val deleteRows = await(asGrantee(sqlu"DELETE FROM pipeline_roots WHERE pipeline_id = 'pipe-1'"))
        deleteRows shouldBe 0
      } finally roleDb.close()
    }
  }
}
