package com.helio.domain.steps

import com.helio.domain.model.{DataSourceId, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `lookup` step. */
final case class LookupConfig(
    referenceDataSourceId: String,
    sourceKey: String,
    lookupKey: String,
    columns: Vector[String]
)

object LookupConfig {
  implicit val format: RootJsonFormat[LookupConfig] = jsonFormat4(LookupConfig.apply)

  /** Tolerant decoder — missing keys default to empty ids/keys and an empty
   *  `columns` list (design.md Decision 1 — an empty `columns` is a no-op
   *  enrichment, not an error, mirroring `select`'s empty-`fields`
   *  precedent). */
  def decode(raw: String): LookupConfig = {
    val obj       = StepCodecUtil.asObject(raw)
    val refId     = StepCodecUtil.str(obj, "referenceDataSourceId", "")
    val srcKey    = StepCodecUtil.str(obj, "sourceKey", "")
    val lookupKey = StepCodecUtil.str(obj, "lookupKey", "")
    val columns   = StepCodecUtil.stringArray(obj, "columns")
    LookupConfig(refId, srcKey, lookupKey, columns)
  }
}

/** Lookup step — the third async / repo-touching step in the engine (after
 *  `JoinStep`/`UnionStep`), modeled directly on their resolution shape.
 *  Resolves the reference DataSource via `ctx.dataSourceRepo`, loads its
 *  rows via `ctx.loadSource`, then enriches the current rows with a
 *  constrained single-key left-join that brings in only the named
 *  `columns` — unlike `JoinStep`'s full-row `leftRow ++ rightRow`.
 *
 *  Semantics (design.md Decisions 2-5):
 *    - Match: index reference rows by `lookupKey`; for each left row, look
 *      up its `sourceKey` value in that index.
 *    - No match: the left row is preserved unchanged except `columns` are
 *      added with `null` values (true left-join cardinality).
 *    - Multiple matches: only the first matching reference row's `columns`
 *      values are used — no row multiplication (deterministic "first" =
 *      reference-row load order, since `Seq.groupBy` preserves each group's
 *      original element order).
 *    - Column collision: the brought-in reference value overwrites an
 *      existing left-row field of the same name (matching `JoinStep`'s
 *      `leftRow ++ rightRow` right-hand-wins rule). Only the requested
 *      `columns` are brought in — every other reference-row field is
 *      dropped. */
final case class LookupStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: LookupConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = LookupStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = {
    val refDsId    = config.referenceDataSourceId
    val sourceKey  = config.sourceKey
    val lookupKey  = config.lookupKey
    val columns    = config.columns
    // Privileged: the pipeline ACL is the gate, mirroring JoinStep/UnionStep
    // — the creation/update-time findByIdOwned pre-flight in PipelineService
    // is what scopes referenceDataSourceId to the caller (design.md Decision
    // 9); this runtime lookup stays privileged so already-authored steps
    // keep working, per HEL-278's "pre-flight + runtime internal" model.
    ctx.dataSourceRepo.findByIdInternal(DataSourceId(refDsId)).flatMap {
      case None =>
        Future.failed(
          new IllegalArgumentException("DataSource not found for lookup: " + refDsId)
        )
      case Some(refDs) =>
        ctx.loadSource(refDs).map { refRows =>
          val refIndex: Map[Any, Seq[Map[String, Any]]] =
            refRows.groupBy(_.getOrElse(lookupKey, null))
          rows.map { leftRow =>
            val key   = leftRow.getOrElse(sourceKey, null)
            val nulls = columns.map(c => c -> (null: Any)).toMap
            refIndex.get(key) match {
              case Some(matches) if matches.nonEmpty =>
                val firstMatch    = matches.head
                val brought       = columns.map(c => c -> firstMatch.getOrElse(c, null)).toMap
                leftRow ++ brought
              case _ =>
                leftRow ++ nulls
            }
          }
        }
    }
  }
}

object LookupStep {
  val Kind: String = "lookup"

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = LookupConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[LookupConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[LookupConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[LookupConfig].toJson

    /** HEL-814 D3. `sourceKey`/`lookupKey` are required: an empty key indexes
     *  every row on `getOrElse("", null)`, so every row either matches one
     *  arbitrary reference row or is null-filled — corruption presented as a
     *  successful enrichment. `referenceDataSourceId` is NOT re-declared:
     *  `pipeline-lookup-op:63` already requires (and the step already
     *  performs) a run failure for its empty-string default, and `:130`/`:152`
     *  explicitly bless that same empty value on the WRITE path.
     *  `columns` stays optional — an empty `columns` is a specified
     *  pass-through (`:17-19`). */
    override def requiredConfigProblems(raw: String): Vector[String] = {
      val cfg = LookupConfig.decode(raw)
      StepCodecUtil.missingRequired(Kind, "sourceKey" -> cfg.sourceKey, "lookupKey" -> cfg.lookupKey)
    }
  }
}
