package com.helio.domain

import com.helio.infrastructure.{DataSourceRepository, FileSystem}
import PipelineRowJson.{Row, parseStaticRows}

import java.nio.charset.StandardCharsets
import scala.concurrent.{ExecutionContext, Future}

/** In-process pipeline executor.
 *
 *  Cycle 3 reduces this to a thin orchestration shell — `applyStep` becomes
 *  `step.evaluate(rows, ctx)` and per-kind logic lives in
 *  [[com.helio.domain.steps]] modules. The engine's remaining responsibility
 *  is row-source loading (static / csv) and assembling the
 *  [[PipelineExecutionContext]] every step receives. */
class InProcessPipelineEngine(fileSystem: FileSystem)(implicit ec: ExecutionContext) {

  def execute(
      rows: Seq[Row],
      steps: Seq[PipelineStep],
      dataSourceRepo: DataSourceRepository
  ): Future[Seq[Row]] =
    executeWithStepCounts(rows, steps, dataSourceRepo).map(_._1)

  /** Run the pipeline, returning both the final rows and the per-step output
   *  row counts (keyed by step id). */
  def executeWithStepCounts(
      rows: Seq[Row],
      steps: Seq[PipelineStep],
      dataSourceRepo: DataSourceRepository
  ): Future[(Seq[Row], Map[String, Long])] = {
    val ctx = makeContext(dataSourceRepo)
    val initial: Future[(Seq[Row], Map[String, Long])] =
      Future.successful((rows, Map.empty[String, Long]))
    steps.foldLeft(initial) { (acc, step) =>
      acc.flatMap { case (currentRows, counts) =>
        step.evaluate(currentRows, ctx).map { nextRows =>
          (nextRows, counts.updated(step.id.value, nextRows.size.toLong))
        }
      }
    }
  }

  /** Load the initial rows for a pipeline's source data source. Static /
   *  CSV are supported in-process; other source kinds belong on the Spark
   *  path. */
  def loadRows(ds: DataSource, dataSourceRepo: DataSourceRepository): Future[Seq[Row]] = ds match {
    case s: StaticSource =>
      dataSourceRepo.readRawConfig(s.id).map {
        case None      => Seq.empty
        case Some(raw) => parseStaticRows(raw)
      }
    case c: CsvSource =>
      if (c.config.path.isEmpty)
        Future.failed(
          new IllegalArgumentException(
            "CSV data source '" + c.name + "' (id=" + c.id.value +
              ") is missing required config key 'path'"
          )
        )
      else fileSystem.read(c.config.path).map(loadCsvRowsFromBytes)
    case t: TextSource =>
      if (t.config.path.isEmpty)
        Future.failed(
          new IllegalArgumentException(
            "Text data source '" + t.name + "' (id=" + t.id.value +
              ") is missing required config key 'path'"
          )
        )
      else fileSystem.read(t.config.path).map(loadTextRowFromBytes(t.config.path, _))
    case other =>
      Future.failed(
        new IllegalArgumentException(
          "Unsupported source type for in-process pipeline engine: " +
            other.kind + ". Only static and csv are supported."
        )
      )
  }

  /** Build the execution context handed to every step. `loadSource` closes
   *  over the engine's own [[loadRows]] so each step can re-enter the same
   *  source-loading dispatch without needing the engine reference itself. */
  private def makeContext(dataSourceRepo: DataSourceRepository): PipelineExecutionContext =
    PipelineExecutionContext(
      dataSourceRepo = dataSourceRepo,
      loadSource     = (ds: DataSource) => loadRows(ds, dataSourceRepo)
    )

  // ── Text loader (HEL-215): single-row loader, deliberately not shared with
  // CSV's multi-row loader — a future connector (HEL-214 PDF, HEL-216 image)
  // adds its own `loadRows` case with its own extraction logic rather than
  // generalizing this over three data points. ──────────────────────────────

  private def loadTextRowFromBytes(path: String, bytes: Array[Byte]): Seq[Row] = {
    val content  = new String(bytes, StandardCharsets.UTF_8)
    val filename = java.nio.file.Paths.get(path).getFileName.toString
    Seq(Map("content" -> content, "filename" -> filename, "sizeBytes" -> bytes.length.toLong))
  }

  // ── CSV loader (inline minimal parser to avoid an extra dep) ─────────────

  private def loadCsvRowsFromBytes(bytes: Array[Byte]): Seq[Row] = {
    val content = new String(bytes, StandardCharsets.UTF_8)
    val lines   = content.linesIterator.toVector
    if (lines.isEmpty) return Seq.empty
    val headers = parseCsvLine(lines.head)
    lines.tail.map { line =>
      val values = parseCsvLine(line)
      val padded = values.padTo(headers.size, "")
      headers.zip(padded).map { case (h, v) => h -> v.asInstanceOf[Any] }.toMap
    }
  }

  private def parseCsvLine(line: String): Vector[String] = {
    val buf     = scala.collection.mutable.ArrayBuffer.empty[String]
    val sb      = new StringBuilder
    var inQuote = false
    var i       = 0
    while (i < line.length) {
      val c = line(i)
      if (inQuote) {
        if (c == '"') {
          if (i + 1 < line.length && line(i + 1) == '"') {
            sb += '"'; i += 2
          } else {
            inQuote = false; i += 1
          }
        } else {
          sb += c; i += 1
        }
      } else {
        if (c == '"') {
          inQuote = true; i += 1
        } else if (c == ',') {
          buf += sb.toString; sb.clear(); i += 1
        } else {
          sb += c; i += 1
        }
      }
    }
    buf += sb.toString
    buf.toVector
  }
}
