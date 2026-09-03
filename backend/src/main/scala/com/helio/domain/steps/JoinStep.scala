package com.helio.domain.steps

import com.helio.domain.model.{DataSourceId, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `join` step.
 *
 *  HEL-911 (design.md Decisions 1/1a): `rightDataSourceId: String` is replaced by the
 *  discriminated [[SecondaryInput]] -- `Source(dataSourceId)` (today's behaviour) or
 *  `Lane(stepId)` (rejoin a sibling lane). No legacy read path. */
final case class JoinConfig(secondaryInput: SecondaryInput, joinKey: String, joinType: String)

object JoinConfig {
  implicit val format: RootJsonFormat[JoinConfig] = jsonFormat3(JoinConfig.apply)

  /** Tolerant decoder — missing keys default to `SecondaryInput.Default` + inner. Legacy
   *  flat `rightDataSourceId` PRESENT is a hard named error (Decision 1a). */
  def decode(raw: String): JoinConfig = {
    val obj = StepCodecUtil.asObject(raw)
    val si  = SecondaryInput.decodeStrict(obj, "rightDataSourceId")
    val key = StepCodecUtil.str(obj, "joinKey", "")
    val jt  = StepCodecUtil.str(obj, "joinType", "inner")
    JoinConfig(si, key, jt)
  }
}

/** Join step — the one async / repo-touching step in the engine. Resolves the second
 *  input's rows -- either a `DataSource` (`kind: "source"`) or another lane's
 *  already-evaluated frame (`kind: "lane"`, HEL-911, via `ctx.resolveLane`, no
 *  re-evaluation) -- then joins with the left-side rows on `joinKey`. Supports `inner`
 *  and `left` join types; any other value raises at execute time. */
final case class JoinStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: JoinConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = JoinStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = {
    val joinKey  = config.joinKey
    val joinType = config.joinType

    def apply(rightRows: Seq[Map[String, Any]]): Seq[Map[String, Any]] = {
      val rightIndex: Map[Any, Seq[PipelineRowJson.Row]] =
        rightRows.groupBy(_.getOrElse(joinKey, null))
      val normalizedType = joinType.toLowerCase
      if (!JoinStep.SupportedJoinTypes.contains(normalizedType))
        throw new IllegalArgumentException(
          "Unsupported join type: " + normalizedType + ". Supported: " + JoinStep.SupportedJoinTypes.mkString(", ")
        )
      normalizedType match {
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
      }
    }

    config.secondaryInput match {
      case SecondaryInput.Lane(stepId) =>
        ctx.resolveLane(stepId) match {
          case Some(rightRows) => Future.successful(apply(rightRows))
          case None =>
            Future.failed(new IllegalArgumentException("Lane reference not found for join: " + stepId))
        }
      case SecondaryInput.Source(rightDsId) =>
        // Privileged: the pipeline ACL is the gate; JoinStep resolves the right-side
        // source (which may belong to a different user per design.md Q1 spinoff).
        ctx.dataSourceRepo.findByIdInternal(DataSourceId(rightDsId)).flatMap {
          case None =>
            Future.failed(
              new IllegalArgumentException("DataSource not found for join: " + rightDsId)
            )
          case Some(rightDs) =>
            ctx.loadSource(rightDs).map(apply)
        }
    }
  }
}

object JoinStep {
  val Kind: String = "join"

  // HEL-859 (design.md Decisions 5/3.4a): single source of truth driving both
  // the runtime `match` above and the analyze-time validator.
  val SupportedJoinTypes: Vector[String] = Vector("inner", "left")

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = JoinConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[JoinConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[JoinConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[JoinConfig].toJson

    /** HEL-814 D3. An empty `joinKey` makes both sides index on
     *  `getOrElse("", null)`, so every row keys to `null`: an inner join
     *  becomes a cross-product-by-null and a left join silently mis-matches.
     *  `secondaryInput` is NOT re-declared — `JoinStep.evaluate` already
     *  fails the run with "DataSource not found for join: " / "Lane
     *  reference not found for join: " for an unresolved second input. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      StepCodecUtil.missingRequired(Kind, "joinKey" -> JoinConfig.decode(raw).joinKey)
  }
}
