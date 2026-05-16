package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `cast` step. The map's keys are field names; the
 *  values are target type names (`string` / `integer` / `long` / `double`
 *  / `boolean` / `date`). Fields not in the map pass through unchanged. */
final case class CastConfig(casts: Map[String, String])

object CastConfig {
  implicit val format: RootJsonFormat[CastConfig] = jsonFormat1(CastConfig.apply)

  def decode(raw: String): CastConfig = {
    val obj   = StepCodecUtil.asObject(raw)
    val casts = obj.fields.get("casts") match {
      case Some(o: JsObject) => Try(o.convertTo[Map[String, String]]).getOrElse(Map.empty)
      case _                 => Map.empty[String, String]
    }
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
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = CastStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(CastStep.apply(rows, config))
}

object CastStep {
  val Kind: String = "cast"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: CastConfig): Seq[PipelineRowJson.Row] = {
    val casts = cfg.casts
    rows.map { row =>
      casts.foldLeft(row) { case (r, (field, targetType)) =>
        val rawValue = r.getOrElse(field, null)
        r + (field -> castValue(rawValue, targetType))
      }
    }
  }

  private def castValue(v: Any, dataType: String): Any = {
    if (v == null) return null
    val str = v.toString
    dataType match {
      case "string"  => str
      case "integer" => Try(str.toInt).orElse(Try(str.toDouble.toInt)).getOrElse(null)
      case "long"    => Try(str.toLong).orElse(Try(str.toDouble.toLong)).getOrElse(null)
      case "double"  => Try(str.toDouble).getOrElse(null)
      case "boolean" => Try(str.toBoolean).getOrElse(null)
      case "date"    => str
      case _         => str
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = CastConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[CastConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[CastConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[CastConfig].toJson
  }
}
