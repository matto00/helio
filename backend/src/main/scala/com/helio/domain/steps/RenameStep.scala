package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
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
    val obj     = StepCodecUtil.asObject(raw)
    val renames = StepCodecUtil.stringMap(obj, "renames", RenameStep.RenamesShape)
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
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = RenameStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(RenameStep.apply(rows, config))
}

object RenameStep {
  val Kind: String = "rename"

  /** HEL-860's per-key shape wording for `renames`. Deliberately NOT shared
   *  with `cast`'s: both are `Map[String, String]` at the type level but mean
   *  entirely different things, and one shared string is actively wrong for
   *  one of them. */
  val RenamesShape: String = "from-field-name to to-field-name"

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

    // HEL-860: a mistyped `renames` (e.g. a list, or an object with
    // non-string values) must be rejected on write rather than silently
    // decoded to Map.empty (RenameConfig.decode's read-path tolerance is
    // unchanged).
    // HEL-814: see CastStep's companion for why this is guarded.
    override def validateRawConfig(raw: String): Option[String] =
      scala.util.Try(StepCodecUtil.asObject(raw)).toOption
        .flatMap(obj =>
          StepCodecUtil.requireStringMap(
            obj, "renames", Kind,
            shapeDescription = RenamesShape,
            example          = "{\"renames\": {\"amount\": \"total_amount\"}}"
          )
        )
        .orElse(strictDecodeProblem(raw))
  }
}
