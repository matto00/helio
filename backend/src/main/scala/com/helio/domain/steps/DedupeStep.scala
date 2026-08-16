package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `dedupe` step (HEL-382) — the fifth leaf of the
 *  HEL-336 Pipeline Op Expansion epic. `keys` names the fields the dedupe
 *  key is built from; an empty `keys` means whole-row distinct (compare
 *  every field/value pair). `keep` selects which occurrence survives when
 *  multiple rows share a key: `"first"` (default) or `"last"`, by original
 *  input row order. */
final case class DedupeConfig(keys: Vector[String], keep: String)

object DedupeConfig {
  implicit val format: RootJsonFormat[DedupeConfig] = jsonFormat2(DedupeConfig.apply)

  /** Tolerant decode: missing `keys` defaults to empty (whole-row distinct),
   *  missing/malformed `keep` defaults to `"first"` — mirrors `LimitConfig`/
   *  `UnpivotConfig`'s decode pattern. */
  def decode(raw: String): DedupeConfig = {
    val obj  = StepCodecUtil.asObject(raw)
    val keys = obj.fields.get("keys") match {
      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
      case _                    => Vector.empty[String]
    }
    // Only the literal "last" selects last-occurrence; anything else
    // (including missing or malformed values) normalizes to "first".
    val keep = if (StepCodecUtil.stringOr(obj, "keep", "first") == "last") "last" else "first"
    DedupeConfig(keys, keep)
  }
}

/** Dedupe step — a pure row filter (no schema change), same passthrough
 *  shape as `LimitStep`. Semantics (design.md):
 *
 *    - `keys` empty: dedupe on the whole row, compared as a sorted-by-field-
 *      name vector of (field, value) pairs — not raw map iteration order,
 *      since Scala `Map` iteration order isn't guaranteed stable across
 *      equal-content maps built via different code paths.
 *    - `keys` non-empty: dedupe on the tuple of those fields' values, looked
 *      up via `row.getOrElse(_, null)` so a missing field and an explicit
 *      `null` collapse together (`null == null` holds for `Any` equality).
 *    - `keep = "first"`: single left-to-right pass with a seen-set, emitting
 *      a row the first time its key is seen.
 *    - `keep = "last"`: a lookahead pass computes each key's last-occurrence
 *      row index, then an emit pass keeps rows whose index matches — this
 *      preserves the original relative order of the kept rows rather than
 *      reordering to put duplicates at the front.
 *
 *  Both branches are O(n) and preserve the original relative order of the
 *  surviving rows (a stable filter, same ordering guarantee as `limit`/
 *  `filter`). */
final case class DedupeStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: DedupeConfig,
    createdAt: Instant,
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = DedupeStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(DedupeStep.apply(rows, config))
}

object DedupeStep {
  val Kind: String = "dedupe"

  /** Build the dedup key for a row. Non-empty `keys`: the tuple of those
   *  fields' values (in `keys` order). Empty `keys`: the whole row, as a
   *  vector of (field, value) pairs sorted by field name so two rows with
   *  identical field/value sets collapse together regardless of the
   *  underlying `Map`'s iteration order. */
  private def dedupeKey(row: PipelineRowJson.Row, keys: Vector[String]): Any =
    if (keys.nonEmpty) keys.map(k => row.getOrElse(k, null))
    else row.toVector.sortBy(_._1)

  def apply(rows: Seq[PipelineRowJson.Row], cfg: DedupeConfig): Seq[PipelineRowJson.Row] = {
    val keys = cfg.keys
    if (cfg.keep == "last") {
      // Lookahead pass: find the last row index for each key.
      val lastIndexByKey = scala.collection.mutable.Map.empty[Any, Int]
      rows.zipWithIndex.foreach { case (row, idx) =>
        lastIndexByKey(dedupeKey(row, keys)) = idx
      }
      rows.zipWithIndex.collect {
        case (row, idx) if lastIndexByKey(dedupeKey(row, keys)) == idx => row
      }
    } else {
      // keep = "first" (default): single left-to-right pass with a seen-set.
      val seen = scala.collection.mutable.Set.empty[Any]
      rows.filter { row =>
        val key = dedupeKey(row, keys)
        if (seen.contains(key)) false
        else {
          seen += key
          true
        }
      }
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = DedupeConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[DedupeConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[DedupeConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[DedupeConfig].toJson
  }
}
