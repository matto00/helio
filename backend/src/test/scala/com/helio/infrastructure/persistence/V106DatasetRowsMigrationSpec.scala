package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1074 tasks.md 5.3: edge-case coverage for V106's `dataset_rows` backfill that the real
 *  `hel904-real-dump.sql` fixture does not itself contain (that fixture is exercised separately,
 *  by `FlywayNonSuperuserMigrationSpec`, against `MyManualSource`/`acl-smoke-static`). Seeds each
 *  edge case directly, as a genuine non-superuser role (mirrors `V96CanonicalizeInferredSchema
 *  TypeMigrationSpec`'s recipe), so the exact shape under test is unambiguous rather than
 *  depending on what happens to be in the shared dump. */
class V106DatasetRowsMigrationSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  "V106 dataset_rows migration, run as a non-superuser role, on edge-case pre-existing static sources" should {

    "migrate config = '{}' to zero dataset_rows and dataset_schema: [], migrate a duplicate-column-name source losslessly (positional, no collapse), and migrate a ragged row verbatim" in {
      val embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val superDs   = embeddedPostgres.getPostgresDatabase
        val superConn = superDs.getConnection
        try {
          val stmt = superConn.createStatement()
          stmt.execute("CREATE ROLE hel1074_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
          stmt.execute("ALTER SCHEMA public OWNER TO hel1074_migration_test")
          stmt.execute("GRANT CREATE, USAGE ON SCHEMA public TO hel1074_migration_test")
          stmt.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
          stmt.execute("GRANT helio_privileged TO hel1074_migration_test WITH ADMIN OPTION")
          stmt.close()
        } finally superConn.close()

        val migrationUrl = embeddedPostgres.getJdbcUrl("hel1074_migration_test", "postgres")

        // Migrate to V105 (pre-V106) as the non-superuser role.
        Flyway
          .configure()
          .dataSource(migrationUrl, "hel1074_migration_test", "test")
          .locations("classpath:db/migration")
          .target(MigrationVersion.fromVersion("105"))
          .load()
          .migrate()

        val ownerId = "22222222-2222-2222-2222-222222222222"

        val seedDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        try {
          await(
            seedDb.run(
              DBIO.seq(
                sqlu"""INSERT INTO users (id, email, password_hash, created_at, updated_at)
                       VALUES ($ownerId::uuid, 'hel1074@example.com', 'x', now(), now())""",
                // Edge case 1: config = '{}' -- the pre-existing rename-wipes-rows state
                // (design.md Decision 2, round 2). Must migrate to zero dataset_rows and
                // dataset_schema: [], not NULL or a migration failure.
                sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                       VALUES ('hel1074-empty-config', 'wiped by rename', 'static', '{}'::jsonb, $ownerId::uuid, now(), now())""",
                // Edge case 2: a duplicate declared column name. Since `data` is a positional
                // array (design.md Decision 3), this must migrate losslessly -- no collapse to
                // one key, unlike an object-keyed store would.
                sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                       VALUES ('hel1074-dup-column', 'duplicate column name', 'static',
                               '{"columns":[{"name":"x","type":"string"},{"name":"x","type":"integer"}],"rows":[["a",1],["b",2]]}'::jsonb,
                               $ownerId::uuid, now(), now())""",
                // Edge case 3: a row shorter than `columns` (ragged). The positional copy must
                // preserve exactly what the blob held -- `readDatasetRows` must return it
                // unchanged, not silently padded/truncated.
                sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                       VALUES ('hel1074-ragged-row', 'ragged row', 'static',
                               '{"columns":[{"name":"a","type":"string"},{"name":"b","type":"string"},{"name":"c","type":"string"}],"rows":[["only-one"]]}'::jsonb,
                               $ownerId::uuid, now(), now())"""
              )
            )
          )
        } finally seedDb.close()

        // ── Migrate to latest (applies V106) as the SAME non-superuser role ──
        noException should be thrownBy {
          Flyway
            .configure()
            .dataSource(migrationUrl, "hel1074_migration_test", "test")
            .locations("classpath:db/migration")
            .load()
            .migrate()
        }

        val afterDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        try {
          // Edge case 1: config = '{}'
          val emptySourceType = await(afterDb.run(sql"SELECT source_type FROM data_sources WHERE id = 'hel1074-empty-config'".as[String].head))
          emptySourceType shouldBe "dataset"
          val emptySchema = await(afterDb.run(sql"SELECT dataset_schema::text FROM data_sources WHERE id = 'hel1074-empty-config'".as[String].head))
          emptySchema.parseJson shouldBe JsArray.empty
          val emptyRowCount = await(afterDb.run(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = 'hel1074-empty-config'".as[Int].head))
          emptyRowCount shouldBe 0

          // Edge case 2: duplicate column name -- both columns survive in dataset_schema, and
          // every row's positional array is untouched (no collapse to one key).
          val dupSchema = await(afterDb.run(sql"SELECT dataset_schema::text FROM data_sources WHERE id = 'hel1074-dup-column'".as[String].head))
          dupSchema.parseJson shouldBe """[{"name":"x","type":"string"},{"name":"x","type":"integer"}]""".parseJson
          val dupRows = await(
            afterDb.run(sql"SELECT data::text FROM dataset_rows WHERE data_source_id = 'hel1074-dup-column' ORDER BY seq".as[String])
          )
          dupRows.map(_.parseJson) shouldBe Vector("""["a",1]""".parseJson, """["b",2]""".parseJson)

          // Edge case 3: a ragged row -- the migration and readDatasetRows-equivalent raw read
          // must preserve the row exactly as stored (one element, not padded to three).
          val raggedRows = await(
            afterDb.run(sql"SELECT data::text FROM dataset_rows WHERE data_source_id = 'hel1074-ragged-row' ORDER BY seq".as[String])
          )
          raggedRows.map(_.parseJson) shouldBe Vector("""["only-one"]""".parseJson)

          // Every migrated row's config is cleared, whether or not it had real content.
          for (id <- Seq("hel1074-empty-config", "hel1074-dup-column", "hel1074-ragged-row")) {
            val cfg = await(afterDb.run(sql"SELECT config::text FROM data_sources WHERE id = $id".as[String].head))
            withClue(s"config should be cleared for migrated row '$id': ") { cfg.parseJson shouldBe JsObject.empty }
          }
        } finally afterDb.close()
      } finally embeddedPostgres.close()
    }
  }
}
