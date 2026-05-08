package com.helio.infrastructure

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.{Instant, temporal}
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext}
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

  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 10.seconds)

  /** Seed a data source and pipeline, returning the pipeline id. */
  private def seedPipeline(): String = {
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
    pid
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
      val summary   = summaries.find(_.id == pid)
      summary shouldBe defined
      summary.get.lastRunStatus shouldBe Some("succeeded")
      summary.get.lastRunAt     shouldBe defined
    }
  }
}
