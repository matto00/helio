package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `limit` step. */
final case class LimitConfig(count: Int)

object LimitConfig {
  implicit val format: RootJsonFormat[LimitConfig] = jsonFormat1(LimitConfig.apply)

  def decode(raw: String): LimitConfig = {
    val obj   = StepCodecUtil.asObject(raw)
    val count = obj.fields.get("count") match {
      case Some(JsNumber(n)) => Try(n.toIntExact).getOrElse(0)
      case _                 => 0
    }
    LimitConfig(count)
  }
}

/** Limit step — keeps the first `count` rows. `count <= 0` is a no-op
 *  (returns the input rows unchanged); this matches the pre-CS2c-3a engine
 *  behaviour for legacy rows persisted with the default `count = 0`. */
final case class LimitStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: LimitConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = LimitStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(LimitStep.apply(rows, config))
}

object LimitStep {
  val Kind: String = "limit"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: LimitConfig): Seq[PipelineRowJson.Row] = {
    val count = cfg.count
    if (count <= 0) rows else rows.take(count)
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = LimitConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[LimitConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[LimitConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[LimitConfig].toJson
  }
}
