package com.helio.domain.steps

import com.helio.domain.model.{DataSourceId, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `lookup` step.
 *
 *  HEL-911 (design.md Decisions 1/1a): `referenceDataSourceId: String` is replaced by
 *  the discriminated [[SecondaryInput]] -- `Source(dataSourceId)` (today's behaviour,
 *  including HEL-950's empty-id incomplete-draft legality) or `Lane(stepId)` (rejoin a
 *  sibling lane). No legacy read path. */
final case class LookupConfig(
    secondaryInput: SecondaryInput,
    sourceKey: String,
    lookupKey: String,
    columns: Vector[String]
)

object LookupConfig {
  implicit val format: RootJsonFormat[LookupConfig] = jsonFormat4(LookupConfig.apply)

  /** Tolerant decoder — missing keys default to `SecondaryInput.Default`/empty
   *  keys/an empty `columns` list (design.md Decision 1 — an empty `columns` is a
   *  no-op enrichment, not an error, mirroring `select`'s empty-`fields` precedent).
   *  Legacy flat `referenceDataSourceId` PRESENT is a hard named error (Decision 1a). */
  def decode(raw: String): LookupConfig = {
    val obj       = StepCodecUtil.asObject(raw)
    val si        = SecondaryInput.decodeStrict(obj, "referenceDataSourceId")
    val srcKey    = StepCodecUtil.str(obj, "sourceKey", "")
    val lookupKey = StepCodecUtil.str(obj, "lookupKey", "")
    val columns   = StepCodecUtil.stringArray(obj, "columns")
    LookupConfig(si, srcKey, lookupKey, columns)
  }
}

/** Lookup step — the third async / repo-touching step in the engine (after
 *  `JoinStep`/`UnionStep`), modeled directly on their resolution shape. Resolves the
 *  second input's rows -- either a `DataSource` (`kind: "source"`) or another lane's
 *  already-evaluated frame (`kind: "lane"`, HEL-911, via `ctx.resolveLane`, no
 *  re-evaluation) -- then enriches the current rows with a constrained single-key
 *  left-join that brings in only the named `columns` — unlike `JoinStep`'s full-row
 *  `leftRow ++ rightRow`.
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
    val sourceKey = config.sourceKey
    val lookupKey = config.lookupKey
    val columns   = config.columns

    def apply(refRows: Seq[Map[String, Any]]): Seq[Map[String, Any]] = {
      val refIndex: Map[Any, Seq[Map[String, Any]]] =
        refRows.groupBy(_.getOrElse(lookupKey, null))
      rows.map { leftRow =>
        val key   = leftRow.getOrElse(sourceKey, null)
        val nulls = columns.map(c => c -> (null: Any)).toMap
        refIndex.get(key) match {
          case Some(matches) if matches.nonEmpty =>
            val firstMatch = matches.head
            val brought    = columns.map(c => c -> firstMatch.getOrElse(c, null)).toMap
            leftRow ++ brought
          case _ =>
            leftRow ++ nulls
        }
      }
    }

    config.secondaryInput match {
      case SecondaryInput.Lane(stepId) =>
        ctx.resolveLane(stepId) match {
          case Some(refRows) => Future.successful(apply(refRows))
          case None =>
            Future.failed(new IllegalArgumentException("Lane reference not found for lookup: " + stepId))
        }
      case SecondaryInput.Source(refDsId) =>
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
            ctx.loadSource(refDs).map(apply)
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
     *  successful enrichment. `secondaryInput` is NOT re-declared: an unresolved
     *  second input (empty source id or a bad lane reference) already fails the
     *  run explicitly (`LookupStep.evaluate`), and `pipeline-lookup-op`
     *  explicitly blesses an empty `Source("")` on the WRITE path (HEL-950).
     *  `columns` stays optional — an empty `columns` is a specified
     *  pass-through (`:17-19`). */
    override def requiredConfigProblems(raw: String): Vector[String] = {
      val cfg = LookupConfig.decode(raw)
      StepCodecUtil.missingRequired(Kind, "sourceKey" -> cfg.sourceKey, "lookupKey" -> cfg.lookupKey)
    }
  }
}
