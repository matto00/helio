package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `rename` step. */
final case class RenameConfig(renames: Map[String, String])

object RenameConfig {
  implicit val format: RootJsonFormat[RenameConfig] = jsonFormat1(RenameConfig.apply)

  /** Tolerant decoder used at the persistence boundary — a partial config
   *  (e.g. `{}` from a legacy row) decodes to `RenameConfig(Map.empty)`. */
  def decode(raw: String): RenameConfig = {
    val obj = StepCodecUtil.asObject(raw)
    val renames = obj.fields.get("renames") match {
      case Some(o: JsObject) => Try(o.convertTo[Map[String, String]]).getOrElse(Map.empty)
      case _                 => Map.empty[String, String]
    }
    RenameConfig(renames)
  }
}

/** Rename step — applies a `from → to` map to every row, leaving the value
 *  intact and dropping the original key. Missing source fields are silently
 *  ignored (parity with the pre-CS2c-3a engine). */
final case class RenameStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: RenameConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = RenameStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(RenameStep.apply(rows, config))
}

object RenameStep {
  val Kind: String = "rename"

  /** Pure transformation logic — extracted so non-engine callers (tests,
   *  spark submitter) can exercise it without spinning up an
   *  [[PipelineExecutionContext]]. */
  def apply(rows: Seq[PipelineRowJson.Row], cfg: RenameConfig): Seq[PipelineRowJson.Row] = {
    val renames = cfg.renames
    rows.map { row =>
      renames.foldLeft(row) { case (r, (from, to)) =>
        if (r.contains(from)) (r - from) + (to -> r(from)) else r
      }
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                          = Kind
    def decodeConfig(raw: String): Any        = RenameConfig.decode(raw)
    def encodeConfig(config: Any): String     = config.asInstanceOf[RenameConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any      = json.convertTo[RenameConfig]
    def writeToWire(config: Any): JsValue     = config.asInstanceOf[RenameConfig].toJson
  }
}
