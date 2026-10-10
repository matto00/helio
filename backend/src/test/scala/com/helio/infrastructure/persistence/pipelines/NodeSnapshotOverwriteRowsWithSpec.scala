package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.testsupport.OutputHistoryFixtures
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject}

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1271 D9: the history insert and the snapshot replace are ONE transaction. */
class NodeSnapshotOverwriteRowsWithSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var snapshots: NodeSnapshotRepository  = _
  private var history: OutputHistoryRepository   = _

  override protected def seedDb: JdbcBackend.Database = db

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    snapshots = new NodeSnapshotRepository(ctx)
    history = new OutputHistoryRepository(ctx)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def rows(n: Int): Vector[JsObject] = (1 to n).map(i => JsObject("v" -> JsNumber(i))).toVector

  private def stored(pid: String): Vector[Int] =
    awaitDb(snapshots.listRows(pid, None, explicitRootId = Some(pid))).map(_.fields("v").toString.toInt)

  "overwriteRowsWith" should {

    "replace the snapshot and insert the history entries together" in {
      val (pid, oid) = seedPipelineWithOutput(seedUser())
      awaitDb(snapshots.overwriteRows(pid, None, rows(2), Some(pid)))
      awaitDb(snapshots.overwriteRowsWith(pid, None, rows(3), Some(pid), history.insertAction(Vector(historyEntry(oid, pid, Instant.now())))))
      stored(pid) shouldBe Vector(1, 2, 3)
      historyCount(oid) shouldBe 1
    }

    "leave the previous snapshot untouched when the history insert fails" in {
      val (pid, _) = seedPipelineWithOutput(seedUser())
      awaitDb(snapshots.overwriteRows(pid, None, rows(2), Some(pid)))
      val orphan = historyEntry(UUID.randomUUID().toString, pid, Instant.now())
      an[Exception] should be thrownBy awaitDb(
        snapshots.overwriteRowsWith(pid, None, rows(5), Some(pid), history.insertAction(Vector(orphan)))
      )
      stored(pid) shouldBe Vector(1, 2)
    }
  }

  "overwriteRows" should {
    "write no history (the backfill's entry point)" in {
      val (pid, oid) = seedPipelineWithOutput(seedUser())
      awaitDb(snapshots.overwriteRows(pid, None, rows(2), Some(pid)))
      historyCount(oid) shouldBe 0
    }
  }
}
