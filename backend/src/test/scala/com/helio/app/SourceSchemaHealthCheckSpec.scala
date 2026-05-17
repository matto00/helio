package com.helio.app

import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Coverage for the cycle-2 (HEL-256) boot-time orphan detection. */
class SourceSchemaHealthCheckSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val logger = LoggerFactory.getLogger(classOf[SourceSchemaHealthCheckSpec])

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataSourceRepo: DataSourceRepository = _
  private var dataTypeRepo: DataTypeRepository   = _

  private val owner = UserId(UUID.randomUUID().toString)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dataSourceRepo = new DataSourceRepository(db)
    dataTypeRepo   = new DataTypeRepository(db)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE data_types, data_sources RESTART IDENTITY CASCADE"))
  }

  private def insertSource(name: String): DataSource = {
    val now    = Instant.now()
    val source = CsvSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = name,
      ownerId   = owner,
      createdAt = now,
      updatedAt = now,
      config    = CsvSourceConfig(s"csv/${name}.csv")
    )
    await(dataSourceRepo.insert(source))
    source
  }

  private def insertLinkedDataType(source: DataSource): DataType = {
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = Some(source.id),
      name      = source.name,
      fields    = Vector(DataField("a", "A", "string", nullable = true)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner
    )
    await(dataTypeRepo.insert(dt))
    dt
  }

  "SourceSchemaHealthCheck.findOrphans" should {

    "return an empty vector when every source has a linked DataType" in {
      cleanDb()
      val s = insertSource("healthy")
      val _ = insertLinkedDataType(s)

      val orphans = await(SourceSchemaHealthCheck.findOrphans(db))
      orphans shouldBe empty
    }

    "return rows for sources whose linked DataType is missing" in {
      cleanDb()
      val orphan1 = insertSource("orphan-one")
      val orphan2 = insertSource("orphan-two")
      val healthy = insertSource("healthy")
      val _       = insertLinkedDataType(healthy)

      val orphans = await(SourceSchemaHealthCheck.findOrphans(db))
      orphans.map(_.id).toSet shouldBe Set(orphan1.id.value, orphan2.id.value)
      orphans.map(_.kind).toSet shouldBe Set(DataSourceKind.Csv)
      orphans.foreach(_.ownerId shouldBe Some(owner.value))
    }

    "not flag a source as orphaned when at least one DataType links to it" in {
      cleanDb()
      val s = insertSource("healthy")
      val _ = insertLinkedDataType(s)
      // Also insert a pipeline-output DT with sourceId = None — this should
      // not interfere with the orphan detection.
      val now    = Instant.now()
      val pipeDt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "PipelineOutput",
        fields    = Vector.empty,
        version   = 1,
        createdAt = now,
        updatedAt = now,
        ownerId   = owner
      )
      await(dataTypeRepo.insert(pipeDt))

      val orphans = await(SourceSchemaHealthCheck.findOrphans(db))
      orphans shouldBe empty
    }
  }

  "SourceSchemaHealthCheck.run" should {

    "complete with the orphan vector and not throw" in {
      cleanDb()
      val _ = insertSource("orphan-run")
      val orphans = await(SourceSchemaHealthCheck.run(db, logger))
      orphans should have size 1
    }
  }
}
