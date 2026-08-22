package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.DataTypeRowRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

class DataTypeRowRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database            = _
  private var repo: DataTypeRowRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new DataTypeRowRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val dtId  = "dt-row-spec-" + java.util.UUID.randomUUID().toString
  private val dtId2 = "dt-row-spec-" + java.util.UUID.randomUUID().toString

  private def makeRow(name: String, score: Int): JsObject =
    JsObject("name" -> JsString(name), "score" -> JsNumber(score))

  "DataTypeRowRepository" should {

    "insert rows via overwriteRows and retrieve them with listRows" in {
      val rows = Seq(makeRow("alice", 10), makeRow("bob", 20))
      await(repo.overwriteRows(dtId, rows))

      val result = await(repo.listRows(dtId))
      result should have size 2
      result.head.fields("name") shouldBe JsString("alice")
      result(1).fields("name")   shouldBe JsString("bob")
    }

    "second overwriteRows call replaces all existing rows" in {
      // First write: 2 rows
      await(repo.overwriteRows(dtId, Seq(makeRow("alice", 10), makeRow("bob", 20))))
      await(repo.listRows(dtId)) should have size 2

      // Second write with completely different data
      val newRows = Seq(makeRow("carol", 30), makeRow("dave", 40), makeRow("eve", 50))
      await(repo.overwriteRows(dtId, newRows))

      val result = await(repo.listRows(dtId))
      result should have size 3
      result.map(_.fields("name")) shouldBe Vector(JsString("carol"), JsString("dave"), JsString("eve"))
    }

    "zero-row overwriteRows clears the snapshot" in {
      // Write some rows first
      await(repo.overwriteRows(dtId, Seq(makeRow("alice", 10), makeRow("bob", 20))))
      await(repo.listRows(dtId)) should have size 2

      // Overwrite with empty sequence → clear
      await(repo.overwriteRows(dtId, Seq.empty))

      val result = await(repo.listRows(dtId))
      result shouldBe empty
    }

    "listRows returns empty for a DataType with no snapshot" in {
      val result = await(repo.listRows(dtId2))
      result shouldBe empty
    }

    "rows are returned in row_index order" in {
      val rows = (0 until 5).map(i => JsObject("idx" -> JsNumber(i)))
      await(repo.overwriteRows(dtId2, rows))

      val result = await(repo.listRows(dtId2))
      result.map(_.fields("idx")) shouldBe (0 until 5).map(i => JsNumber(i)).toVector
    }

    "overwriteRows is isolated per DataType — rows for one type do not affect another" in {
      val dtA = "dt-iso-a-" + java.util.UUID.randomUUID().toString
      val dtB = "dt-iso-b-" + java.util.UUID.randomUUID().toString

      await(repo.overwriteRows(dtA, Seq(makeRow("a1", 1))))
      await(repo.overwriteRows(dtB, Seq(makeRow("b1", 2), makeRow("b2", 3))))

      // Overwrite A — B is unchanged
      await(repo.overwriteRows(dtA, Seq(makeRow("a-new", 99))))

      await(repo.listRows(dtA)) should have size 1
      await(repo.listRows(dtB)) should have size 2
    }

    // ── HEL-372 design.md D1: SQL-tier row/key bounding ──────────────────

    "limit bounds the result at the SQL tier, preserving row_index order" in {
      val dtLimit = "dt-limit-" + java.util.UUID.randomUUID().toString
      val rows    = (0 until 5).map(i => JsObject("idx" -> JsNumber(i)))
      await(repo.overwriteRows(dtLimit, rows))

      val result = await(repo.listRows(dtLimit, limit = Some(3)))
      result.map(_.fields("idx")) shouldBe (0 until 3).map(i => JsNumber(i)).toVector
    }

    "limit greater than the row count returns every row, unchanged" in {
      val dtLimit = "dt-limit-wide-" + java.util.UUID.randomUUID().toString
      await(repo.overwriteRows(dtLimit, Seq(makeRow("solo", 1))))

      val result = await(repo.listRows(dtLimit, limit = Some(50)))
      result should have size 1
    }

    "excludeKeys strips the named top-level keys from every row's data, inside the query" in {
      val dtExclude = "dt-exclude-" + java.util.UUID.randomUUID().toString
      val row = JsObject(
        "name"    -> JsString("alice"),
        "score"   -> JsNumber(10),
        "content" -> JsString("x" * 500)
      )
      await(repo.overwriteRows(dtExclude, Seq(row)))

      val result = await(repo.listRows(dtExclude, excludeKeys = Set("content")))
      result should have size 1
      result.head.fields should contain key "name"
      result.head.fields should contain key "score"
      result.head.fields should not contain key("content")
    }

    "excludeKeys with multiple keys strips all of them, and is independent of limit" in {
      val dtExclude = "dt-exclude-multi-" + java.util.UUID.randomUUID().toString
      val row = JsObject(
        "keep1" -> JsString("a"),
        "drop1" -> JsString("b"),
        "drop2" -> JsString("c")
      )
      await(repo.overwriteRows(dtExclude, Seq(row, row)))

      val result = await(repo.listRows(dtExclude, limit = Some(1), excludeKeys = Set("drop1", "drop2")))
      result should have size 1
      result.head.fields.keySet shouldBe Set("keep1")
    }

    "excludeKeys for a key absent from the row is a no-op" in {
      val dtExclude = "dt-exclude-absent-" + java.util.UUID.randomUUID().toString
      await(repo.overwriteRows(dtExclude, Seq(makeRow("alice", 10))))

      val result = await(repo.listRows(dtExclude, excludeKeys = Set("nonexistent-key")))
      result.head.fields.keySet shouldBe Set("name", "score")
    }
  }
}
