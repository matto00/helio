package com.helio.infrastructure

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Integration test for the V41 migration (enforce-pipeline-only-bindings,
 *  design D1 / task 3.2): a panel-bound companion DataType is converted into
 *  a pipeline-output type, with a pass-through pipeline and a replacement
 *  companion DataType inserted for the source; an unbound companion type is
 *  left untouched.
 *
 *  Flyway is staged in two steps — migrate to V40, seed the pre-V41 fixture
 *  directly against that schema, then migrate the rest of the way (V41) —
 *  so the migration runs against exactly the shape it targets in production,
 *  rather than a schema that already has V41's output baked in. */
class PipelineOnlyPanelBindingMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val ownerId = UUID.randomUUID().toString

  private val boundSourceId   = UUID.randomUUID().toString
  private val boundTypeId     = UUID.randomUUID().toString
  private val dashboardId     = s"dash-${UUID.randomUUID()}"
  private val panelId         = s"panel-${UUID.randomUUID()}"
  private val unboundSourceId = UUID.randomUUID().toString
  private val unboundTypeId   = UUID.randomUUID().toString

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")

    // Stage 1: migrate up to V40 only -- the pre-V41 schema shape.
    Flyway.configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .target("40")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    seedPreV41Fixture()

    // Stage 2: apply V41 (and any later migrations) against the seeded fixture.
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

  /** Seeds, against the V40 schema:
   *   - a source + companion DataType bound by one panel (the migration target)
   *   - a second source + companion DataType with no bound panel (control)
   *  Runs on the raw postgres-superuser pool so RLS (enabled from V35) never
   *  engages -- mirrors the pattern used by PipelineRepositorySpec /
   *  DataTypeRepositorySpec. */
  private def seedPreV41Fixture(): Unit =
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($ownerId::uuid, 'v41-migration-test@helio.internal', now())
             ON CONFLICT DO NOTHING""",

      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($boundSourceId, 'bound-src', 'static', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, computed_fields, owner_id, created_at, updated_at)
             VALUES ($boundTypeId, $boundSourceId, 'Bound Type', '[]'::jsonb, 1, '[]'::jsonb, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dashboardId, 'Dash', $ownerId, now(), now(), '{}', '{}', $ownerId::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type_id, owner_id)
             VALUES ($panelId, $dashboardId, 'Panel', $ownerId, now(), now(), '{}', $boundTypeId, $ownerId::uuid)""",

      // Control: a second source's companion type has no bound panel and must
      // be left completely untouched by V41.
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($unboundSourceId, 'unbound-src', 'static', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, computed_fields, owner_id, created_at, updated_at)
             VALUES ($unboundTypeId, $unboundSourceId, 'Unbound Type', '[]'::jsonb, 1, '[]'::jsonb, $ownerId::uuid, now(), now())"""
    )))

  "V41 migration" should {

    "clear source_id on the panel-bound companion DataType" in {
      val sourceId = await(db.run(sql"SELECT source_id FROM data_types WHERE id = $boundTypeId".as[Option[String]].head))
      sourceId shouldBe None
    }

    "create a NULL-last-run pass-through pipeline from the source to the (former) companion type" in {
      val rows = await(db.run(
        sql"""SELECT name, source_data_source_id, output_data_type_id, last_run_status, last_run_at, last_run_row_count
              FROM pipelines WHERE output_data_type_id = $boundTypeId"""
          .as[(String, String, String, Option[String], Option[Timestamp], Option[Long])]
      ))

      rows should have size 1
      val (name, sourceId, outputTypeId, lastRunStatus, lastRunAt, lastRunRowCount) = rows.head
      name             shouldBe "Bound Type (migrated)"
      sourceId         shouldBe boundSourceId
      outputTypeId     shouldBe boundTypeId
      lastRunStatus    shouldBe None
      lastRunAt        shouldBe None
      lastRunRowCount  shouldBe None
    }

    "insert exactly one replacement companion DataType for the source" in {
      val companions = await(db.run(
        sql"SELECT id, name FROM data_types WHERE source_id = $boundSourceId".as[(String, String)]
      ))

      companions should have size 1
      companions.head._1 should not be boundTypeId
      companions.head._2 shouldBe "Bound Type"
    }

    "leave the panel's type_id unchanged" in {
      val typeId = await(db.run(sql"SELECT type_id FROM panels WHERE id = $panelId".as[Option[String]].head))
      typeId shouldBe Some(boundTypeId)
    }

    "leave an unbound companion DataType, and its source, with no migrated pipeline" in {
      val sourceId = await(db.run(sql"SELECT source_id FROM data_types WHERE id = $unboundTypeId".as[Option[String]].head))
      sourceId shouldBe Some(unboundSourceId)

      val pipelineCount = await(db.run(sql"SELECT COUNT(*) FROM pipelines WHERE output_data_type_id = $unboundTypeId".as[Int].head))
      pipelineCount shouldBe 0

      val companionCount = await(db.run(sql"SELECT COUNT(*) FROM data_types WHERE source_id = $unboundSourceId".as[Int].head))
      companionCount shouldBe 1
    }
  }
}
