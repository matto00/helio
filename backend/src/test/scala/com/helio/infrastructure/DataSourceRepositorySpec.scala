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

class DataSourceRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: DataSourceRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new DataSourceRepository(db)
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

  private def newSource(name: String = "Test Source", ownerId: UserId = owner1): DataSource = {
    val now = Instant.now()
    DataSource(
      id         = DataSourceId(UUID.randomUUID().toString),
      name       = name,
      sourceType = SourceType.RestApi,
      config     = JsObject.empty,
      createdAt  = now,
      updatedAt  = now,
      ownerId    = ownerId
    )
  }

  "DataSourceRepository" should {

    "insert and findById returns the same record" in {
      cleanDb()
      val source = newSource()
      await(repo.insert(source))
      val found = await(repo.findById(source.id))
      found shouldBe defined
      found.get.id        shouldBe source.id
      found.get.name      shouldBe source.name
      found.get.sourceType shouldBe source.sourceType
      found.get.ownerId   shouldBe owner1
    }

    "findAll returns only records owned by the given user" in {
      cleanDb()
      val a = newSource("Source A", owner1)
      val b = newSource("Source B", owner1)
      val c = newSource("Source C", owner2)
      await(repo.insert(a))
      await(repo.insert(b))
      await(repo.insert(c))
      val forOwner1 = await(repo.findAll(owner1))
      forOwner1.map(_.id) should contain allOf (a.id, b.id)
      forOwner1.map(_.id) should not contain c.id
      val forOwner2 = await(repo.findAll(owner2))
      forOwner2.map(_.id) should contain only c.id
    }

    "findById returns None for unknown id" in {
      cleanDb()
      val result = await(repo.findById(DataSourceId(UUID.randomUUID().toString)))
      result shouldBe None
    }

    "findById returns None for wrong owner (owner-scoped overload via findAll)" in {
      cleanDb()
      val source = newSource(ownerId = owner1)
      await(repo.insert(source))
      // owner2 cannot see owner1's source via findAll
      val forOwner2 = await(repo.findAll(owner2))
      forOwner2.map(_.id) should not contain source.id
    }

    "delete returns true and removes the record" in {
      cleanDb()
      val source = newSource()
      await(repo.insert(source))
      val deleted = await(repo.delete(source.id))
      deleted shouldBe true
      await(repo.findById(source.id)) shouldBe None
    }

    "delete returns false for unknown id" in {
      cleanDb()
      val result = await(repo.delete(DataSourceId(UUID.randomUUID().toString)))
      result shouldBe false
    }

    "update returns the updated entity" in {
      cleanDb()
      val source = newSource("Original")
      await(repo.insert(source))
      val updated = source.copy(name = "Renamed", updatedAt = Instant.now())
      val result  = await(repo.update(updated))
      result shouldBe defined
      result.get.name shouldBe "Renamed"
    }

    "update returns None for unknown id" in {
      cleanDb()
      val source = newSource().copy(id = DataSourceId(UUID.randomUUID().toString))
      val result = await(repo.update(source))
      result shouldBe None
    }
  }
}
