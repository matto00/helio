package com.helio.domain.steps

import com.helio.domain.model.{DataSourceId, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `union` step. */
final case class UnionConfig(otherDataSourceId: String, mode: String)

object UnionConfig {
  implicit val format: RootJsonFormat[UnionConfig] = jsonFormat2(UnionConfig.apply)

  /** Tolerant decoder — missing keys default to an empty id + byPosition
   *  (design.md Decision 1 — the simpler, no-reconciliation mode, matching
   *  `JoinConfig.decode`'s "default to the least-surprising behavior"
   *  pattern). */
  def decode(raw: String): UnionConfig = {
    val obj  = StepCodecUtil.asObject(raw)
    val dsId = StepCodecUtil.stringOr(obj, "otherDataSourceId", "")
    val mode = StepCodecUtil.stringOr(obj, "mode", "byPosition")
    UnionConfig(dsId, mode)
  }
}

/** Union step — the second async / repo-touching step in the engine (after
 *  `JoinStep`), modeled directly on its resolution shape. Resolves the other
 *  DataSource via `ctx.dataSourceRepo`, loads its rows via `ctx.loadSource`,
 *  then stacks (appends) them onto the current row set instead of joining on
 *  a key. Supports two modes:
 *
 *    - `byPosition` (design.md Decision 2): raw append, no column
 *      reconciliation. Trusts the caller's config over validating
 *      cross-source shape, mirroring `JoinStep`'s `leftRow ++ rightRow`.
 *    - `byName` (design.md Decision 3): union of the two sides' column sets
 *      (derived from each side's first row), missing keys backfilled with
 *      `null` per row.
 *
 *  Neither mode attempts cross-source type reconciliation (design.md
 *  Decision 4) — row values are `Map[String, Any]` throughout and no other
 *  op validates cross-row type consistency. */
final case class UnionStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: UnionConfig,
    createdAt: Instant,
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = UnionStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = {
    val otherDsId = config.otherDataSourceId
    val mode      = config.mode
    // Privileged: the pipeline ACL is the gate, mirroring JoinStep — the
    // creation/update-time findByIdOwned pre-flight in PipelineService is
    // what scopes otherDataSourceId to the caller (design.md Decision 9);
    // this runtime lookup stays privileged so already-authored steps keep
    // working, per HEL-278's "pre-flight + runtime internal" model.
    ctx.dataSourceRepo.findByIdInternal(DataSourceId(otherDsId)).flatMap {
      case None =>
        Future.failed(
          new IllegalArgumentException("DataSource not found for union: " + otherDsId)
        )
      case Some(otherDs) =>
        ctx.loadSource(otherDs).map { otherRows =>
          mode match {
            case "byPosition" =>
              rows ++ otherRows
            case "byName" =>
              unionByName(rows, otherRows)
            case other =>
              throw new IllegalArgumentException(
                "Unsupported union mode: " + other + ". Supported: byPosition, byName"
              )
          }
        }
    }
  }

  /** design.md Decision 3 — compute the column set as the union of keys
   *  present in the current rows' first row and the other source's first row
   *  (or, if either side is empty, the non-empty side's key set; if both are
   *  empty, the empty set). Backfill is per-source, per-key: every row from
   *  a given side is padded with `null` for keys present in the union but
   *  absent from that side's key set — not a per-row introspection, matching
   *  how the engine treats row shape elsewhere. */
  private def unionByName(
      rows: Seq[Map[String, Any]],
      otherRows: Seq[Map[String, Any]]
  ): Seq[Map[String, Any]] = {
    val currentKeys = rows.headOption.map(_.keySet).getOrElse(Set.empty[String])
    val otherKeys   = otherRows.headOption.map(_.keySet).getOrElse(Set.empty[String])
    val unionKeys   = currentKeys ++ otherKeys

    val missingFromCurrent = unionKeys -- currentKeys
    val missingFromOther   = unionKeys -- otherKeys

    val backfilledCurrent = rows.map(row => row ++ missingFromCurrent.map(_ -> null))
    val backfilledOther   = otherRows.map(row => row ++ missingFromOther.map(_ -> null))

    backfilledCurrent ++ backfilledOther
  }
}

object UnionStep {
  val Kind: String = "union"

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = UnionConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[UnionConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[UnionConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[UnionConfig].toJson
  }
}
