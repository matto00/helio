package com.helio.infrastructure

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.SQLException
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Integration test for the V63 migration (pipeline_run_trigger_source,
 *  HEL-417): pre-existing `pipeline_runs` rows (seeded before V63 runs)
 *  backfill to `trigger_source = 'manual'`, and the CHECK constraint rejects
 *  anything outside `manual`/`scheduled`/`external`.
 *
 *  Flyway is staged in two steps — migrate to V62, seed a fixture directly
 *  against that pre-V63 schema (no `trigger_source` column yet), then
 *  migrate the rest of the way (V63) — mirroring
 *  `PipelineOnlyPanelBindingMigrationSpec`'s staged-migration pattern so the
 *  migration runs against exactly the shape it targets in production. */
class TriggerSourceMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val ownerId    = UUID.randomUUID().toString
  private val dsId       = UUID.randomUUID().toString
  private val dtId       = UUID.randomUUID().toString
  private val pipelineId = UUID.randomUUID().toString
  private val preExistingRunId = UUID.randomUUID().toString

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")

    // Stage 1: migrate up to V62 only -- the pre-V63 schema shape (no
    // trigger_source column).
    Flyway.configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .target("62")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    seedPreV63Fixture()

    // Stage 2: apply V63 (and any later migrations) against the seeded fixture.
    Flyway.configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def seedPreV63Fixture(): Unit =
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($ownerId::uuid, 'v63-migration-test@helio.internal', now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'src', 'static', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, 'dt', '[]'::jsonb, 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
             VALUES ($pipelineId, 'pipe', $dsId, $dtId, $ownerId::uuid, now(), now())""",
      // No trigger_source column exists at this schema version yet.
      sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, row_count, error_log)
             VALUES ($preExistingRunId, $pipelineId, 'succeeded', now(), now(), 5, NULL)"""
    )))

  "V63 migration" should {

    "backfill a pre-existing pipeline_runs row to trigger_source = 'manual'" in {
      val triggerSource = await(db.run(
        sql"SELECT trigger_source FROM pipeline_runs WHERE id = $preExistingRunId".as[String].head
      ))
      triggerSource shouldBe "manual"
    }

    "accept an insert with trigger_source = 'scheduled'" in {
      val runId = UUID.randomUUID().toString
      await(db.run(
        sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, trigger_source)
               VALUES ($runId, $pipelineId, 'queued', now(), 'scheduled')"""
      ))
      val triggerSource = await(db.run(
        sql"SELECT trigger_source FROM pipeline_runs WHERE id = $runId".as[String].head
      ))
      triggerSource shouldBe "scheduled"
    }

    "reject an insert with an invalid trigger_source via the CHECK constraint" in {
      val runId = UUID.randomUUID().toString
      val result = db.run(
        sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, trigger_source)
               VALUES ($runId, $pipelineId, 'queued', now(), 'bogus')"""
      )
      a[SQLException] should be thrownBy await(result)
    }
  }
}
