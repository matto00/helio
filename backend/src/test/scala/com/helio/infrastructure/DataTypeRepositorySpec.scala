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

  private val owner1 = UserId(UUID.randomUUID().toString)
  private val owner2 = UserId(UUID.randomUUID().toString)

  private def newSource(ownerId: UserId = owner1): DataSource = {
    val now = Instant.now()
    DataSource(
      id         = DataSourceId(UUID.randomUUID().toString),
      name       = "Test Source",
      sourceType = SourceType.Csv,
      config     = JsObject.empty,
      createdAt  = now,
      updatedAt  = now,
      ownerId    = ownerId
    )
  }

  private def newDataType(sourceId: Option[DataSourceId] = None, name: String = "MyType", ownerId: UserId = owner1): DataType = {
    val now = Instant.now()
    DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = sourceId,
      name      = name,
      fields    = Vector(DataField("ts", "Timestamp", "datetime", nullable = false)),
      version   = 99, // should be overridden to 1 on insert
      createdAt = now,
      updatedAt = now,
      ownerId   = ownerId
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

    "findAll returns only records owned by the given user" in {
      cleanDb()
      val a = newDataType(name = "TypeA", ownerId = owner1)
      val b = newDataType(name = "TypeB", ownerId = owner1)
      val c = newDataType(name = "TypeC", ownerId = owner2)
      await(dtRepo.insert(a))
      await(dtRepo.insert(b))
      await(dtRepo.insert(c))
      val forOwner1 = await(dtRepo.findAll(owner1))
      forOwner1.map(_.id) should contain allOf (a.id, b.id)
      forOwner1.map(_.id) should not contain c.id
      val forOwner2 = await(dtRepo.findAll(owner2))
      forOwner2.map(_.id) should contain only c.id
    }

    "findBySourceId returns only types for that source owned by the given user" in {
      cleanDb()
      val source = newSource()
      await(dsRepo.insert(source))
      val dt1 = newDataType(sourceId = Some(source.id), name = "Type1", ownerId = owner1)
      val dt2 = newDataType(sourceId = Some(source.id), name = "Type2", ownerId = owner1)
      val dt3 = newDataType(sourceId = None,            name = "Type3", ownerId = owner1)
      val dt4 = newDataType(sourceId = Some(source.id), name = "Type4", ownerId = owner2)
      await(dtRepo.insert(dt1))
      await(dtRepo.insert(dt2))
      await(dtRepo.insert(dt3))
      await(dtRepo.insert(dt4))
      val found = await(dtRepo.findBySourceId(source.id, owner1))
      found.map(_.id) should contain allOf (dt1.id, dt2.id)
      found.map(_.id) should not contain dt3.id
      found.map(_.id) should not contain dt4.id
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

    // ── Ownership enforcement tests (Task 7.2) ─────────────────────────────────

    "owner-scoped findById returns Some when owner matches" in {
      cleanDb()
      val dt = newDataType(ownerId = owner1)
      await(dtRepo.insert(dt))
      val found = await(dtRepo.findById(dt.id, owner1))
      found shouldBe defined
      found.get.id shouldBe dt.id
    }

    "owner-scoped findById returns None when owner does not match" in {
      cleanDb()
      val dt = newDataType(ownerId = owner1)
      await(dtRepo.insert(dt))
      val found = await(dtRepo.findById(dt.id, owner2))
      found shouldBe None
    }

    "deleting a data source orphans its data types (sourceId becomes None)" in {
      cleanDb()
      val source = newSource()
      await(dsRepo.insert(source))
      val dt = newDataType(sourceId = Some(source.id))
      await(dtRepo.insert(dt))

      // Verify linked before deletion
      await(dtRepo.findBySourceId(source.id, owner1)).map(_.id) should contain (dt.id)

      // Delete the source — ON DELETE SET NULL
      await(dsRepo.delete(source.id))

      // Data type still exists but sourceId is now None
      val orphaned = await(dtRepo.findById(dt.id))
      orphaned shouldBe defined
      orphaned.get.sourceId shouldBe None
    }
  }
}
