package com.helio.domain.steps

import com.helio.domain.engine.{ExpressionEvaluator, PipelineRowJson}
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
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
    val column     = StepCodecUtil.str(obj, "column", "")
    val expression = StepCodecUtil.str(obj, "expression", "")
    val typ        = StepCodecUtil.strOpt(obj, "type")
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
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = ComputeStep.Kind

  def configValue: Any = config

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

    /** HEL-814 D3. An empty `column` makes the shipped requirement
     *  ("SHALL append a new field named `column` to every row") write a field
     *  named `""` into the output DataType — HEL-888's bug, and the case the
     *  production measurement found. Saving it stays legal (D2); running or
     *  analyzing it does not. See this change's `pipeline-compute-op` delta. */
    override def requiredConfigProblems(raw: String): Vector[String] = {
      val cfg = ComputeConfig.decode(raw)
      StepCodecUtil.missingRequired(Kind, "column" -> cfg.column, "expression" -> cfg.expression)
    }
  }
}
