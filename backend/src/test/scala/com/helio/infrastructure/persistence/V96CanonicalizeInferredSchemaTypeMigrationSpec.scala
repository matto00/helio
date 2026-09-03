package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-932: proves V96 backfills the non-canonical `"number"` column type
 *  historically written into `data_sources.inferred_schema` before HEL-906
 *  closed the write path (every route-reachable caller-supplied column-type
 *  string now goes through `DataFieldType.canonicalizeLegacy` /
 *  `validateAndCanonicalize`, which maps `"number"` -> `"float"`).
 *
 *  Follows the `FlywayNonSuperuserMigrationSpec` recipe (HEL-943): migrates
 *  as a genuine `LOGIN NOSUPERUSER NOBYPASSRLS` role that owns the schema,
 *  matching production's `helio` DB_USER against `data_sources`' FORCE ROW
 *  LEVEL SECURITY (V35) -- a superuser run would bypass RLS unconditionally
 *  and prove nothing about whether V96's own `NO FORCE`/`FORCE` bracket
 *  actually works. Seeds rows directly (not the shared `hel904-real-dump.sql`
 *  fixture) so the exact non-canonical shape this ticket targets, including
 *  a field literally NAMED "number", is unambiguous in this file rather than
 *  depending on what happens to be in the dump.
 */
class V96CanonicalizeInferredSchemaTypeMigrationSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  "V96 canonicalize inferred_schema type migration, run as a non-superuser role" should {

    "rewrite legacy \"number\" types to \"float\", leave canonical rows and a field named \"number\" untouched, and be idempotent" in {
      val embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val superDs   = embeddedPostgres.getPostgresDatabase
        val superConn = superDs.getConnection
        try {
          val stmt = superConn.createStatement()
          stmt.execute("CREATE ROLE hel932_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
          stmt.execute("ALTER SCHEMA public OWNER TO hel932_migration_test")
          stmt.execute("GRANT CREATE, USAGE ON SCHEMA public TO hel932_migration_test")
          stmt.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
          stmt.execute("GRANT helio_privileged TO hel932_migration_test WITH ADMIN OPTION")
          stmt.close()
        } finally superConn.close()

        val migrationUrl = embeddedPostgres.getJdbcUrl("hel932_migration_test", "postgres")

        // Migrate to V95 (pre-V96) as the non-superuser role -- data_sources is
        // already owned by hel932_migration_test, matching production where the
        // same DB_USER has run every migration since V1.
        Flyway
          .configure()
          .dataSource(migrationUrl, "hel932_migration_test", "test")
          .locations("classpath:db/migration")
          .target(MigrationVersion.fromVersion("95"))
          .load()
          .migrate()

        val ownerId = "11111111-1111-1111-1111-111111111111"

        // Seed as the migration role itself (table owner bypasses RLS while
        // NOT forced -- irrelevant to app.current_user_id either way): one
        // legacy-shaped row ("number"), one already-canonical row ("float",
        // untouched control), and one row with a FIELD NAMED "number" whose
        // own type is already canonical -- proves the JSON-aware rewrite
        // only ever touches the `type` value position, never a field name or
        // an unrelated data value that happens to contain the text "number".
        val seedDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        try {
          await(
            seedDb.run(
              DBIO.seq(
                sqlu"""INSERT INTO users (id, email, password_hash, created_at, updated_at)
                       VALUES ($ownerId::uuid, 'hel932@example.com', 'x', now(), now())""",
                sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, inferred_schema, created_at, updated_at)
                       VALUES ('hel932-legacy', 'legacy number source', 'static', '{}'::jsonb, $ownerId::uuid,
                               '[{"name":"amount","type":"number"},{"name":"label","type":"string"}]'::jsonb, now(), now())""",
                sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, inferred_schema, created_at, updated_at)
                       VALUES ('hel932-canonical', 'already canonical source', 'static', '{}'::jsonb, $ownerId::uuid,
                               '[{"name":"amount","type":"float"}]'::jsonb, now(), now())""",
                sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, inferred_schema, created_at, updated_at)
                       VALUES ('hel932-field-named-number', 'field literally named number', 'static', '{}'::jsonb, $ownerId::uuid,
                               '[{"name":"number","type":"integer"}]'::jsonb, now(), now())"""
              )
            )
          )
        } finally seedDb.close()

        // ── BEFORE ────────────────────────────────────────────────────────
        val beforeDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        val beforeLegacy = try
          await(beforeDb.run(sql"SELECT inferred_schema::text FROM data_sources WHERE id = 'hel932-legacy'".as[String].head))
        finally beforeDb.close()
        // scalastyle:off println
        println(s"[HEL-932] BEFORE hel932-legacy.inferred_schema = $beforeLegacy")
        // scalastyle:on println
        beforeLegacy should include("\"type\": \"number\"")

        // ── Migrate to latest (applies V96) as the SAME non-superuser role ──
        noException should be thrownBy {
          Flyway
            .configure()
            .dataSource(migrationUrl, "hel932_migration_test", "test")
            .locations("classpath:db/migration")
            .load()
            .migrate()
        }

        val afterDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        try {
          val afterLegacy =
            await(afterDb.run(sql"SELECT inferred_schema::text FROM data_sources WHERE id = 'hel932-legacy'".as[String].head))
          // scalastyle:off println
          println(s"[HEL-932] AFTER  hel932-legacy.inferred_schema = $afterLegacy")
          // scalastyle:on println
          afterLegacy should include("\"type\": \"float\"")
          afterLegacy should not include "\"type\": \"number\""
          afterLegacy should include("\"name\": \"amount\"")
          afterLegacy should include("\"name\": \"label\"")
          afterLegacy should include("\"type\": \"string\"") // sibling field untouched

          val afterCanonical =
            await(afterDb.run(sql"SELECT inferred_schema::text FROM data_sources WHERE id = 'hel932-canonical'".as[String].head))
          afterCanonical should include("\"type\": \"float\"")

          val afterFieldNamedNumber =
            await(afterDb.run(sql"SELECT inferred_schema::text FROM data_sources WHERE id = 'hel932-field-named-number'".as[String].head))
          // The field NAME "number" must survive; only a `type` VALUE of "number" is rewritten.
          afterFieldNamedNumber should include("\"name\": \"number\"")
          afterFieldNamedNumber should include("\"type\": \"integer\"")

          // data_sources' FORCE ROW LEVEL SECURITY posture must be unchanged after V96.
          val forced = await(
            afterDb.run(
              sql"""SELECT relforcerowsecurity FROM pg_class WHERE relname = 'data_sources' AND relkind = 'r'"""
                .as[Boolean]
                .head
            )
          )
          withClue("data_sources should still have FORCE ROW LEVEL SECURITY set after V96: ") { forced shouldBe true }
        } finally afterDb.close()

        // ── Re-run: Flyway itself refuses to re-apply an already-applied
        // versioned migration, so idempotency is proven by re-running the
        // SAME UPDATE statement's WHERE clause directly and confirming it
        // now matches zero rows (a second application would be a no-op). ──
        val idempotencyDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        try {
          val stillNonCanonical = await(
            idempotencyDb.run(
              sql"""SELECT count(*) FROM data_sources ds
                    WHERE EXISTS (
                      SELECT 1 FROM jsonb_array_elements(ds.inferred_schema) AS e(value)
                      WHERE e.value ->> 'type' = 'number'
                    )"""
                .as[Int]
                .head
            )
          )
          withClue("re-running V96's UPDATE predicate should match zero rows: ") { stillNonCanonical shouldBe 0 }
        } finally idempotencyDb.close()
      } finally embeddedPostgres.close()
    }
  }
}
