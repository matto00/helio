package com.helio.infrastructure

import com.helio.domain._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import com.helio.infrastructure.DbContext

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class DataTypeRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dtRepo: DataTypeRepository           = _
  private var dsRepo: DataSourceRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db     = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dtRepo = new DataTypeRepository(ctx)
    dsRepo = new DataSourceRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM data_sources"))
  }

  private val owner1 = UserId(UUID.randomUUID().toString)
  private val owner2 = UserId(UUID.randomUUID().toString)
  private val user1  = AuthenticatedUser(owner1)
  private val user2  = AuthenticatedUser(owner2)

  private def newSource(ownerId: UserId = owner1): DataSource = {
    val now = Instant.now()
    CsvSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = "Test Source",
      ownerId   = ownerId,
      createdAt = now,
      updatedAt = now,
      config    = CsvSourceConfig("uploads/test.csv")
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
      val inserted = await(dtRepo.insert(dt, user1))
      inserted.version shouldBe 1
      val found = await(dtRepo.findByIdInternal(dt.id))
      found shouldBe defined
      found.get.version shouldBe 1
    }

    "findByIdInternal returns the inserted record" in {
      cleanDb()
      val dt = newDataType()
      await(dtRepo.insert(dt, user1))
      val found = await(dtRepo.findByIdInternal(dt.id))
      found shouldBe defined
      found.get.id   shouldBe dt.id
      found.get.name shouldBe dt.name
      found.get.fields shouldBe dt.fields
    }

    "findByIdInternal returns None for unknown id" in {
      cleanDb()
      val result = await(dtRepo.findByIdInternal(DataTypeId(UUID.randomUUID().toString)))
      result shouldBe None
    }

    "findAll returns only records owned by the given user" in {
      cleanDb()
      val a = newDataType(name = "TypeA", ownerId = owner1)
      val b = newDataType(name = "TypeB", ownerId = owner1)
      val c = newDataType(name = "TypeC", ownerId = owner2)
      await(dtRepo.insert(a, user1))
      await(dtRepo.insert(b, user1))
      await(dtRepo.insert(c, user2))
      val forOwner1 = await(dtRepo.findAll(owner1))
      forOwner1.map(_.id) should contain allOf (a.id, b.id)
      forOwner1.map(_.id) should not contain c.id
      val forOwner2 = await(dtRepo.findAll(owner2))
      forOwner2.map(_.id) should contain only c.id
    }

    "findBySourceId returns only types for that source owned by the given user" in {
      cleanDb()
      val source = newSource()
      await(dsRepo.insert(source, user1))
      val dt1 = newDataType(sourceId = Some(source.id), name = "Type1", ownerId = owner1)
      val dt2 = newDataType(sourceId = Some(source.id), name = "Type2", ownerId = owner1)
      val dt3 = newDataType(sourceId = None,            name = "Type3", ownerId = owner1)
      val dt4 = newDataType(sourceId = Some(source.id), name = "Type4", ownerId = owner2)
      await(dtRepo.insert(dt1, user1))
      await(dtRepo.insert(dt2, user1))
      await(dtRepo.insert(dt3, user1))
      await(dtRepo.insert(dt4, user2))
      val found = await(dtRepo.findBySourceId(source.id, owner1))
      found.map(_.id) should contain allOf (dt1.id, dt2.id)
      found.map(_.id) should not contain dt3.id
      found.map(_.id) should not contain dt4.id
    }

    "update increments version by 1" in {
      cleanDb()
      val dt       = newDataType()
      val inserted = await(dtRepo.insert(dt, user1))
      inserted.version shouldBe 1

      val updated = await(dtRepo.update(inserted.copy(name = "Updated"), user1))
      updated shouldBe defined
      updated.get.version shouldBe 2
      updated.get.name    shouldBe "Updated"

      val updated2 = await(dtRepo.update(updated.get.copy(name = "Updated Again"), user1))
      updated2 shouldBe defined
      updated2.get.version shouldBe 3
    }

    "update returns None for unknown id" in {
      cleanDb()
      val phantom = newDataType()
      val result  = await(dtRepo.update(phantom, user1))
      result shouldBe None
    }

    "delete returns true and removes record" in {
      cleanDb()
      val dt = newDataType()
      await(dtRepo.insert(dt, user1))
      val deleted = await(dtRepo.delete(dt.id, user1))
      deleted shouldBe true
      await(dtRepo.findByIdInternal(dt.id)) shouldBe None
    }

    "delete returns false for unknown id" in {
      cleanDb()
      val result = await(dtRepo.delete(DataTypeId(UUID.randomUUID().toString), user1))
      result shouldBe false
    }

    // ── Ownership enforcement tests (HEL-265 CS3) ────────────────────────────

    "findByIdOwned returns Some when owner matches" in {
      cleanDb()
      val dt = newDataType(ownerId = owner1)
      await(dtRepo.insert(dt, user1))
      val found = await(dtRepo.findByIdOwned(dt.id, user1))
      found shouldBe defined
      found.get.id shouldBe dt.id
    }

    "findByIdOwned returns None when owner does not match" in {
      cleanDb()
      val dt = newDataType(ownerId = owner1)
      await(dtRepo.insert(dt, user1))
      val found = await(dtRepo.findByIdOwned(dt.id, user2))
      found shouldBe None
    }

    "findByIdOwned returns None for unknown id" in {
      cleanDb()
      val result = await(dtRepo.findByIdOwned(DataTypeId(UUID.randomUUID().toString), user1))
      result shouldBe None
    }

    "deleting a data source orphans its data types (sourceId becomes None)" in {
      cleanDb()
      val source = newSource()
      await(dsRepo.insert(source, user1))
      val dt = newDataType(sourceId = Some(source.id))
      await(dtRepo.insert(dt, user1))

      // Verify linked before deletion
      await(dtRepo.findBySourceId(source.id, owner1)).map(_.id) should contain (dt.id)

      // Delete the source — ON DELETE SET NULL
      await(dsRepo.delete(source.id, user1))

      // Data type still exists but sourceId is now None
      val orphaned = await(dtRepo.findByIdInternal(dt.id))
      orphaned shouldBe defined
      orphaned.get.sourceId shouldBe None
    }

    "existsBoundToAnyOwnedPanel returns false when no panels are bound" in {
      cleanDb()
      val dt = newDataType(ownerId = owner1)
      await(dtRepo.insert(dt, user1))
      val result = await(dtRepo.existsBoundToAnyOwnedPanel(dt.id, user1))
      result shouldBe false
    }

    "findByIdsOwned returns only types owned by the given user" in {
      cleanDb()
      val dt1 = newDataType(name = "Type1", ownerId = owner1)
      val dt2 = newDataType(name = "Type2", ownerId = owner1)
      val dt3 = newDataType(name = "Type3", ownerId = owner2)
      await(dtRepo.insert(dt1, user1))
      await(dtRepo.insert(dt2, user1))
      await(dtRepo.insert(dt3, user2))
      val result = await(dtRepo.findByIdsOwned(Seq(dt1.id, dt2.id, dt3.id), user1))
      result.keySet shouldBe Set(dt1.id, dt2.id)
      result(dt1.id).name shouldBe "Type1"
      result(dt2.id).name shouldBe "Type2"
      result.get(dt3.id) shouldBe None
    }

    "findByIdsOwned excludes all types when caller owns none" in {
      cleanDb()
      val dt = newDataType(name = "OtherType", ownerId = owner2)
      await(dtRepo.insert(dt, user2))
      val result = await(dtRepo.findByIdsOwned(Seq(dt.id), user1))
      result shouldBe Map.empty
    }

    "findByIdsOwned short-circuits with empty map for empty input" in {
      cleanDb()
      val result = await(dtRepo.findByIdsOwned(Seq.empty, user1))
      result shouldBe Map.empty
    }

  }
}
