package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Single sort key. `direction` is `asc` (default) or `desc`. */
final case class SortKey(field: String, direction: String)

object SortKey {
  implicit val format: RootJsonFormat[SortKey] = jsonFormat2(SortKey.apply)
}

/** Typed config for the `sort` step. Multiple keys give a stable
 *  primary/secondary sort. */
final case class SortConfig(sortBy: Vector[SortKey])

object SortConfig {
  implicit val format: RootJsonFormat[SortConfig] = jsonFormat1(SortConfig.apply)

  def decode(raw: String): SortConfig = {
    val obj    = StepCodecUtil.asObject(raw)
    val sortBy = StepCodecUtil.typedArray[SortKey](obj, "sortBy", "an array of {field, direction} objects")
    SortConfig(sortBy)
  }
}

/** Sort step — multi-key stable sort. Nulls sort last in both directions
 *  (parity with the pre-CS2c-3a engine).
 *
 *  HEL-981: the comparator is a **three-tier strict weak ordering**, decided
 *  per value (not per pair, and not per column):
 *
 *    1. Values that convert to a *finite* `Double` (via [[PipelineRowJson.toDouble]],
 *       including numeric-looking strings such as `"9"`) — compared numerically.
 *    2. Every other non-null value, including strings that convert to `NaN` or an
 *       infinity (`"NaN"`, `"Infinity"`) — compared lexicographically via `toString`.
 *       NaN/Infinity are excluded from tier 1 on data-semantics grounds: a cell that only
 *       *looks* numeric but coerces to `NaN`/`Infinity` is junk data, not a value the user
 *       meant to rank above every genuine number, so it belongs alongside `"n/a"` in the
 *       non-coercible tier. (Tier 1's own within-tier comparison is `Double.compareTo`, a
 *       genuine total order that places `NaN` last — the exclusion is not needed for
 *       transitivity, which would hold either way.)
 *    3. Nulls, always last, in both directions.
 *
 *  `desc` reverses both the within-tier ordering and the relative order of tiers 1
 *  and 2; nulls stay last regardless of direction (design.md D3).
 *
 *  This is a strict weak ordering, not a strict total order: `9` and `"9"` are
 *  distinct values that both land in tier 1 with equal magnitude, so they compare
 *  equivalent rather than strictly ordered. Tests must not assert trichotomy.
 *
 *  Two alternatives were considered and rejected (design.md D1) — noted here so a
 *  future simplification does not reintroduce the original defect:
 *    - **all-or-nothing per column**: pre-scan the column and use numeric ordering
 *      only if every non-null value coerces, else lexicographic throughout. Rejected
 *      because it degrades with a cliff — a single non-coercible cell in an otherwise
 *      numeric column flips the *entire* column to lexicographic order.
 *    - **numeric-tier-last**: same tiering, but non-coercible values lead in `asc`.
 *      Rejected because burying the numeric values a user is actually sorting on
 *      behind an arbitrary number of junk rows is the less useful default.
 *
 *  Deciding the tier per value (rather than per column) also commits the codebase to
 *  a **numbers-before-strings cross-type ordering rule** that is not stated anywhere
 *  else today (design.md D4); a future cross-type comparison should follow it or say
 *  explicitly why it differs. */
final case class SortStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: SortConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = SortStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(SortStep.apply(rows, config))
}

object SortStep {
  val Kind: String = "sort"

  /** Finite-numeric tier classifier (design.md D1/D2, tasks.md 1.1). `NaN` and both
   *  infinities are deliberately excluded from tier 1 on data-semantics grounds -- a value
   *  that only *looks* numeric but coerces to `NaN`/`Infinity` is junk data, not something
   *  the user meant to sort as a real number -- so it falls through to tier 2 (lexicographic)
   *  alongside every other non-coercible value. (Not needed for transitivity: tier 1's
   *  `compareNonNullAsc` arm uses `Double.compareTo`, a total order that already places
   *  `NaN` last, so transitivity would hold even without this filter.) */
  private def finiteNumeric(v: Any): Option[Double] =
    PipelineRowJson.toDouble(v).filter(_.isFinite)

  /** Tier-then-within-tier comparison for two non-null values, `asc` orientation
   *  (tier 1 < tier 2; within a tier, numeric or lexicographic order). Returns a
   *  negative/zero/positive `Int` per the usual `compare` convention. Callers apply
   *  `desc` by negating the result (design.md D3: `desc` reverses tiers as well as
   *  within-tier order). */
  private def compareNonNullAsc(x: Any, y: Any): Int = {
    val xn = finiteNumeric(x)
    val yn = finiteNumeric(y)
    (xn, yn) match {
      case (Some(xd), Some(yd)) => xd.compareTo(yd)
      case (Some(_), None)      => -1 // tier 1 before tier 2
      case (None, Some(_))      => 1
      case (None, None)         => x.toString.compareTo(y.toString)
    }
  }

  def apply(rows: Seq[PipelineRowJson.Row], cfg: SortConfig): Seq[PipelineRowJson.Row] = {
    val sortBy = cfg.sortBy
    if (sortBy.isEmpty) return rows
    sortBy.foldRight(rows) { case (keySpec, currentRows) =>
      val field     = keySpec.field
      val direction = keySpec.direction
      val desc      = direction.equalsIgnoreCase("desc")
      if (field.isEmpty) currentRows
      else
        currentRows.sortWith { (a, b) =>
          val av = Option(a.getOrElse(field, null))
          val bv = Option(b.getOrElse(field, null))
          (av, bv) match {
            case (None, _) => false
            case (_, None) => true
            case (Some(x), Some(y)) =>
              val cmp = compareNonNullAsc(x, y)
              if (desc) cmp > 0 else cmp < 0
          }
        }
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = SortConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[SortConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[SortConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[SortConfig].toJson
  }
}
