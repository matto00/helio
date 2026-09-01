package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.BinaryRefRepository
import com.helio.domain.model.BinaryRef
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.time.temporal.ChronoUnit
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

// HEL-904 (task 3.4): re-keyed from `dataTypeId` to `(pipelineId, nodeStepId)` — the fixture
// below seeds real `pipelines`/`pipeline_steps` rows (both columns are FK-backed, not opaque
// strings) rather than the old free-standing `dtId` string literals.
class BinaryRefRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: BinaryRefRepository           = _

  private val ownerId = java.util.UUID.randomUUID().toString

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
    Await.result(db.run(seedFixture), 10.seconds)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val pipelineId  = "pipeline-binref-spec-" + java.util.UUID.randomUUID().toString
  private val pipelineId2 = "pipeline-binref-spec2-" + java.util.UUID.randomUUID().toString
  private val stepId      = "step-binref-spec-" + java.util.UUID.randomUUID().toString

  /** Minimal source/data-type/pipeline fixture just deep enough to satisfy the still-live
   *  `pipelines.source_data_source_id`/`output_data_type_id` NOT NULL FKs (unrelated to this
   *  spec's actual subject) — mirrors `V94OutputsMigrationSpec`'s own fixture pattern. */
  private def seedFixture: DBIO[Unit] = {
    def sourceAndType(sourceId: String, typeId: String) = DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($sourceId, 'binref-spec-source', 'csv', '{}', $ownerId::uuid, now(), now())"""
    )
    val srcA = "source-binref-spec-a-" + java.util.UUID.randomUUID().toString
    val dtA  = "dt-binref-spec-a-" + java.util.UUID.randomUUID().toString
    val srcB = "source-binref-spec-b-" + java.util.UUID.randomUUID().toString
    val dtB  = "dt-binref-spec-b-" + java.util.UUID.randomUUID().toString
    DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'binref-spec@test.local', now())""",
      sourceAndType(srcA, dtA),
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, created_at, updated_at, owner_id)
             VALUES ($pipelineId, 'binref-spec-pipeline', $srcA, now(), now(), $ownerId::uuid)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at)
             VALUES ($stepId, $pipelineId, 0, 'rename', '{}', true, now(), now())""",
      sourceAndType(srcB, dtB),
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, created_at, updated_at, owner_id)
             VALUES ($pipelineId2, 'binref-spec-pipeline-2', $srcB, now(), now(), $ownerId::uuid)"""
    )
  }

  // Truncate sub-second precision so createdAt round-trips exactly through
  // the TIMESTAMPTZ column (Postgres stores microsecond precision; Instant
  // carries nanoseconds).
  private val fixedInstant = Instant.now().truncatedTo(ChronoUnit.MICROS)

  private def makeRef(pipelineId: String, nodeStepId: Option[String], rowIndex: Int, fieldName: String, key: String): BinaryRef =
    BinaryRef(
      id = java.util.UUID.randomUUID().toString,
      pipelineId = pipelineId,
      nodeStepId = nodeStepId,
      rowIndex = rowIndex,
      fieldName = fieldName,
      storageKey = key,
      mimeType = "application/pdf",
      filename = s"$key.pdf",
      sizeBytes = 1024L,
      createdAt = fixedInstant
    )

  "BinaryRefRepository" should {

    "insert refs via overwriteForNode and retrieve them with findByNode" in {
      val refs = Vector(
        makeRef(pipelineId, Some(stepId), 0, "document", "uploads/a.pdf"),
        makeRef(pipelineId, Some(stepId), 1, "document", "uploads/b.pdf")
      )
      await(repo.overwriteForNode(pipelineId, Some(stepId), refs))

      val result = await(repo.findByNode(pipelineId, Some(stepId)))
      result should have size 2
      result.map(_.storageKey).toSet shouldBe Set("uploads/a.pdf", "uploads/b.pdf")
      result.head.createdAt shouldBe fixedInstant
    }

    "second overwriteForNode call replaces all existing rows (not appends)" in {
      await(
        repo.overwriteForNode(
          pipelineId,
          Some(stepId),
          Vector(makeRef(pipelineId, Some(stepId), 0, "document", "uploads/a.pdf"), makeRef(pipelineId, Some(stepId), 1, "document", "uploads/b.pdf"))
        )
      )
      await(repo.findByNode(pipelineId, Some(stepId))) should have size 2

      val newRefs = Vector(
        makeRef(pipelineId, Some(stepId), 0, "document", "uploads/c.pdf"),
        makeRef(pipelineId, Some(stepId), 1, "document", "uploads/d.pdf"),
        makeRef(pipelineId, Some(stepId), 2, "document", "uploads/e.pdf")
      )
      await(repo.overwriteForNode(pipelineId, Some(stepId), newRefs))

      val result = await(repo.findByNode(pipelineId, Some(stepId)))
      result should have size 3
      result.map(_.storageKey).toSet shouldBe Set("uploads/c.pdf", "uploads/d.pdf", "uploads/e.pdf")
    }

    "zero-ref overwriteForNode clears the snapshot" in {
      await(repo.overwriteForNode(pipelineId, Some(stepId), Vector(makeRef(pipelineId, Some(stepId), 0, "document", "uploads/a.pdf"))))
      await(repo.findByNode(pipelineId, Some(stepId))) should have size 1

      await(repo.overwriteForNode(pipelineId, Some(stepId), Vector.empty))

      await(repo.findByNode(pipelineId, Some(stepId))) shouldBe empty
    }

    "findByNode returns empty for a node with no snapshot" in {
      await(repo.findByNode(pipelineId2, None)) shouldBe empty
    }

    "findByNode with nodeStepId = None resolves the pipeline's trunk root, distinct from a real step id" in {
      await(repo.overwriteForNode(pipelineId2, None, Vector(makeRef(pipelineId2, None, 0, "document", "uploads/root.pdf"))))

      await(repo.findByNode(pipelineId2, None)) should have size 1
      await(repo.findByNode(pipelineId2, Some(stepId))) shouldBe empty
    }

    "findByNodeAndRow returns only refs matching both node and rowIndex" in {
      val refs = Vector(
        makeRef(pipelineId2, None, 0, "document", "uploads/row0-doc.pdf"),
        makeRef(pipelineId2, None, 0, "thumbnail", "uploads/row0-thumb.png"),
        makeRef(pipelineId2, None, 1, "document", "uploads/row1-doc.pdf")
      )
      await(repo.overwriteForNode(pipelineId2, None, refs))

      val row0Refs = await(repo.findByNodeAndRow(pipelineId2, None, 0))
      row0Refs should have size 2
      row0Refs.map(_.fieldName).toSet shouldBe Set("document", "thumbnail")

      val row1Refs = await(repo.findByNodeAndRow(pipelineId2, None, 1))
      row1Refs should have size 1
      row1Refs.head.fieldName shouldBe "document"
    }

    "overwriteForNode is isolated per node — refs for one pipeline do not affect another" in {
      await(repo.overwriteForNode(pipelineId, Some(stepId), Vector(makeRef(pipelineId, Some(stepId), 0, "document", "uploads/a1.pdf"))))
      await(
        repo.overwriteForNode(
          pipelineId2,
          None,
          Vector(makeRef(pipelineId2, None, 0, "document", "uploads/b1.pdf"), makeRef(pipelineId2, None, 1, "document", "uploads/b2.pdf"))
        )
      )

      await(repo.overwriteForNode(pipelineId, Some(stepId), Vector(makeRef(pipelineId, Some(stepId), 0, "document", "uploads/a-new.pdf"))))

      await(repo.findByNode(pipelineId, Some(stepId))) should have size 1
      await(repo.findByNode(pipelineId2, None)) should have size 2
    }
  }
}
