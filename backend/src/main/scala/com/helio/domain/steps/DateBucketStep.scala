package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.format.DateTimeFormatterBuilder
import java.time.temporal.{ChronoField, TemporalAdjusters}
import java.time.{DayOfWeek, Instant, LocalDate, LocalDateTime, OffsetDateTime, ZoneOffset}
import java.time.format.DateTimeFormatter
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `datebucket` step (HEL-378). `granularity` selects
 *  the bucket width (`day`/`week`/`month`/`quarter`/`year`); `outputColumn`
 *  is optional — when absent (or blank), the bucketed value overwrites
 *  `field` in place. */
final case class DateBucketConfig(field: String, granularity: String, outputColumn: Option[String])

object DateBucketConfig {
  implicit val format: RootJsonFormat[DateBucketConfig] = jsonFormat3(DateBucketConfig.apply)

  def decode(raw: String): DateBucketConfig = {
    val obj          = StepCodecUtil.asObject(raw)
    val field        = StepCodecUtil.str(obj, "field", "")
    val granularity  = StepCodecUtil.str(obj, "granularity", "")
    val outputColumn = StepCodecUtil.strOpt(obj, "outputColumn")
    DateBucketConfig(field, granularity, outputColumn)
  }
}

/** DateBucket step — floors a timestamp `field` to the start of a
 *  `granularity` bucket (`day`/`week`/`month`/`quarter`/`year`), writing the
 *  canonical `yyyy-MM-dd` ISO date string to `outputColumn` (or `field` if
 *  absent). UTC only — see design.md decisions 1/2 for the parsing/flooring
 *  rules.
 *
 *  Per-row parsing failures yield `null` for that row's output field (parity
 *  with `CastStep`'s null-on-failure contract, design.md decision 1); an
 *  unsupported `granularity` is a step misconfiguration, not a per-row
 *  problem, so it fails the whole step with a descriptive error before any
 *  row is processed (design.md decision 3, mirrors `GroupByStep`/
 *  `AggregateStep`'s config-level-error surfacing). */
final case class DateBucketStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: DateBucketConfig,
    createdAt: Instant,
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = DateBucketStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    DateBucketStep.floorFn(config.granularity) match {
      case Left(err) => Future.failed(new IllegalArgumentException(err))
      case Right(floor) =>
        val result = DateBucketStep.apply(rows, config, floor)
        val outputCol = config.outputColumn.filter(_.nonEmpty).getOrElse(config.field)
        val nonBlankInputCount = rows.count { row =>
          row.get(config.field) match {
            case Some(v) if v != null && v.toString.trim.nonEmpty => true
            case _                                                => false
          }
        }
        val nonNullOutputCount = result.count { row =>
          row.get(outputCol) match {
            case Some(v) if v != null => true
            case _                    => false
          }
        }
        if (nonBlankInputCount > 0 && nonNullOutputCount == 0)
          Future.failed(new IllegalArgumentException(
            s"datebucket: none of $nonBlankInputCount row(s) with a value at field '${config.field}' " +
              "could be parsed as a timestamp/date."
          ))
        else
          Future.successful(result)
    }
}

object DateBucketStep {
  val Kind: String = "datebucket"

  private val SupportedGranularities = Vector("day", "week", "month", "quarter", "year")

