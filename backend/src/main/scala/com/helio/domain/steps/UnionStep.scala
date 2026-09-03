package com.helio.domain.steps

import com.helio.domain.model.{DataSourceId, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `union` step.
 *
 *  HEL-911 (design.md Decisions 1/1a): `otherDataSourceId: String` is replaced by the
 *  discriminated [[SecondaryInput]] -- `Source(dataSourceId)` (today's behaviour) or
 *  `Lane(stepId)` (rejoin a sibling lane). There is no legacy read path -- V97 rewrites
 *  every persisted row before this decoder is ever asked to read one. */
final case class UnionConfig(secondaryInput: SecondaryInput, mode: String)

object UnionConfig {
  implicit val format: RootJsonFormat[UnionConfig] = jsonFormat2(UnionConfig.apply)

  /** HEL-911: `secondaryInput` absent -> [[SecondaryInput.Default]] (Decision 1b); the
   *  legacy flat `otherDataSourceId` PRESENT is a hard named error (Decision 1a), never
   *  silently coerced. `mode` keeps its pre-existing tolerant default. */
  def decode(raw: String): UnionConfig = {
    val obj  = StepCodecUtil.asObject(raw)
    val si   = SecondaryInput.decodeStrict(obj, "otherDataSourceId")
    val mode = StepCodecUtil.str(obj, "mode", "byPosition")
    UnionConfig(si, mode)
  }
}

/** Union step — the second async / repo-touching step in the engine (after
 *  `JoinStep`), modeled directly on its resolution shape. Resolves the second input's
 *  rows -- either a `DataSource` (via `ctx.dataSourceRepo`/`ctx.loadSource`, `kind:
 *  "source"`) or another lane's already-evaluated frame (via `ctx.resolveLane`, `kind:
 *  "lane"`, HEL-911 design.md Engine contract item 8, no re-evaluation) -- then stacks
 *  (appends) them onto the current row set instead of joining on a key. Supports two
 *  modes:
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
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = UnionStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = {
    val mode = config.mode
    def apply(otherRows: Seq[Map[String, Any]]): Seq[Map[String, Any]] = {
      if (!UnionStep.SupportedModes.contains(mode))
        throw new IllegalArgumentException(
          "Unsupported union mode: " + mode + ". Supported: " + UnionStep.SupportedModes.mkString(", ")
        )
      mode match {
        case "byPosition" => rows ++ otherRows
        case "byName"     => unionByName(rows, otherRows)
      }
    }

    config.secondaryInput match {
      case SecondaryInput.Lane(stepId) =>
        // HEL-911 design.md Engine contract item 8: the referenced lane's frame is
        // already retained in nodeOutcomes by the time this step evaluates -- resolved,
        // never re-evaluated. Item 6a: membership/existence is validated at write time
        // and defensively at run time by the engine BEFORE this step is reached.
        ctx.resolveLane(stepId) match {
          case Some(otherRows) => Future.successful(apply(otherRows))
          case None =>
            Future.failed(new IllegalArgumentException("Lane reference not found for union: " + stepId))
        }
      case SecondaryInput.Source(otherDsId) =>
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
            ctx.loadSource(otherDs).map(apply)
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

  // HEL-859 (design.md Decisions 5/3.4a): single source of truth driving both
  // the runtime `match` above and the analyze-time validator.
  val SupportedModes: Vector[String] = Vector("byPosition", "byName")

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = UnionConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[UnionConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[UnionConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[UnionConfig].toJson
  }
}
