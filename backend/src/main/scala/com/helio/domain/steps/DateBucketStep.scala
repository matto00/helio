package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.temporal.TemporalAdjusters
import java.time.{DayOfWeek, Instant, LocalDate, OffsetDateTime, ZoneOffset}
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
    val obj         = StepCodecUtil.asObject(raw)
    val field       = StepCodecUtil.stringOr(obj, "field", "")
    val granularity = StepCodecUtil.stringOr(obj, "granularity", "")
    val outputColumn = obj.fields.get("outputColumn") match {
      case Some(JsString(s)) => Some(s)
      case _                 => None
    }
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

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    DateBucketStep.floorFn(config.granularity) match {
      case Left(err)    => Future.failed(new IllegalArgumentException(err))
      case Right(floor) => Future.successful(DateBucketStep.apply(rows, config, floor))
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

  /** Parse a row value into a UTC `LocalDate`, or `None` if it doesn't match
   *  any of the three tolerated input shapes (design.md decision 1):
   *   - a numeric epoch value — treated as epoch **milliseconds** if its
   *     magnitude exceeds 10 digits, else epoch **seconds**
   *   - an ISO-8601 instant/offset string (`Instant.parse` / `OffsetDateTime.parse`)
   *   - a bare `yyyy-MM-dd` `LocalDate` string
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
      .orElse(Try(LocalDate.parse(str)).toOption)
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = DateBucketConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[DateBucketConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[DateBucketConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[DateBucketConfig].toJson
  }
}
