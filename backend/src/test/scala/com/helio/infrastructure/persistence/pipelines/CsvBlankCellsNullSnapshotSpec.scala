package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.engine.{InProcessPipelineEngine, PipelineRowJson}
import com.helio.domain.model.{CsvSource, CsvSourceConfig, DataSourceId, Page, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository.{FilterSpec, OpSpec, SortCast, SortDirection, SortSpec}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.testkit.TempDirectorySupport
import com.helio.testsupport.OutputHistoryFixtures
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.{JsNull, JsObject, JsString}

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}
import java.time.Instant
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt
import scala.concurrent.Await

/** HEL-1408: a CSV blank is null, so what lands in `node_snapshots` is JSON null. These cases load
 *  the snapshot rows through the REAL CSV loader and then read them through the real repository:
 *  the distinct-values / dropdown read no longer lists blanks, the blank-category `eq ""` filter
 *  matches both a fresh null AND a legacy stored `""` (design D10b), and a server sort puts blanks
 *  last ascending (design D7b, `NULLS LAST`). */
class CsvBlankCellsNullSnapshotSpec
    extends AnyWordSpec
    with Matchers
    with BeforeAndAfterAll
    with OutputHistoryFixtures
    with TempDirectorySupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var snapshots: NodeSnapshotRepository  = _

  override protected def seedDb: JdbcBackend.Database = db

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    snapshots = new NodeSnapshotRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def csvRows(csv: String): Vector[JsObject] = {
    val tmp = newTempFile("helio-csv-blank-snap-", ".csv")
    Files.write(tmp, csv.getBytes(StandardCharsets.UTF_8))
    val ds = CsvSource(
      DataSourceId("ds-snap"), "snap", UserId("00000000-0000-0000-0000-000000000001"),
      Instant.now(), Instant.now(), CsvSourceConfig(tmp.toAbsolutePath.toString)
    )
    Await.result(engine.loadRows(ds, null), 10.seconds).map(r => JsObject(PipelineRowJson.rowToJsMap(r))).toVector
  }

  private val csv = "team,score\na,1\n,2\nb,3\n,4\na,5\n"
  // A snapshot materialized before this change holds a stored "" for a blank (design D8).
  private val legacyBlank = JsObject("team" -> JsString(""), "score" -> JsString("9"))

  private def seed(extra: Vector[JsObject] = Vector.empty): String = {
    val (pid, _) = seedPipelineWithOutput(seedUser())
    awaitDb(snapshots.overwriteRows(pid, None, csvRows(csv) ++ extra, Some(pid)))
    pid
  }

  private def scores(pid: String, filter: Option[FilterSpec] = None, sort: Option[SortSpec] = None): Vector[String] =
    awaitDb(snapshots.listRowsPaged(pid, None, Page(0, 50), explicitRootId = Some(pid), sort = sort, filter = filter))
      .items.map(_.fields("score").asInstanceOf[JsString].value)

  "a CSV-loaded snapshot with blank cells" should {

    "store the blank as JSON null" in {
      csvRows(csv).map(_.fields("team")) shouldBe Vector(JsString("a"), JsNull, JsString("b"), JsNull, JsString("a"))
    }

    "not list blanks in the distinct-values / dropdown read, nor count them as a distinct value" in {
      val pid = seed()
      awaitDb(snapshots.topDistinctValues(pid, None, Some(pid), "team", 50)).toSet shouldBe Set(("a", 2), ("b", 1))
      awaitDb(snapshots.distinctValueCountCapped(pid, None, Some(pid), "team", 51)) shouldBe 2
    }

    "report the row count without the skipped blank lines" in {
      val pid = seed()
      awaitDb(snapshots.countRows(pid, None, Some(pid))) shouldBe 5L
      csvRows("team,score\na,1\n\n   \nb,2\n").size shouldBe 2
    }

    "eq \"\" matches fresh null cells AND a legacy stored \"\" cell, for every cast (design D10b)" in {
      val pid = seed(Vector(legacyBlank))
      for (cast <- Vector(SortCast.AsText, SortCast.AsNumeric)) {
        val filter = FilterSpec(None, Vector.empty, Map.empty, Vector(OpSpec.Eq("team", cast, "")))
        withClue(s"cast=$cast ") { scores(pid, Some(filter)).toSet shouldBe Set("2", "4", "9") }
      }
    }

    "eq with a non-empty value still matches only that value" in {
      val pid = seed(Vector(legacyBlank))
      val filter = FilterSpec(None, Vector.empty, Map.empty, Vector(OpSpec.Eq("team", SortCast.AsText, "a")))
      scores(pid, Some(filter)).toSet shouldBe Set("1", "5")
    }

    "sort ascending puts the blank (null) cells last (NULLS LAST)" in {
      val pid = seed()
      val sorted = scores(pid, sort = Some(SortSpec("team", SortDirection.Asc, SortCast.AsText)))
      sorted.takeRight(2).toSet shouldBe Set("2", "4")
      sorted.take(3) shouldBe Vector("1", "5", "3")
    }
  }
}
