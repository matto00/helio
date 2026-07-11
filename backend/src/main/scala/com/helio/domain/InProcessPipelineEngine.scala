package com.helio.domain

import com.helio.infrastructure.{DataSourceRepository, FileSystem}
import com.helio.services.{ImageSourceSupport, PdfTextSupport}
import PipelineRowJson.{Row, parseStaticRows}

import java.nio.charset.StandardCharsets
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

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
    case p: PdfSource =>
      if (p.config.path.isEmpty)
        Future.failed(
          new IllegalArgumentException(
            "PDF data source '" + p.name + "' (id=" + p.id.value +
              ") is missing required config key 'path'"
          )
        )
      else fileSystem.read(p.config.path).flatMap(loadPdfRowsFromBytes(p, _))
    case i: ImageSource =>
      if (i.config.path.isEmpty)
        Future.failed(
          new IllegalArgumentException(
            "Image data source '" + i.name + "' (id=" + i.id.value +
              ") is missing required config key 'path'"
          )
        )
      else
        fileSystem.read(i.config.path).flatMap { bytes =>
          loadImageRowFromBytes(i.config.path, bytes) match {
            case Right(row) => Future.successful(row)
            case Left(msg)  => Future.failed(new IllegalArgumentException(msg))
          }
        }
    case other =>
      Future.failed(
        new IllegalArgumentException(
          "Unsupported source type for in-process pipeline engine: " +
            other.kind + ". Only static, csv, text, pdf, and image are supported."
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
  // CSV's multi-row loader — HEL-214 (PDF) and HEL-216 (Image, below) each add
  // their own `loadRows` case with its own extraction logic rather than
  // generalizing this over multiple data points. ───────────────────────────

  private def loadTextRowFromBytes(path: String, bytes: Array[Byte]): Seq[Row] = {
    val content  = new String(bytes, StandardCharsets.UTF_8)
    val filename = java.nio.file.Paths.get(path).getFileName.toString
    Seq(Map("content" -> content, "filename" -> filename, "sizeBytes" -> bytes.length.toLong))
  }

  // ── PDF loader (HEL-214): multi-row loader (one row per page) — the first
  // content connector whose `loadRows` case produces more than one row.
  // Extraction is deferred to this pipeline-run-time call, per the
  // pipeline-only-bindings invariant; ingest time only validates the file is
  // a well-formed, non-encrypted PDF (see `PdfTextSupport.validate`). ───────

  private def loadPdfRowsFromBytes(source: PdfSource, bytes: Array[Byte]): Future[Seq[Row]] =
    PdfTextSupport.extractPages(bytes) match {
      case Success(pages) =>
        val filename  = java.nio.file.Paths.get(source.config.path).getFileName.toString
        val pageCount = pages.size
        Future.successful(pages.zipWithIndex.map { case (text, idx) =>
          Map(
            "content"        -> text,
            "filename"       -> filename,
            "sizeBytes"      -> bytes.length.toLong,
            "pageNumber"     -> (idx + 1),
            "pageCount"      -> pageCount,
            "characterCount" -> text.length
          )
        })
      case Failure(e) =>
        Future.failed(
          new IllegalArgumentException(
            "PDF data source '" + source.name + "' (id=" + source.id.value +
              ") could not be parsed: " + e.getMessage
          )
        )
    }

  // ── Image loader (HEL-216): own case, deliberately not shared with
  // TextSource's loader, per HEL-215's design note that this dispatch is
  // per-connector rather than generalized. `content` carries the nested
  // `binary-ref` map (`storageKey`, `mimeType`, `filename`, `sizeBytes`);
  // width/height/mimeType are also surfaced as top-level fields. ───────────

  private def loadImageRowFromBytes(path: String, bytes: Array[Byte]): Either[String, Seq[Row]] = {
    val filename = java.nio.file.Paths.get(path).getFileName.toString
    ImageSourceSupport.dimensionsAndMime(bytes, filename).map { case (width, height, mimeType) =>
      val content: Map[String, Any] = Map(
        "storageKey" -> path,
        "mimeType"   -> mimeType,
        "filename"   -> filename,
        "sizeBytes"  -> bytes.length.toLong
      )
      Seq(
        Map(
          "content"   -> content,
          "filename"  -> filename,
          "sizeBytes" -> bytes.length.toLong,
          "mimeType"  -> mimeType,
          "width"     -> width,
          "height"    -> height
        )
      )
    }
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
