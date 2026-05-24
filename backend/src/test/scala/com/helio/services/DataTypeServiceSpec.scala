package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DataTypeRowRepository, DbContext}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Service-level coverage for `DataTypeService`.
 *
 *  Cycle-2 (HEL-256) adds the Fix B′ guard: deleting a DataType whose
 *  `sourceId` points to a still-existing DataSource must return
 *  `Conflict` rather than orphaning the source's schema. */
class DataTypeServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataTypeRepo: DataTypeRepository   = _
  private var dataTypeRowRepo: DataTypeRowRepository = _
  private var dataSourceRepo: DataSourceRepository = _
  private var service: DataTypeService           = _

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx         = new DbContext(db, db)
    dataTypeRepo    = new DataTypeRepository(ctx)
    dataTypeRowRepo = new DataTypeRowRepository(ctx)
    dataSourceRepo  = new DataSourceRepository(ctx)
    service = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE data_types, data_sources RESTART IDENTITY CASCADE"))
  }

  private def insertSource(): DataSource = {
    val now    = Instant.now()
    val source = CsvSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = "Sales CSV",
      ownerId   = owner,
      createdAt = now,
      updatedAt = now,
      config    = CsvSourceConfig("csv/test.csv")
    )
    await(dataSourceRepo.insert(source, user))
    source
  }

  private def insertDataType(sourceId: Option[DataSourceId], name: String = "MyType"): DataType = {
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = sourceId,
      name      = name,
      fields    = Vector(DataField("a", "A", "string", nullable = true)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner
    )
    await(dataTypeRepo.insert(dt, user))
    dt
  }

  "DataTypeService.delete" should {

    "return Conflict when the DataType is linked to a still-existing DataSource" in {
      cleanDb()
      val source = insertSource()
      val dt     = insertDataType(Some(source.id), name = "Sales CSV")

      val result = await(service.delete(dt.id, user))

      result match {
        case Left(ServiceError.Conflict(msg)) =>
          msg should include("auto-inferred schema")
          msg should include("Sales CSV")
        case other => fail(s"Expected Conflict, got: $other")
      }
      // The DataType row should still exist after the rejected delete.
      await(dataTypeRepo.findByIdInternal(dt.id)) should not be empty
    }

    "allow deletion of a pipeline-output DataType (no sourceId link)" in {
      cleanDb()
      val dt = insertDataType(sourceId = None, name = "PipelineOutput")

      val result = await(service.delete(dt.id, user))

      result shouldBe Right(())
      await(dataTypeRepo.findByIdInternal(dt.id)) shouldBe empty
    }

    "allow deletion of a DataType whose source has already been deleted (FK cascade SET NULL)" in {
      cleanDb()
      val source = insertSource()
      val dt     = insertDataType(Some(source.id), name = "WillBeOrphaned")
      // Drop the source — the V4 migration's ON DELETE SET NULL clears the
      // FK reference on the DT, so the row stays around with `sourceId = null`.
      await(dataSourceRepo.delete(source.id, user))
      val refreshedDt = await(dataTypeRepo.findByIdInternal(dt.id)).getOrElse(fail("DT should still exist"))
      refreshedDt.sourceId shouldBe None

      val result = await(service.delete(dt.id, user))

      result shouldBe Right(())
      await(dataTypeRepo.findByIdInternal(dt.id)) shouldBe empty
    }
  }
}
