package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `unpivot` step (HEL-380) — the inverse of `pivot`.
 *  `idVars` names the source columns carried unchanged onto every emitted
 *  row; `valueVars` names the source columns to collapse into long form;
 *  `varName` names the output column holding each collapsed column's name
 *  (default `"variable"`); `valueName` names the output column holding that
 *  column's cell value (default `"value"`). */
final case class UnpivotConfig(
    idVars: Vector[String],
    valueVars: Vector[String],
    varName: String,
    valueName: String
)

object UnpivotConfig {
  implicit val format: RootJsonFormat[UnpivotConfig] = jsonFormat4(UnpivotConfig.apply)

  def decode(raw: String): UnpivotConfig = {
    val obj = StepCodecUtil.asObject(raw)
    val idVars = obj.fields.get("idVars") match {
      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
      case _                    => Vector.empty[String]
    }
    val valueVars = obj.fields.get("valueVars") match {
      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
      case _                    => Vector.empty[String]
    }
    val varName   = StepCodecUtil.stringOr(obj, "varName", "variable")
    val valueName = StepCodecUtil.stringOr(obj, "valueName", "value")
    UnpivotConfig(idVars, valueVars, varName, valueName)
  }
}

/** Unpivot step — reshapes wide rows into long rows: for each input row,
 *  emits one output row per `valueVars` entry, carrying `idVars` unchanged
 *  and adding `varName` (the source column's name) and `valueName` (that
 *  column's raw cell value) (design.md decisions 3-5).
 *
 *  Row emission is unconditional: a missing `idVars`/`valueVars` field on a
 *  given row yields `null` for that field rather than dropping the row —
 *  the output row count is always exactly `(input rows) * (valueVars
 *  length)`, keeping the schema statically knowable (design.md decision 4).
 *  Note: an empty `valueVars` list makes that product zero, so every input
 *  row emits zero output rows in that case (no special-casing needed — the
 *  inner loop simply has nothing to iterate).
 *
 *  Collision resolution: `idVars` values first, then `varName`, then
 *  `valueName` — later assignment wins, via `Map` `++` (design.md decision
 *  5, same "derived data wins" convention as `PivotStep`/`AggregateStep`). */
final case class UnpivotStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: UnpivotConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = UnpivotStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(UnpivotStep.apply(rows, config))
}

object UnpivotStep {
  val Kind: String = "unpivot"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: UnpivotConfig): Seq[PipelineRowJson.Row] = {
    val idVars    = cfg.idVars
    val valueVars = cfg.valueVars

    rows.flatMap { row =>
      val idMap: PipelineRowJson.Row = idVars.map(name => name -> row.getOrElse(name, null)).toMap
      valueVars.map { valueVar =>
        idMap ++ Map(cfg.varName -> valueVar, cfg.valueName -> row.getOrElse(valueVar, null))
      }
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = UnpivotConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[UnpivotConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[UnpivotConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[UnpivotConfig].toJson
  }
}
