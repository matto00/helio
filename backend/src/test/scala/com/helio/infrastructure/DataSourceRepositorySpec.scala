package com.helio.infrastructure

import com.helio.domain._
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

class DataSourceRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: DataSourceRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new DataSourceRepository(new DbContext(db, db))
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

  private def newSource(name: String = "Test Source", ownerId: UserId = owner1): DataSource = {
    val now = Instant.now()
    RestSource(
      id        = DataSourceId(UUID.randomUUID().toString),
      name      = name,
      ownerId   = ownerId,
      createdAt = now,
      updatedAt = now,
      config    = RestApiConfig(url = "https://example.test", method = "GET")
    )
  }

  "DataSourceRepository" should {

    "insert and findByIdInternal returns the same record" in {
      cleanDb()
      val source = newSource()
      await(repo.insert(source, user1))
      val found = await(repo.findByIdInternal(source.id))
      found shouldBe defined
      found.get.id      shouldBe source.id
      found.get.name    shouldBe source.name
      found.get.kind    shouldBe source.kind
      found.get.ownerId shouldBe owner1
      found.get         shouldBe a [RestSource]
    }

    "findAll returns only records owned by the given user" in {
      cleanDb()
      val a = newSource("Source A", owner1)
      val b = newSource("Source B", owner1)
      val c = newSource("Source C", owner2)
      await(repo.insert(a, user1))
      await(repo.insert(b, user1))
      await(repo.insert(c, user2))
      val forOwner1 = await(repo.findAll(owner1, Page.Default))
      forOwner1.items.map(_.id) should contain allOf (a.id, b.id)
      forOwner1.items.map(_.id) should not contain c.id
      val forOwner2 = await(repo.findAll(owner2, Page.Default))
      forOwner2.items.map(_.id) should contain only c.id
    }

    "findByIdInternal returns None for unknown id" in {
      cleanDb()
      val result = await(repo.findByIdInternal(DataSourceId(UUID.randomUUID().toString)))
      result shouldBe None
    }

    "findByIdOwned returns None for wrong owner (owner-scoped; cross-user isolation)" in {
      cleanDb()
      val source = newSource(ownerId = owner1)
      await(repo.insert(source, user1))
      // owner2 cannot see owner1's source via findAll
      val forOwner2 = await(repo.findAll(owner2, Page.Default))
      forOwner2.items.map(_.id) should not contain source.id
    }

    // ── HEL-265 CS2: findByIdOwned seed for cross-source ACL ────────────────
    //
    // Introduced to gate `PipelineRepository.create`'s source binding. CS3
    // broadens adoption across the DataSource / Source service surface.

    "findByIdOwned returns the row for the owner" in {
      cleanDb()
      val source = newSource(ownerId = owner1)
      await(repo.insert(source, user1))
      val found = await(repo.findByIdOwned(source.id, user1))
      found shouldBe defined
      found.get.id shouldBe source.id
    }

    "findByIdOwned returns None for a non-owner" in {
      cleanDb()
      val source = newSource(ownerId = owner1)
      await(repo.insert(source, user1))
      await(repo.findByIdOwned(source.id, user2)) shouldBe None
    }

    "findByIdOwned returns None for an unknown id" in {
      cleanDb()
      await(repo.findByIdOwned(
        DataSourceId(UUID.randomUUID().toString),
        user1
      )) shouldBe None
    }

    "delete returns true and removes the record" in {
      cleanDb()
      val source = newSource()
      await(repo.insert(source, user1))
      val deleted = await(repo.delete(source.id, user1))
      deleted shouldBe true
      await(repo.findByIdInternal(source.id)) shouldBe None
    }

    "delete returns false for unknown id" in {
      cleanDb()
      val result = await(repo.delete(DataSourceId(UUID.randomUUID().toString), user1))
      result shouldBe false
    }

    "update returns the updated entity" in {
      cleanDb()
      val source = newSource("Original")
      await(repo.insert(source, user1))
      val updated = source.asInstanceOf[RestSource].copy(name = "Renamed", updatedAt = Instant.now())
      val result  = await(repo.update(updated, user1))
      result shouldBe defined
      result.get.name shouldBe "Renamed"
    }

    "update returns None for unknown id" in {
      cleanDb()
      val source = newSource().asInstanceOf[RestSource].copy(id = DataSourceId(UUID.randomUUID().toString))
      val result = await(repo.update(source, user1))
      result shouldBe None
    }

    "round-trips each ADT subtype through insert + findById" in {
      cleanDb()
      val now      = Instant.now()
      val csv      = CsvSource(DataSourceId(UUID.randomUUID().toString), "csv-src", owner1, now, now,
                                CsvSourceConfig("uploads/test.csv"))
      val rest     = RestSource(DataSourceId(UUID.randomUUID().toString), "rest-src", owner1, now, now,
                                 RestApiConfig(url = "https://api.example/test", method = "POST"))
      val sql      = SqlSource(DataSourceId(UUID.randomUUID().toString), "sql-src", owner1, now, now,
                                SqlSourceConfig("postgresql", "host", 5432, "db", "u", "p", "SELECT 1"))
      val static   = StaticSource(DataSourceId(UUID.randomUUID().toString), "static-src", owner1, now, now)

      await(repo.insert(csv, user1))
      await(repo.insert(rest, user1))
      await(repo.insert(sql, user1))
      await(repo.insert(static, user1))

      await(repo.findByIdInternal(csv.id)).get    shouldBe a [CsvSource]
      await(repo.findByIdInternal(rest.id)).get   shouldBe a [RestSource]
      await(repo.findByIdInternal(sql.id)).get    shouldBe a [SqlSource]
      await(repo.findByIdInternal(static.id)).get shouldBe a [StaticSource]

      val csvRound = await(repo.findByIdInternal(csv.id)).get.asInstanceOf[CsvSource]
      csvRound.config.path shouldBe "uploads/test.csv"
      val sqlRound = await(repo.findByIdInternal(sql.id)).get.asInstanceOf[SqlSource]
      sqlRound.config.query    shouldBe "SELECT 1"
      sqlRound.config.dialect  shouldBe "postgresql"
      val restRound = await(repo.findByIdInternal(rest.id)).get.asInstanceOf[RestSource]
      restRound.config.url     shouldBe "https://api.example/test"
      restRound.config.method  shouldBe "POST"
    }
  }
}
