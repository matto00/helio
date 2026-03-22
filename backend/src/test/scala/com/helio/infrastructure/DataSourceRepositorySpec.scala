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

  private def newSource(name: String = "Test Source"): DataSource = {
    val now = Instant.now()
    DataSource(
      id         = DataSourceId(UUID.randomUUID().toString),
      name       = name,
      sourceType = SourceType.RestApi,
      config     = JsObject.empty,
      createdAt  = now,
      updatedAt  = now
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
    }

    "findAll returns all inserted records" in {
      cleanDb()
      val a = newSource("Source A")
      val b = newSource("Source B")
      await(repo.insert(a))
      await(repo.insert(b))
      val all = await(repo.findAll())
      all.map(_.id) should contain allOf (a.id, b.id)
    }

    "findById returns None for unknown id" in {
      cleanDb()
      val result = await(repo.findById(DataSourceId(UUID.randomUUID().toString)))
      result shouldBe None
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
  }
}
