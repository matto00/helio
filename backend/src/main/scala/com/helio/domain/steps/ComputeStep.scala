package com.helio.domain.steps

import com.helio.domain.{
  ExpressionEvaluator,
  PipelineExecutionContext,
  PipelineId,
  PipelineRowJson,
  PipelineStep,
  PipelineStepId
}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `compute` step. `type` is an optional output-type
 *  hint historically emitted by the frontend editor; the engine ignores it
 *  but preserving it on the wire keeps the editor round-trip clean. */
final case class ComputeConfig(column: String, expression: String, `type`: Option[String])

object ComputeConfig {
  implicit val format: RootJsonFormat[ComputeConfig] = jsonFormat3(ComputeConfig.apply)

  def decode(raw: String): ComputeConfig = {
    val obj        = StepCodecUtil.asObject(raw)
    val column     = StepCodecUtil.stringOr(obj, "column", "")
    val expression = StepCodecUtil.stringOr(obj, "expression", "")
    val typ        = obj.fields.get("type") match {
      case Some(JsString(s)) => Some(s)
      case _                 => None
    }
    ComputeConfig(column, expression, typ)
  }
}

/** Compute step — adds a new column whose value is the per-row evaluation of
 *  `expression`. Evaluation failures (unknown field, divide-by-zero) yield
 *  `null` for that row. */
final case class ComputeStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: ComputeConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = ComputeStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(ComputeStep.apply(rows, config))
}

object ComputeStep {
  val Kind: String = "compute"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: ComputeConfig): Seq[PipelineRowJson.Row] = {
    val column = cfg.column
    val expr   = cfg.expression
    rows.map { row =>
      val jsRow = PipelineRowJson.rowToJsMap(row)
      val value = ExpressionEvaluator.evaluate(expr, jsRow) match {
        case Right(v) => PipelineRowJson.jsValueToAny(v)
        case Left(_)  => null
      }
      row + (column -> value)
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = ComputeConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[ComputeConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[ComputeConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[ComputeConfig].toJson
  }
}
