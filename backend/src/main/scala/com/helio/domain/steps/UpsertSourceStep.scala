package com.helio.domain.steps

import com.helio.domain.model.{PendingWrite, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1100: the real, registered `upsertsource` step -- writes its input rows to a `dataset`
 *  source, in `append` or `replace` mode, by deferring the actual write to
 *  `ctx.writeBackSink` (design.md Decision 2) rather than writing inside `evaluate`. `evaluate`
 *  returns the input rows UNCHANGED (this step never transforms its rows, and a downstream
 *  sibling/child continues to see the same rows this step saw, per design.md D8's "downstream
 *  children of an `upsertsource` step are allowed and see its input rows"). */
final case class UpsertSourceStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: UpsertSourceConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = UpsertSourceStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = {
    ctx.writeBackSink.record(PendingWrite(id.value, config, rows))
    Future.successful(rows)
  }
}

object UpsertSourceStep {
  val Kind: String = "upsertsource"

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = UpsertSourceConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[UpsertSourceConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[UpsertSourceConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[UpsertSourceConfig].toJson

    /** HEL-1099's own strict write-path check (malformed shape / unrecognised `target.kind` /
     *  `mode`) -- reused verbatim rather than duplicated (this file's whole reason to exist is
     *  to wire that pre-built config model into a real, registered step). */
    override def validateRawConfig(raw: String): Option[String] = UpsertSourceConfig.validateRawConfig(raw)

    /** design.md Decision 1: an unset target -- `ExistingSource("")` (the tolerant read-path
     *  default for an absent `target`) or a blank `NewSource` name -- is "legitimate to save"
     *  (an added-but-not-yet-configured step round-trips through the editor) but not "legitimate
     *  to run" (mirrors every other step's `requiredConfigProblems` contract, HEL-814 D3). */
    override def requiredConfigProblems(raw: String): Vector[String] =
      scala.util.Try(UpsertSourceConfig.decode(raw)).toOption match {
        case Some(UpsertSourceConfig(UpsertTarget.ExistingSource(id), _)) if id.trim.isEmpty =>
          Vector("'upsertsource' step requires a 'target' (an existing data source or a new source name)")
        case Some(UpsertSourceConfig(UpsertTarget.NewSource(name), _)) if name.trim.isEmpty =>
          Vector("'upsertsource' step requires a non-empty 'target.name' for a new source")
        case _ => Vector.empty
      }
  }
}
