package com.helio.infrastructure

import com.helio.api.{ResourceType, ResourceTypeRegistry}
import com.helio.domain.{DataSourceId, PipelineId, UserId}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.{Instant, temporal}
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class PipelineRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var pipelineRepo: PipelineRepository     = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db           = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val dataTypeRepo  = new DataTypeRepository(db)
    val dataSourceRepo = new DataSourceRepository(db)
    pipelineRepo = new PipelineRepository(db, dataTypeRepo, dataSourceRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Seed a data source and pipeline, returning the pipeline id. */
  private def seedPipeline(): PipelineId = {
    import PostgresProfile.api._
    val ownerId = "00000000-0000-0000-0000-000000000001"
    val dsId    = UUID.randomUUID().toString
    val dtId    = UUID.randomUUID().toString
    val pid     = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types
               (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, now(), now())"""
    )))
    PipelineId(pid)
  }

  "PipelineRepository.updateLastRun" should {

    "set lastRunStatus to succeeded and lastRunAt to the given instant" in {
      val pid = seedPipeline()
      val at  = Instant.now().truncatedTo(temporal.ChronoUnit.MILLIS)
      await(pipelineRepo.updateLastRun(pid, "succeeded", at))

      val found = await(pipelineRepo.findById(pid))
      found shouldBe defined
      found.get.lastRunStatus shouldBe Some("succeeded")
      found.get.lastRunAt     shouldBe defined
    }

    "set lastRunStatus to failed" in {
      val pid = seedPipeline()
      val at  = Instant.now()
      await(pipelineRepo.updateLastRun(pid, "failed", at))

      val found = await(pipelineRepo.findById(pid))
      found.get.lastRunStatus shouldBe Some("failed")
    }

    "reflect updated status in listSummaries" in {
      val pid = seedPipeline()
      val at  = Instant.now()
      await(pipelineRepo.updateLastRun(pid, "succeeded", at))

      val summaries = await(pipelineRepo.listSummaries())
      val summary   = summaries.find(_.id == pid.value)
      summary shouldBe defined
      summary.get.lastRunStatus shouldBe Some("succeeded")
      summary.get.lastRunAt     shouldBe defined
    }

    "persist lastRunRowCount when provided and reflect it in listSummaries" in {
      val pid = seedPipeline()
      val at  = Instant.now()
      await(pipelineRepo.updateLastRun(pid, "succeeded", at, rowCount = Some(1234L)))

      val summaries = await(pipelineRepo.listSummaries())
      val summary   = summaries.find(_.id == pid.value)
      summary shouldBe defined
      summary.get.lastRunRowCount shouldBe Some(1234L)
    }

    "leave lastRunRowCount as None when no rowCount is provided" in {
      val pid = seedPipeline()
      val at  = Instant.now()
      await(pipelineRepo.updateLastRun(pid, "failed", at, rowCount = None))

      val summaries = await(pipelineRepo.listSummaries())
      val summary   = summaries.find(_.id == pid.value)
      summary shouldBe defined
      summary.get.lastRunRowCount shouldBe None
    }

    "return lastRunRowCount = None for a pipeline that has never been run" in {
      val pid = seedPipeline()

      val summaries = await(pipelineRepo.listSummaries())
      val summary   = summaries.find(_.id == pid.value)
      summary shouldBe defined
      summary.get.lastRunStatus   shouldBe None
      summary.get.lastRunAt       shouldBe None
      summary.get.lastRunRowCount shouldBe None
    }
  }

  // ── HEL-265 CS1: owner_id foundation ─────────────────────────────────────
  //
  // These tests cover the additive data-model change introduced by V32.
  // They do NOT exercise ACL enforcement — that lands in CS2 — only that
  // owner_id is correctly defaulted, persisted, and surfaced on reads.

  "PipelineRepository owner_id (V32)" should {

    "default newly-inserted rows missing owner_id to the system user" in {
      val pid = seedPipeline()

      val pipeline = await(pipelineRepo.findByIdInternal(pid))
      pipeline shouldBe defined
      pipeline.get.ownerId shouldBe UserId("00000000-0000-0000-0000-000000000001")
    }

    "persist an explicit owner_id when create() is called with a non-system user" in {
      import PostgresProfile.api._
      val customOwner = UUID.randomUUID().toString
      val dsId        = UUID.randomUUID().toString
      // Seed the custom user and a data source they own so create() can succeed.
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO users (id, email, created_at)
                 VALUES ($customOwner::uuid, ${s"user-$customOwner@helio.test"}, now())""",
        sqlu"""INSERT INTO data_sources
                 (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $customOwner::uuid, now(), now())"""
      )))

      val result = await(pipelineRepo.create(
        name               = "owned-pipeline",
        sourceDataSourceId = DataSourceId(dsId),
        outputDataTypeName = "owned-dt",
        ownerId            = UserId(customOwner)
      ))
      result.isRight shouldBe true
      val summary = result.toOption.get

      val pipeline = await(pipelineRepo.findByIdInternal(PipelineId(summary.id)))
      pipeline shouldBe defined
      pipeline.get.ownerId shouldBe UserId(customOwner)
    }

    "findByIdInternal returns the row regardless of owner" in {
      // Seed via the raw-SQL helper which uses the system user default; the
      // *Internal read makes no owner predicate, so the row should come back.
      val pid = seedPipeline()

      val viaInternal = await(pipelineRepo.findByIdInternal(pid))
      viaInternal shouldBe defined
      viaInternal.get.id shouldBe pid
    }

    "registry resolver returns the pipeline's owner id" in {
      val pid = seedPipeline()

      val resolver = ResourceType(
        "pipeline",
        id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value))
      )
      // Construct a registry to also exercise the lookup path the directive uses.
      val registry = new ResourceTypeRegistry(resolver)
      val rt       = registry.lookup("pipeline")
      rt shouldBe defined

      val ownerOpt = await(rt.get.ownerResolver(pid.value))
      ownerOpt shouldBe Some("00000000-0000-0000-0000-000000000001")
    }

    "registry resolver returns None for an unknown pipeline id" in {
      val resolver = ResourceType(
        "pipeline",
        id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value))
      )
      val ownerOpt = await(resolver.ownerResolver(UUID.randomUUID().toString))
      ownerOpt shouldBe None
    }
  }
}
