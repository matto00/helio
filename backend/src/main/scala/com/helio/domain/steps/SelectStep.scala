package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `select` step. Fields not in `fields` are dropped. */
final case class SelectConfig(fields: Vector[String])

object SelectConfig {
  implicit val format: RootJsonFormat[SelectConfig] = jsonFormat1(SelectConfig.apply)

  def decode(raw: String): SelectConfig = {
    val obj    = StepCodecUtil.asObject(raw)
    val fields = StepCodecUtil.stringArray(obj, "fields")
    SelectConfig(fields)
  }
}

/** Select step — narrows rows to the listed fields. Missing fields are
 *  silently omitted (the row's key set is the intersection of `fields` and
 *  the row's existing keys). */
final case class SelectStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: SelectConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = SelectStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(SelectStep.apply(rows, config))
}

object SelectStep {
  val Kind: String = "select"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: SelectConfig): Seq[PipelineRowJson.Row] = {
    val fieldSet = cfg.fields.toSet
    rows.map(row => row.view.filterKeys(fieldSet.contains).toMap)
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = SelectConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[SelectConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[SelectConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[SelectConfig].toJson
  }
}
