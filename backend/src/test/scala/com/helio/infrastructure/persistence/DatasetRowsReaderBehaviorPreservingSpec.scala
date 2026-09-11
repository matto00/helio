package com.helio.infrastructure.persistence

import com.helio.domain.engine.PipelineRowJson
import com.helio.domain.model.DataSourceId
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.io.Source

/** HEL-1074 (skeptic-final-1.md CR1 / design.md Decision 9's concrete verification mechanism):
 *  the literal before/after reader-behavior-preservation proof design.md and tasks.md 3.7 both
 *  require, against the REAL `hel904-real-dump.sql` fixture -- not a mock, not a hand-built
 *  fixture, and not merely rows this test itself inserted.
 *
 *  Every other spec touching `readDatasetRows` either mocks it (`InProcessPipelineEngineSpec`,
 *  `SparkJobSubmitterSpec`), only reads back rows `insertDatasetSource` itself wrote
 *  (`DataSourceRepositorySpec`), or checks raw table content without calling any reader
 *  (`FlywayNonSuperuserMigrationSpec`, for one source). This spec is the missing piece: it loads
 *  the dump at the PRE-migration schema (`target("105")`), captures each legacy reader's actual
 *  output for EVERY real `static` source the dump contains (including the NULL-owner
 *  `MyManualSource` and the `"number"`-typed `HEL-315 offers src`/`skeptic-src`), migrates to
 *  latest, then re-runs the REAL post-migration reader (`DataSourceRepository.readDatasetRows`,
 *  a live call against the migrated DB -- not a mock) and asserts exact equality.
 *
 *  Golden capture happens on the PRE-migration `config` blob directly, using
 *  `PipelineRowJson.parseStaticRows(raw: String)` (real, unmodified production code -- the
 *  `raw`-taking overload this ticket did not touch) and the same header/row-string projection
 *  `DataSourceService.previewStatic` applies (replicated here as a pure function of the
 *  `{columns, rows}` shape, since `previewStatic` itself is private and, post-migration, reads
 *  `dataset_rows`, not `config` -- there is no live pre-migration call site left to invoke
 *  directly, per design.md Decision 9's own "previously unexecutable" framing). Post-migration,
 *  the SAME `parseStaticRows` function and the SAME projection run against the REAL
 *  `readDatasetRows` result -- so the "reader" under test on each side is byte-for-byte the same
 *  code, differing only in which store it reads. */
class DatasetRowsReaderBehaviorPreservingSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  /** Mirrors `DataSourceService.previewStatic`'s header/row-string projection exactly (that
   *  method is private and, post-migration, reads `dataset_rows` rather than a raw `config`
   *  blob -- there is no live call site left that can be invoked directly against a PRE-migration
   *  `config` string). Applied identically to both the pre-migration `config` blob and the
   *  post-migration `readDatasetRows` result below, so it exercises the same transform on both
   *  sides rather than two independently-written implementations. */
  private def previewProjection(obj: JsObject): (Vector[String], Vector[Vector[String]]) = {
    val headers = obj.fields.get("columns")
      .map(_.convertTo[Vector[JsObject]].map(_.fields("name").convertTo[String]))
      .getOrElse(Vector.empty)
    val rows = obj.fields.get("rows")
      .map(_.convertTo[Vector[Vector[JsValue]]].map(_.map {
        case JsString(s)  => s
        case JsNumber(n)  => n.toString
        case JsBoolean(b) => b.toString
        case JsNull       => ""
        case other        => other.compactPrint
      }))
      .getOrElse(Vector.empty)
    (headers, rows)
  }

  private case class Golden(rows: Seq[PipelineRowJson.Row], preview: (Vector[String], Vector[Vector[String]]), columns: JsValue)

  "the HEL-1074 dataset_rows migration" should {

    "preserve every legacy reader's output for every real static source in hel904-real-dump.sql (before/after, design.md Decision 9)" in {
      val embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")

        // Migrate to V93 (pre-V94) as the embedded superuser -- `hel904-real-dump.sql` is shaped
        // for the PRE-V94 schema (it inserts into `data_types`/`data_type_rows`/`metrics`, all
        // dropped by V94), exactly like `FlywayNonSuperuserMigrationSpec`'s own recipe. This spec
        // proves DATA/reader behavior preservation, not RLS enforcement (that is
        // `FlywayNonSuperuserMigrationSpec`'s and `RlsOwnerTablesSpec`'s job, per the skeptic's
        // own drawn distinction), so the plain superuser role `V94OutputsMigrationSpec` also uses
        // is the right harness here.
        Flyway
          .configure()
          .dataSource(jdbcUrl, "postgres", "postgres")
          .locations("classpath:db/migration")
          .target(MigrationVersion.fromVersion("93"))
          .load()
          .migrate()

        val rawConn = embeddedPostgres.getPostgresDatabase.getConnection
        try {
          val truncStmt = rawConn.createStatement()
          try
            truncStmt.execute(
              """TRUNCATE TABLE users, data_sources, data_types, pipelines, pipeline_steps, panels,
                |dashboards, metrics, binary_refs, data_type_rows, patch_set_applications
                |RESTART IDENTITY CASCADE""".stripMargin
            )
          finally truncStmt.close()

          val dumpSql = {
            val src = Source.fromResource("db/fixtures/hel904-real-dump.sql")
            try src.mkString finally src.close()
          }
          val dumpStmt = rawConn.createStatement()
          try dumpStmt.execute(dumpSql)
          finally dumpStmt.close()

          // Same restore as FlywayNonSuperuserMigrationSpec -- the dump's own header resets
          // `search_path` to '', which would break every unqualified statement on this same
          // connection for the rest of its life otherwise.
          val resetSearchPathStmt = rawConn.createStatement()
          try resetSearchPathStmt.execute("SET search_path TO public")
          finally resetSearchPathStmt.close()
        } finally rawConn.close()

        // Advance through V94..V105 (every migration up to, but not including, the one under
        // test) as the same superuser connection -- this is what actually gets the dump's rows
        // (still shaped as `source_type = 'static'`, `config` populated) into the PRE-V106
        // schema shape this spec needs to capture golden output from.
        Flyway
          .configure()
          .dataSource(jdbcUrl, "postgres", "postgres")
          .locations("classpath:db/migration")
          .target(MigrationVersion.fromVersion("105"))
          .load()
          .migrate()

        val preDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        val (staticIds, golden) = try {
          val rows = await(preDb.run(sql"SELECT id, config::text FROM data_sources WHERE source_type = 'static'".as[(String, String)]))
          withClue("fixture sanity -- real static sources found in hel904-real-dump.sql: ") { rows.size should be > 0 }
          // The two known "number"-declared-type and the NULL-owner sources design.md/skeptic
          // name explicitly must be present in the captured set, not merely somewhere in the dump.
          val ids = rows.map(_._1).toSet
          withClue("fixture sanity -- MyManualSource (NULL owner) present: ") { ids should contain("18dc0d3b-ad44-48cd-bc1d-f066726fc0f1") }
          withClue("fixture sanity -- 'HEL-315 offers src' ('number'-typed) present: ")   { ids should contain("47cf396b-7770-4f31-9623-a83c619b2ecf") }
          withClue("fixture sanity -- 'skeptic-src' ('number'-typed) present: ")           { ids should contain("0b1ddac5-7b7f-47c1-bf90-f597011b2901") }

          val goldenById = rows.map { case (id, rawConfig) =>
            val obj = rawConfig.parseJson.asJsObject
            id -> Golden(
              rows    = PipelineRowJson.parseStaticRows(rawConfig),
              preview = previewProjection(obj),
              columns = obj.fields.getOrElse("columns", JsArray.empty)
            )
          }.toMap
          (rows.map(_._1), goldenById)
        } finally preDb.close()

        // ── Migrate to latest (applies V106) ────────────────────────────────────────────────
        noException should be thrownBy {
          Flyway.configure().dataSource(jdbcUrl, "postgres", "postgres").locations("classpath:db/migration").load().migrate()
        }

        val postDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(4))
        try {
          val ctx  = new DbContext(postDb, postDb)
          val repo = new DataSourceRepository(ctx)

          // Every id must have been rewritten to 'dataset', none stranded as 'static'.
          val stillStatic = await(postDb.run(sql"SELECT count(*) FROM data_sources WHERE source_type = 'static'".as[Int].head))
          withClue("no data_sources row should still carry the legacy 'static' value after V106: ") { stillStatic shouldBe 0 }

          for (id <- staticIds) {
            val obj = await(repo.readDatasetRows(DataSourceId(id))).getOrElse(
              fail(s"readDatasetRows returned None for migrated source $id -- every migrated static source must still resolve")
            )
            val expected = golden(id)

            withClue(s"[$id] engine rows (PipelineRowJson.parseStaticRows) must match pre-migration exactly, in order: ") {
              PipelineRowJson.parseStaticRows(obj) shouldBe expected.rows
            }
            withClue(s"[$id] preview headers/rows must match pre-migration exactly: ") {
              previewProjection(obj) shouldBe expected.preview
            }
            withClue(s"[$id] Spark-relevant declared columns[].{name,type} must match pre-migration exactly (dataset_schema, not inferred_schema): ") {
              obj.fields.getOrElse("columns", JsArray.empty) shouldBe expected.columns
            }
          }
        } finally postDb.close()
      } finally embeddedPostgres.close()
    }
  }
}
