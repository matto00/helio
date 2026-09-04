package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.postgresql.util.PSQLException
import org.scalatest.BeforeAndAfterEach
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-913 (skeptic-final-2.md FIX 1): re-runs the skeptic's own live-DB repro on a fresh,
 *  fully-migrated embedded Postgres, so it is a real gate rather than a one-off manual check.
 *
 *  V22 had `pipelines.source_data_source_id ... ON DELETE CASCADE` -- deleting a `DataSource`
 *  deleted the whole pipeline. V98 re-homed that cascade onto `pipeline_roots.data_source_id
 *  ... ON DELETE CASCADE` -- deleting a `DataSource` now deletes only ONE root, and can leave a
 *  still-existing pipeline with zero roots (R1's own "not a representable state" falsified).
 *  V99's `hel913_prevent_zero_root_pipelines` trigger closes this at the DB level, for every
 *  writer, not only `PipelineService.removeRoot`'s own last-root guard (which this exact
 *  cascade path never goes through at all).
 *
 *  Runs as the `postgres` superuser: this is a DATA-correctness proof (does the trigger fire,
 *  and only when it should), not an RLS-enforcement proof -- that class of concern is
 *  `FlywayNonSuperuserMigrationSpec`'s job, mirroring `V98PipelineRootsMigrationSpec`'s own
 *  stated split. */
class V99PreventZeroRootPipelinesMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterEach {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _

  private val ownerId = UUID.randomUUID().toString

  override def beforeEach(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure().dataSource(jdbcUrl, "postgres", "postgres").locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'v99@test.local', now())"""))
  }

  override def afterEach(): Unit = { db.close(); embeddedPostgres.close() }

  /** Seeds one pipeline with `rootCount` roots (each its own real `data_sources` row) and one
   *  root-bound Output on the FIRST root. Returns `(pipelineId, firstRootDataSourceId)`. */
  private def seedPipeline(rootCount: Int): (String, String) = {
    val pid = UUID.randomUUID().toString
    val dsIds = Vector.fill(rootCount)(UUID.randomUUID().toString)
    val cfg = """{"columns":[],"rows":[]}"""
    val rootInserts = dsIds.zipWithIndex.map { case (dsId, idx) =>
      DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, ${"ds-" + idx}, 'static', $cfg, $ownerId::uuid, now(), now())""",
        sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
               VALUES (${UUID.randomUUID().toString}, $pid, $dsId, $idx)"""
      )
    }
    val outputId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      DBIO.seq(sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())"""),
      DBIO.seq(rootInserts: _*),
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, root_id)
             VALUES ($outputId, $pid, NULL, $ownerId::uuid, 'out', 'table', (SELECT id FROM pipeline_roots WHERE pipeline_id = $pid ORDER BY position LIMIT 1))"""
    )))
    (pid, dsIds.head)
  }

  private def countRows(sql: String): Int = await(db.run(sql"#$sql".as[Int])).head

  "V99's hel913_prevent_zero_root_pipelines trigger" should {

    "raises and rolls back when deleting a DataSource would leave a still-existing pipeline with zero roots" in {
      val (pid, soleRootDsId) = seedPipeline(rootCount = 1)
      countRows(s"SELECT COUNT(*) FROM pipelines WHERE id = '$pid'") shouldEqual 1
      countRows(s"SELECT COUNT(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldEqual 1
      countRows(s"SELECT COUNT(*) FROM outputs WHERE pipeline_id = '$pid'") shouldEqual 1

      // This is the skeptic's own repro: DELETE FROM data_sources WHERE id = <the sole root's
      // source>, which pre-V99 cascaded to pipeline_roots then outputs, leaving
      // pipelines_after=1, roots_after=0, outputs_after=0 -- silent R1 violation.
      val ex = intercept[PSQLException] {
        await(db.run(sqlu"DELETE FROM data_sources WHERE id = $soleRootDsId"))
      }
      ex.getMessage should include("HEL-913")
      ex.getMessage should include(pid)

      // The whole statement (and its cascade) rolled back -- nothing was touched, not even
      // partially. `pipelines_after`/`roots_after`/`outputs_after` are CONSISTENT (the pipeline
      // still has its one root and its one Output), the other way from the skeptic's repro.
      countRows(s"SELECT COUNT(*) FROM pipelines WHERE id = '$pid'") shouldEqual 1
      countRows(s"SELECT COUNT(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldEqual 1
      countRows(s"SELECT COUNT(*) FROM outputs WHERE pipeline_id = '$pid'") shouldEqual 1
      countRows(s"SELECT COUNT(*) FROM data_sources WHERE id = '$soleRootDsId'") shouldEqual 1
    }

    "permits deleting a DataSource that is one of SEVERAL roots -- the pipeline survives with the remaining root(s)" in {
      val (pid, firstRootDsId) = seedPipeline(rootCount = 2)

      noException should be thrownBy await(db.run(sqlu"DELETE FROM data_sources WHERE id = $firstRootDsId"))

      countRows(s"SELECT COUNT(*) FROM pipelines WHERE id = '$pid'") shouldEqual 1
      countRows(s"SELECT COUNT(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldEqual 1
    }

    "permits deleting the WHOLE pipeline, whose roots cascade along with it -- never raises for its own roots" in {
      val (pid, _) = seedPipeline(rootCount = 1)

      noException should be thrownBy await(db.run(sqlu"DELETE FROM pipelines WHERE id = $pid"))

      countRows(s"SELECT COUNT(*) FROM pipelines WHERE id = '$pid'") shouldEqual 0
      countRows(s"SELECT COUNT(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldEqual 0
    }

    "permits removing a root directly (DELETE FROM pipeline_roots) when 2+ roots remain, refuses the last one the same way" in {
      val (pid, _) = seedPipeline(rootCount = 2)
      val rootIds = await(db.run(sql"SELECT id FROM pipeline_roots WHERE pipeline_id = $pid ORDER BY position".as[String]))

      noException should be thrownBy await(db.run(sqlu"DELETE FROM pipeline_roots WHERE id = ${rootIds(0)}"))
      countRows(s"SELECT COUNT(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldEqual 1

      val ex = intercept[PSQLException] {
        await(db.run(sqlu"DELETE FROM pipeline_roots WHERE id = ${rootIds(1)}"))
      }
      ex.getMessage should include("HEL-913")
      countRows(s"SELECT COUNT(*) FROM pipeline_roots WHERE pipeline_id = '$pid'") shouldEqual 1
    }
  }
}
