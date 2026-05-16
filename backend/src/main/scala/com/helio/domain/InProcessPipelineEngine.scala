package com.helio.domain

import com.helio.infrastructure.{DataSourceRepository, FileSystem}
import PipelineStepHandlers.{
  Row,
  applyAggregate,
  applyCast,
  applyCompute,
  applyFilter,
  applyGroupBy,
  applyJoin,
  applyLimit,
  applyRename,
  applySelect,
  applySort,
  parseStaticRows
}

import java.nio.charset.StandardCharsets
import scala.concurrent.{ExecutionContext, Future}

/** In-process pipeline executor.
 *
 *  CS2c-3a turns the previous 11-case `match { case "filter" => ... }` into
 *  typed sealed-trait dispatch over [[PipelineStep]]. Per-kind logic lives in
 *  [[PipelineStepHandlers]] so this file stays a thin orchestration shell
 *  (execute → fold over steps → dispatch). */
class InProcessPipelineEngine(fileSystem: FileSystem)(implicit ec: ExecutionContext) {

  def execute(
      rows: Seq[Row],
      steps: Seq[PipelineStep],
      dataSourceRepo: DataSourceRepository
  ): Future[Seq[Row]] =
    executeWithStepCounts(rows, steps, dataSourceRepo).map(_._1)

  /** Run the pipeline, returning both the final rows and the per-step output
   *  row counts. Counts are keyed by step id and reflect the row count after
   *  each step's transformation. */
  def executeWithStepCounts(
      rows: Seq[Row],
      steps: Seq[PipelineStep],
      dataSourceRepo: DataSourceRepository
  ): Future[(Seq[Row], Map[String, Long])] = {
    val initial: Future[(Seq[Row], Map[String, Long])] =
      Future.successful((rows, Map.empty[String, Long]))
    steps.foldLeft(initial) { (acc, step) =>
      acc.flatMap { case (currentRows, counts) =>
        applyStep(currentRows, step, dataSourceRepo).map { nextRows =>
          (nextRows, counts.updated(step.id.value, nextRows.size.toLong))
        }
      }
    }
  }

  def loadRows(ds: DataSource, dataSourceRepo: DataSourceRepository): Future[Seq[Row]] = ds match {
    case s: StaticSource =>
      // Static-source rows live in the `data_sources.config` JSON column.
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
    case other =>
      Future.failed(
        new IllegalArgumentException(
          "Unsupported source type for in-process pipeline engine: " +
            other.kind + ". Only static and csv are supported."
        )
      )
  }

  /** Sealed-trait dispatch. The compiler enforces handler coverage — adding
   *  an 11th step kind without adding its match arm fails compilation. */
  private def applyStep(
      rows: Seq[Row],
      step: PipelineStep,
      dataSourceRepo: DataSourceRepository
  ): Future[Seq[Row]] = step match {
    case s: RenameStep    => Future.successful(applyRename(rows, s.config))
    case s: FilterStep    => Future.successful(applyFilter(rows, s.config))
    case s: ComputeStep   => Future.successful(applyCompute(rows, s.config))
    case s: GroupByStep   => Future.successful(applyGroupBy(rows, s.config))
    case s: AggregateStep => Future.successful(applyAggregate(rows, s.config))
    case s: CastStep      => Future.successful(applyCast(rows, s.config))
    case s: JoinStep      =>
      applyJoin(rows, s.config, dataSourceRepo, ds => loadRows(ds, dataSourceRepo))
    case s: SelectStep    => Future.successful(applySelect(rows, s.config))
    case s: LimitStep     => Future.successful(applyLimit(rows, s.config))
    case s: SortStep      => Future.successful(applySort(rows, s.config))
  }

  // ── CSV loader (uses an inline minimal parser to avoid an extra dep) ─────

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
