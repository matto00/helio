package com.helio.testsupport

import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model.{CsvSource, CsvSourceConfig, DataSourceId, UserId}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.testkit.TempDirectorySupport
import org.scalatest.Suite

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-1408: loads CSV text through the REAL `InProcessPipelineEngine.loadRows` CSV loader, so a
 *  spec asserting "a blank cell does X" runs over rows the production loader produced rather than
 *  hand-built null rows. */
trait CsvLoadSupport extends TempDirectorySupport { self: Suite =>

  private implicit val csvEc: ExecutionContext = ExecutionContext.global
  private val csvEngine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))

  /** Writes `csv` verbatim to a temp file and loads it through the production CSV loader. */
  protected def loadCsv(csv: String): Seq[Map[String, Any]] = {
    val tmp = newTempFile("helio-csv-load-", ".csv")
    Files.write(tmp, csv.getBytes(StandardCharsets.UTF_8))
    val ds = CsvSource(
      id        = DataSourceId("ds-csv-load"),
      name      = "csv-load",
      ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
      createdAt = Instant.now(),
      updatedAt = Instant.now(),
      config    = CsvSourceConfig(tmp.toAbsolutePath.toString)
    )
    Await.result(csvEngine.loadRows(ds, null), 10.seconds)
  }
}
