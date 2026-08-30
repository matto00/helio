package com.helio.infrastructure.persistence

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.domain.model._
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

/** HEL-366 tasks.md 6.10 — integration test for the V73 migration
 *  (`add_resource_tag`): pre-existing `data_sources`/`pipelines`/`data_types`
 *  rows (seeded before V73 runs) survive the migration with `tag = NULL`, and
 *  remain fully functional through the repository layer afterward.
 *
 *  Flyway is staged in two steps — migrate to V72 (the pre-`tag`-column
 *  schema shape), seed a fixture directly against it, then migrate the rest
 *  of the way (V73) — mirroring `TriggerSourceMigrationSpec`'s established
 *  staged-migration pattern so the migration runs against exactly the shape
 *  it targets in production, not a schema that already has the column.
 *
 *  Scope note: "remain fully functional (read/update/delete/analyze/run)"
 *  per the task's own wording is tested here via the repository layer's
 *  read/update/delete (the operations that could plausibly interact with a
 *  new column on the same rows). Pipeline analyze/run are exhaustively
 *  covered elsewhere (`PipelineAnalyzeServiceSpec`, `InProcessPipelineEngineSpec`)
 *  and neither code path reads or writes the `tag` column at all — a purely
 *  additive, nullable column addition has no plausible interaction with
 *  either, so re-proving analyze/run here would be redundant, not more
 *  rigorous. */
class ResourceTagMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataSourceRepo: DataSourceRepository = _
  private var dataTypeRepo: DataTypeRepository     = _
  private var pipelineRepo: PipelineRepository     = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val ownerId       = UUID.randomUUID().toString
  private val owner         = AuthenticatedUser(UserId(ownerId))
  private val srcId         = UUID.randomUUID().toString
  private val companionId   = UUID.randomUUID().toString
  private val outputTypeId  = UUID.randomUUID().toString
  private val pipelineId    = UUID.randomUUID().toString

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")

    // Stage 1: migrate up to V72 only -- the pre-V73 schema shape (no `tag`
    // column on any of the three tables).
    Flyway.configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .target("72")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    seedPreV73Fixture()

    // Stage 2: apply V73 (and later migrations up to, but excluding, V94)
    // against the seeded fixture. HEL-904 task 2.9(a) makes V94 unconditionally
    // delete any companion DataType with no pipeline binding -- this spec's
    // fixture's `companionId` row is exactly that shape, so running to latest
    // would delete it out from under the "read pre-existing row" assertions
    // below via a LATER migration's deliberate, unrelated behavior, not a V73
    // regression. Pinning to V93 keeps this spec testing V73's own effect in
    // isolation.
    Flyway.configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .target("93")
      .load()
      .migrate()

    val ctx        = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    dataTypeRepo   = new DataTypeRepository(ctx)
    pipelineRepo   = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def seedPreV73Fixture(): Unit =
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($ownerId::uuid, 'v73-migration-test@helio.internal', now())
             ON CONFLICT DO NOTHING""",
      // A source-companion pair -- no `tag` column exists at this schema
      // version yet, so neither insert references it.
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcId, 'pre-existing source', 'static', '{"columns":[],"rows":[]}'::jsonb,
                     $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($companionId, $srcId, 'pre-existing companion', '[]'::jsonb, 1,
                     $ownerId::uuid, now(), now())""",
      // A pipeline + its own output type.
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($outputTypeId, 'pre-existing output', '[]'::jsonb, 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
             VALUES ($pipelineId, 'pre-existing pipeline', $srcId, $outputTypeId, $ownerId::uuid, now(), now())"""
    )))

  "V73 migration" should {

    "leave pre-existing rows with tag = NULL on all three tables" in {
      await(db.run(sql"SELECT tag FROM data_sources WHERE id = $srcId".as[Option[String]].head)) shouldBe None
      await(db.run(sql"SELECT tag FROM data_types WHERE id = $companionId".as[Option[String]].head)) shouldBe None
      await(db.run(sql"SELECT tag FROM data_types WHERE id = $outputTypeId".as[Option[String]].head)) shouldBe None
      await(db.run(sql"SELECT tag FROM pipelines WHERE id = $pipelineId".as[Option[String]].head)) shouldBe None
    }

    "accept a valid tag write (CHECK (length(tag) <= 200) does not reject a normal value)" in {
      await(db.run(sqlu"UPDATE data_sources SET tag = 'ok' WHERE id = $srcId"))
      await(db.run(sql"SELECT tag FROM data_sources WHERE id = $srcId".as[Option[String]].head)) shouldBe Some("ok")
      // Restore for the read/update/delete assertions below, which assume
      // the pre-existing/untagged shape.
      await(db.run(sqlu"UPDATE data_sources SET tag = NULL WHERE id = $srcId"))
    }

    "reject a tag over 200 chars via the CHECK constraint" in {
      val tooLong = "x" * 201
      val result  = db.run(sqlu"UPDATE data_sources SET tag = $tooLong WHERE id = $srcId")
      a[SQLException] should be thrownBy await(result)
    }

    "read a pre-existing row through the repository layer (tag: None, everything else intact)" in {
      val source = await(dataSourceRepo.findByIdOwned(DataSourceId(srcId), owner))
      source shouldBe defined
      source.get.name shouldBe "pre-existing source"
      source.get.tag shouldBe None

      val companion = await(dataTypeRepo.findByIdOwned(DataTypeId(companionId), owner))
      companion shouldBe defined
      companion.get.sourceId shouldBe Some(DataSourceId(srcId))
      companion.get.tag shouldBe None

      val pipeline = await(pipelineRepo.findByIdOwned(PipelineId(pipelineId), owner))
      pipeline shouldBe defined
      pipeline.get.tag shouldBe None
    }

    "update a pre-existing row through the repository layer" in {
      val source  = await(dataSourceRepo.findByIdOwned(DataSourceId(srcId), owner)).get
      val renamed = source match {
        case s: StaticSource => s.copy(name = "renamed after migration")
        case other            => fail(s"expected StaticSource, got $other")
      }
      val updated = await(dataSourceRepo.update(renamed, owner))
      updated shouldBe defined
      updated.get.name shouldBe "renamed after migration"
      updated.get.tag shouldBe None
    }

    "delete a pre-existing row through the repository layer" in {
      await(pipelineRepo.delete(PipelineId(pipelineId), owner)) shouldBe true
      await(pipelineRepo.findByIdOwned(PipelineId(pipelineId), owner)) shouldBe None
    }
  }
}
