package com.helio.infrastructure

import com.helio.domain.BinaryRef
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.time.temporal.ChronoUnit
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

class BinaryRefRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: BinaryRefRepository           = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new BinaryRefRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val dtId  = "dt-binref-spec-" + java.util.UUID.randomUUID().toString
  private val dtId2 = "dt-binref-spec-" + java.util.UUID.randomUUID().toString

  // Truncate sub-second precision so createdAt round-trips exactly through
  // the TIMESTAMPTZ column (Postgres stores microsecond precision; Instant
  // carries nanoseconds).
  private val fixedInstant = Instant.now().truncatedTo(ChronoUnit.MICROS)

  private def makeRef(dataTypeId: String, rowIndex: Int, fieldName: String, key: String): BinaryRef =
    BinaryRef(
      id = java.util.UUID.randomUUID().toString,
      dataTypeId = dataTypeId,
      rowIndex = rowIndex,
      fieldName = fieldName,
      storageKey = key,
      mimeType = "application/pdf",
      filename = s"$key.pdf",
      sizeBytes = 1024L,
      createdAt = fixedInstant
    )

  "BinaryRefRepository" should {

    "insert refs via overwriteForDataType and retrieve them with findByDataTypeId" in {
      val refs = Vector(
        makeRef(dtId, 0, "document", "uploads/a.pdf"),
        makeRef(dtId, 1, "document", "uploads/b.pdf")
      )
      await(repo.overwriteForDataType(dtId, refs))

      val result = await(repo.findByDataTypeId(dtId))
      result should have size 2
      result.map(_.storageKey).toSet shouldBe Set("uploads/a.pdf", "uploads/b.pdf")
      result.head.createdAt shouldBe fixedInstant
    }

    "second overwriteForDataType call replaces all existing rows (not appends)" in {
      await(
        repo.overwriteForDataType(
          dtId,
          Vector(makeRef(dtId, 0, "document", "uploads/a.pdf"), makeRef(dtId, 1, "document", "uploads/b.pdf"))
        )
      )
      await(repo.findByDataTypeId(dtId)) should have size 2

      val newRefs = Vector(
        makeRef(dtId, 0, "document", "uploads/c.pdf"),
        makeRef(dtId, 1, "document", "uploads/d.pdf"),
        makeRef(dtId, 2, "document", "uploads/e.pdf")
      )
      await(repo.overwriteForDataType(dtId, newRefs))

      val result = await(repo.findByDataTypeId(dtId))
      result should have size 3
      result.map(_.storageKey).toSet shouldBe Set("uploads/c.pdf", "uploads/d.pdf", "uploads/e.pdf")
    }

    "zero-ref overwriteForDataType clears the snapshot" in {
      await(repo.overwriteForDataType(dtId, Vector(makeRef(dtId, 0, "document", "uploads/a.pdf"))))
      await(repo.findByDataTypeId(dtId)) should have size 1

      await(repo.overwriteForDataType(dtId, Vector.empty))

      await(repo.findByDataTypeId(dtId)) shouldBe empty
    }

    "findByDataTypeId returns empty for a DataType with no snapshot" in {
      await(repo.findByDataTypeId(dtId2)) shouldBe empty
    }

    "findByDataTypeIdAndRow returns only refs matching both dataTypeId and rowIndex" in {
      val refs = Vector(
        makeRef(dtId2, 0, "document", "uploads/row0-doc.pdf"),
        makeRef(dtId2, 0, "thumbnail", "uploads/row0-thumb.png"),
        makeRef(dtId2, 1, "document", "uploads/row1-doc.pdf")
      )
      await(repo.overwriteForDataType(dtId2, refs))

      val row0Refs = await(repo.findByDataTypeIdAndRow(dtId2, 0))
      row0Refs should have size 2
      row0Refs.map(_.fieldName).toSet shouldBe Set("document", "thumbnail")

      val row1Refs = await(repo.findByDataTypeIdAndRow(dtId2, 1))
      row1Refs should have size 1
      row1Refs.head.fieldName shouldBe "document"
    }

    "overwriteForDataType is isolated per DataType — refs for one type do not affect another" in {
      val dtA = "dt-binref-iso-a-" + java.util.UUID.randomUUID().toString
      val dtB = "dt-binref-iso-b-" + java.util.UUID.randomUUID().toString

      await(repo.overwriteForDataType(dtA, Vector(makeRef(dtA, 0, "document", "uploads/a1.pdf"))))
      await(
        repo.overwriteForDataType(
          dtB,
          Vector(makeRef(dtB, 0, "document", "uploads/b1.pdf"), makeRef(dtB, 1, "document", "uploads/b2.pdf"))
        )
      )

      await(repo.overwriteForDataType(dtA, Vector(makeRef(dtA, 0, "document", "uploads/a-new.pdf"))))

      await(repo.findByDataTypeId(dtA)) should have size 1
      await(repo.findByDataTypeId(dtB)) should have size 2
    }
  }
}
