package com.helio.infrastructure

import com.helio.domain._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.JsObject

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration.DurationInt

class DataTypeRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dtRepo: DataTypeRepository           = _
  private var dsRepo: DataSourceRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db     = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dtRepo = new DataTypeRepository(db)
    dsRepo = new DataSourceRepository(db)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM data_sources"))
  }

  private def newSource(): DataSource = {
    val now = Instant.now()
    DataSource(
      id         = DataSourceId(UUID.randomUUID().toString),
      name       = "Test Source",
      sourceType = SourceType.Csv,
      config     = JsObject.empty,
      createdAt  = now,
      updatedAt  = now
    )
  }

  private def newDataType(sourceId: Option[DataSourceId] = None, name: String = "MyType"): DataType = {
    val now = Instant.now()
    DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = sourceId,
      name      = name,
      fields    = Vector(DataField("ts", "Timestamp", "datetime", nullable = false)),
      version   = 99, // should be overridden to 1 on insert
      createdAt = now,
      updatedAt = now
    )
  }

  "DataTypeRepository" should {

    "insert sets version to 1 regardless of input" in {
      cleanDb()
      val dt = newDataType()
      val inserted = await(dtRepo.insert(dt))
      inserted.version shouldBe 1
      val found = await(dtRepo.findById(dt.id))
      found shouldBe defined
      found.get.version shouldBe 1
    }

    "findById returns the inserted record" in {
      cleanDb()
      val dt = newDataType()
      await(dtRepo.insert(dt))
      val found = await(dtRepo.findById(dt.id))
      found shouldBe defined
      found.get.id   shouldBe dt.id
      found.get.name shouldBe dt.name
      found.get.fields shouldBe dt.fields
    }

    "findById returns None for unknown id" in {
      cleanDb()
      val result = await(dtRepo.findById(DataTypeId(UUID.randomUUID().toString)))
      result shouldBe None
    }

    "findAll returns all records" in {
      cleanDb()
      val a = newDataType(name = "TypeA")
      val b = newDataType(name = "TypeB")
      await(dtRepo.insert(a))
      await(dtRepo.insert(b))
      val all = await(dtRepo.findAll())
      all.map(_.id) should contain allOf (a.id, b.id)
    }

    "findBySourceId returns only types for that source" in {
      cleanDb()
      val source = newSource()
      await(dsRepo.insert(source))
      val dt1 = newDataType(sourceId = Some(source.id), name = "Type1")
      val dt2 = newDataType(sourceId = Some(source.id), name = "Type2")
      val dt3 = newDataType(sourceId = None,            name = "Type3")
      await(dtRepo.insert(dt1))
      await(dtRepo.insert(dt2))
      await(dtRepo.insert(dt3))
      val found = await(dtRepo.findBySourceId(source.id))
      found.map(_.id) should contain allOf (dt1.id, dt2.id)
      found.map(_.id) should not contain dt3.id
    }

    "update increments version by 1" in {
      cleanDb()
      val dt       = newDataType()
      val inserted = await(dtRepo.insert(dt))
      inserted.version shouldBe 1

      val updated = await(dtRepo.update(inserted.copy(name = "Updated")))
      updated shouldBe defined
      updated.get.version shouldBe 2
      updated.get.name    shouldBe "Updated"

      val updated2 = await(dtRepo.update(updated.get.copy(name = "Updated Again")))
      updated2 shouldBe defined
      updated2.get.version shouldBe 3
    }

    "update returns None for unknown id" in {
      cleanDb()
      val phantom = newDataType()
      val result  = await(dtRepo.update(phantom))
      result shouldBe None
    }

    "delete returns true and removes record" in {
      cleanDb()
      val dt = newDataType()
      await(dtRepo.insert(dt))
      val deleted = await(dtRepo.delete(dt.id))
      deleted shouldBe true
      await(dtRepo.findById(dt.id)) shouldBe None
    }

    "delete returns false for unknown id" in {
      cleanDb()
      val result = await(dtRepo.delete(DataTypeId(UUID.randomUUID().toString)))
      result shouldBe false
    }

    "deleting a data source orphans its data types (sourceId becomes None)" in {
      cleanDb()
      val source = newSource()
      await(dsRepo.insert(source))
      val dt = newDataType(sourceId = Some(source.id))
      await(dtRepo.insert(dt))

      // Verify linked before deletion
      await(dtRepo.findBySourceId(source.id)).map(_.id) should contain (dt.id)

      // Delete the source — ON DELETE SET NULL
      await(dsRepo.delete(source.id))

      // Data type still exists but sourceId is now None
      val orphaned = await(dtRepo.findById(dt.id))
      orphaned shouldBe defined
      orphaned.get.sourceId shouldBe None
    }
  }
}