  /** Resolve `granularity` to a `LocalDate => LocalDate` flooring function, or
   *  a descriptive error if `granularity` isn't one of the five supported
   *  values. **Week buckets floor to the Monday of the containing ISO-8601
   *  week** (weeks start Monday, not Sunday) — this is the documented week
   *  boundary policy called out by the acceptance criteria. */
  private def floorFn(granularity: String): Either[String, LocalDate => LocalDate] =
    granularity match {
      case "day"  => Right(identity)
      case "week" => Right(_.`with`(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)))
      case "month" => Right(_.withDayOfMonth(1))
      case "quarter" =>
        Right(d => d.withMonth(((d.getMonthValue - 1) / 3) * 3 + 1).withDayOfMonth(1))
      case "year" => Right(_.withDayOfYear(1))
      case other =>
        Left(
          s"Unsupported granularity: '$other'. Valid values: ${SupportedGranularities.mkString(", ")}."
        )
    }

  def apply(
      rows: Seq[PipelineRowJson.Row],
      cfg: DateBucketConfig,
      floor: LocalDate => LocalDate
  ): Seq[PipelineRowJson.Row] = {
    val field     = cfg.field
    val outputCol = cfg.outputColumn.filter(_.nonEmpty).getOrElse(field)
    rows.map { row =>
      val bucketed = parseToUtcDate(row.getOrElse(field, null)).map(floor).map(_.toString).orNull
      row + (outputCol -> bucketed)
    }
  }

  /** Space-separated tz-less timestamp formatter (`2026-07-01 12:00:00`,
   *  `2026-07-01 12:00`, with an optional **variable-length** (0-9 digit)
   *  fractional-seconds component). Built via `DateTimeFormatterBuilder`
   *  with `appendFraction(NANO_OF_SECOND, 0, 9, true)` rather than a fixed
   *  `[.SSS]` literal pattern — a fixed pattern requires exactly 3 digits
   *  and silently rejects both 1-digit and 6-digit (microsecond, the
   *  Postgres/pandas default) widths, reintroducing this bug's all-null
   *  failure mode for the most common real-world width (design.md decision 1,
   *  skeptic round-1 correction). */
  private val SpaceSeparatedFormatter = new DateTimeFormatterBuilder()
    .appendPattern("yyyy-MM-dd HH:mm[:ss]")
    .appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)
    .toFormatter()

  /** Parse a row value into a UTC `LocalDate`, or `None` if it doesn't match
   *  any of the tolerated input shapes (design.md decision 1):
   *   - a numeric epoch value — treated as epoch **milliseconds** if its
   *     magnitude exceeds 10 digits, else epoch **seconds**
   *   - an ISO-8601 instant/offset string (`Instant.parse` / `OffsetDateTime.parse`)
   *   - a T-separated tz-less local-datetime string (`ISO_LOCAL_DATE_TIME`,
   *     e.g. `2026-03-14T22:08:39`, optionally with fractional seconds),
   *     interpreted as UTC
   *   - a space-separated tz-less local-datetime string (e.g.
   *     `2026-07-01 12:00:00`, with an optional variable-length
   *     fractional-seconds component), interpreted as UTC
   *   - a bare `yyyy-MM-dd` `LocalDate` string
   *  Both tz-less `LocalDateTime` forms are tried after the offset-bearing
   *  branches (so already-correct offset/`Z` input is unaffected) and before
   *  the bare-`LocalDate` fallback (so `2026-03-14` still matches
   *  `LocalDate.parse` rather than being short-circuited).
   *  Unparseable input (including `null`/absent/blank) returns `None`, which
   *  the caller maps to a `null` output value — no row is dropped. */
  private def parseToUtcDate(value: Any): Option[LocalDate] = {
    if (value == null) return None
    val str = value.toString.trim
    if (str.isEmpty) return None

    val epochDate: Option[LocalDate] = Try(str.toLong).toOption.map { epoch =>
      val instant =
        if (math.abs(epoch) > 9999999999L) Instant.ofEpochMilli(epoch) else Instant.ofEpochSecond(epoch)
      instant.atZone(ZoneOffset.UTC).toLocalDate
    }

    epochDate
      .orElse(Try(Instant.parse(str).atZone(ZoneOffset.UTC).toLocalDate).toOption)
      .orElse(Try(OffsetDateTime.parse(str).atZoneSameInstant(ZoneOffset.UTC).toLocalDate).toOption)
      .orElse(Try(LocalDateTime.parse(str, DateTimeFormatter.ISO_LOCAL_DATE_TIME).atZone(ZoneOffset.UTC).toLocalDate).toOption)
      .orElse(Try(LocalDateTime.parse(str, SpaceSeparatedFormatter).atZone(ZoneOffset.UTC).toLocalDate).toOption)
      .orElse(Try(LocalDate.parse(str)).toOption)
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = DateBucketConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[DateBucketConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[DateBucketConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[DateBucketConfig].toJson

    /** HEL-814 D3. With `outputColumn` absent (spec `:11` makes it optional),
     *  an empty `field` makes the op write its bucketed value into a column
     *  named `""` — the same corruption as `compute`. `granularity` is NOT
     *  re-declared here: `pipeline-date-bucket-op:23-24` already requires a
     *  descriptive run failure for an unsupported value, and `""` is one. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      StepCodecUtil.missingRequired(Kind, "field" -> DateBucketConfig.decode(raw).field)
  }
}
