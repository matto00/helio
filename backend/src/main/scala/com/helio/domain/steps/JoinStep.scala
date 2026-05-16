package com.helio.domain.steps

import com.helio.domain.{
  DataSourceId,
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

/** Typed config for the `join` step. */
final case class JoinConfig(rightDataSourceId: String, joinKey: String, joinType: String)

object JoinConfig {
  implicit val format: RootJsonFormat[JoinConfig] = jsonFormat3(JoinConfig.apply)

  /** Tolerant decoder — missing keys default to empty ids + inner. */
  def decode(raw: String): JoinConfig = {
    val obj  = StepCodecUtil.asObject(raw)
    val rId  = StepCodecUtil.stringOr(obj, "rightDataSourceId", "")
    val key  = StepCodecUtil.stringOr(obj, "joinKey", "")
    val jt   = StepCodecUtil.stringOr(obj, "joinType", "inner")
    JoinConfig(rId, key, jt)
  }
}

/** Join step — the one async / repo-touching step in the engine. Resolves
 *  the right-side DataSource via `ctx.dataSourceRepo`, loads its rows via
 *  `ctx.loadSource`, then joins with the left-side rows on `joinKey`.
 *  Supports `inner` and `left` join types; any other value raises at execute
 *  time. */
final case class JoinStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: JoinConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = JoinStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = {
    val rightDsId = config.rightDataSourceId
    val joinKey   = config.joinKey
    val joinType  = config.joinType
    ctx.dataSourceRepo.findById(DataSourceId(rightDsId)).flatMap {
      case None =>
        Future.failed(
          new IllegalArgumentException("DataSource not found for join: " + rightDsId)
        )
      case Some(rightDs) =>
        ctx.loadSource(rightDs).map { rightRows =>
          val rightIndex: Map[Any, Seq[PipelineRowJson.Row]] =
            rightRows.groupBy(_.getOrElse(joinKey, null))
          joinType.toLowerCase match {
            case "inner" =>
              rows.flatMap { leftRow =>
                val key     = leftRow.getOrElse(joinKey, null)
                val matches = rightIndex.getOrElse(key, Seq.empty)
                matches.map(rightRow => leftRow ++ rightRow)
              }
            case "left" =>
              rows.flatMap { leftRow =>
                val key     = leftRow.getOrElse(joinKey, null)
                val matches = rightIndex.getOrElse(key, Seq.empty)
                if (matches.isEmpty) Seq(leftRow)
                else matches.map(rightRow => leftRow ++ rightRow)
              }
            case other =>
              throw new IllegalArgumentException(
                "Unsupported join type: " + other + ". Supported: inner, left"
              )
          }
        }
    }
  }
}

object JoinStep {
  val Kind: String = "join"

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = JoinConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[JoinConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[JoinConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[JoinConfig].toJson
  }
}
