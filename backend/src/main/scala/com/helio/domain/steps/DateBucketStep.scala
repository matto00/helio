package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, StepGroup}
import com.helio.domain.engine.{PipelineRowJson, TimestampParsing}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.temporal.TemporalAdjusters
import java.time.{DayOfWeek, Instant, LocalDate, ZoneOffset}
import scala.concurrent.{ExecutionContext, Future}

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
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = DateBucketStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    DateBucketStep.floorFn(config.granularity) match {
      case Left(err) => Future.failed(new StepConfigError(err))
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

  /** `true` when `datebucket` could bucket `value` (HEL-1436 D3: lets `cast` keep exactly the values
   *  this op reads). */
  def parsesAsDate(value: Any): Boolean = parseToUtcDate(value).isDefined

  /** The UTC `LocalDate` of a row value, read through the shared [[TimestampParsing.parseInstant]]
   *  (the single definition of the accepted input shapes). Unparseable input (including
   *  `null`/absent/blank) returns `None`, which the caller maps to a `null` output value -- no row is
   *  dropped. `WindowRolling` reads its day-based frames through this too. */
  private[steps] def parseToUtcDate(value: Any): Option[LocalDate] =
    TimestampParsing.parseInstant(value).map(_.atZone(ZoneOffset.UTC).toLocalDate)

  /** Every accepted input shape except a bare epoch number. Shared with the first-run builder's
   *  date-like column test (HEL-1209) so "looks like a date" can never drift from what
   *  `datebucket` would actually bucket. */
  def parseNonEpochDate(str: String): Option[LocalDate] =
    TimestampParsing.parseNonEpochInstant(str).map(_.atZone(ZoneOffset.UTC).toLocalDate)

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    override def group: Option[StepGroup]     = Some(StepGroup.Aggregate)
    override def catalogDescription: String   = "Bucket a date/time column into a coarser granularity, like day or month."
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
