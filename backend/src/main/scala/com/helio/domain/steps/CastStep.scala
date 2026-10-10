package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, StepGroup}
import com.helio.domain.engine.PipelineRowJson
import com.helio.domain.engine.TimestampParsing
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `cast` step. The map's keys are field names; the
 *  values are target type names (see [[CastStep.SupportedTargets]]). Fields
 *  not in the map pass through unchanged. */
final case class CastConfig(casts: Map[String, String])

object CastConfig {
  implicit val format: RootJsonFormat[CastConfig] = jsonFormat1(CastConfig.apply)

  def decode(raw: String): CastConfig = {
    val obj   = StepCodecUtil.asObject(raw)
    val casts = StepCodecUtil.stringMap(obj, "casts", CastStep.CastsShape)
    CastConfig(casts)
  }
}

/** Cast step — converts each listed field's value to the named target type.
 *  Conversion failures yield `null` for that field on that row (parity with
 *  the pre-CS2c-3a engine; `null` is preferable to a hard fail because cast
 *  steps frequently sit upstream of filter / aggregate steps that already
 *  tolerate nulls). */
final case class CastStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: CastConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = CastStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(CastStep.apply(rows, config))
}

object CastStep {
  val Kind: String = "cast"

  /** HEL-860's per-key shape wording for `casts`, shared by the write-path
   *  validator and the strict decoder so one edit changes both. */
  val CastsShape: String = "field name to type name"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: CastConfig): Seq[PipelineRowJson.Row] = {
    val casts = cfg.casts
    rows.map { row =>
      casts.foldLeft(row) { case (r, (field, targetType)) =>
        val rawValue = r.getOrElse(field, null)
        r + (field -> castValue(rawValue, targetType))
      }
    }
  }

  /** The cast targets the run-time can honestly produce (HEL-1436 D1). The write validator, `castValue`
   *  and the analyze-warning trust set all derive from this one list. */
  val SupportedTargets: Vector[String] =
    Vector("string", "integer", "long", "float", "double", "number", "boolean", "date", "timestamp")

  private def castValue(v: Any, dataType: String): Any = {
    if (v == null) return null
    val str = v.toString
    dataType match {
      case "string"  => str
      case "integer" => Try(str.toInt).orElse(Try(str.toDouble.toInt)).getOrElse(null)
      case "long"    => Try(str.toLong).orElse(Try(str.toDouble.toLong)).getOrElse(null)
      // float / number project analyze's `float` (the numeric family): a 64-bit Double, like `double`
      // and like a JSON number (HEL-1436 D2).
      case "double" | "float" | "number" => Try(str.toDouble).getOrElse(null)
      case "boolean" => Try(str.toBoolean).getOrElse(null)
      // Keep the ORIGINAL string when either platform timestamp reader accepts it, else null
      // (HEL-1436 D3, owner rulings 1 and 3). A non-String input is emitted as its string form.
      case "date" | "timestamp" => if (isTimestampLike(str)) str else null
      // Explicit, owner-ruled passthrough (HEL-1436 D5) for a target stored before the write
      // validator started rejecting it (`string-body`, `binary-ref`, unrecognised). The ORIGINAL
      // value is kept. Unreachable for new writes.
      case _ => v
    }
  }

  /** Accepted by EITHER platform timestamp reader (HEL-1436 D3): source schema inference or `datebucket`. */
  private def isTimestampLike(str: String): Boolean =
    TimestampParsing.looksLikeTimestamp(str) || DateBucketStep.parsesAsDate(str)

  /** WRITE-only (HEL-1436 D4): names every unsupported target of the `casts` map. Never part of
   *  `validateRawConfig`, so analyze and the run gates keep admitting stored legacy targets. */
  private def unsupportedTargetProblem(raw: String): Option[String] =
    Try(CastConfig.decode(raw)).toOption.flatMap { cfg =>
      val bad = cfg.casts.filterNot { case (_, t) => SupportedTargets.contains(t) }.toVector.sortBy(_._1)
      if (bad.isEmpty) None
      else Some(
        "cast: unsupported target type " +
          bad.map { case (f, t) => s"'$t' for field '$f'" }.mkString(", ") +
          s". Supported: ${SupportedTargets.mkString(", ")}"
      )
    }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    override def group: Option[StepGroup]     = Some(StepGroup.ComputeCast)
    override def catalogDescription: String   = "Convert one or more columns to a different data type."
    def decodeConfig(raw: String): Any    = CastConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[CastConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[CastConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[CastConfig].toJson

    // HEL-860: a mistyped `casts` (e.g. a list, or an object with non-string
    // values) must be rejected on write rather than silently decoded to
    // Map.empty (CastConfig.decode's read-path tolerance is unchanged).
    // HEL-814: `asObject` now raises for a non-object top-level config, so
    // the HEL-860 wording is attempted first and the generic strict-decode
    // message is the fallback for the cases it cannot describe.
    override def validateRawConfig(raw: String): Option[String] =
      scala.util.Try(StepCodecUtil.asObject(raw)).toOption
        .flatMap(obj =>
          StepCodecUtil.requireStringMap(
            obj, "casts", Kind,
            shapeDescription = CastsShape,
            example          = "{\"casts\": {\"amount\": \"double\"}}"
          )
        )
        .orElse(strictDecodeProblem(raw))

    override def writeConfigProblem(raw: String): Option[String] = unsupportedTargetProblem(raw)
  }
}
