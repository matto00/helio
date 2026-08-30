package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
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
    val keys = StepCodecUtil.stringArray(obj, "keys")
    // HEL-814 D4/5.1b: an omitted `keep` still means "first", and a
    // case-variant ("LAST") normalizes to its canonical member — but an
    // UNKNOWN value is passed through unchanged instead of being rewritten to
    // "first", which would INVERT which row wins while reporting success.
    // Analyze and run reject the unknown value; decode keeps the row readable.
    val keep = StepCodecUtil.normalizeEnum(
      StepCodecUtil.str(obj, "keep", "first"),
      DedupeStep.SupportedKeep
    )
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

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(DedupeStep.apply(rows, config))
}

object DedupeStep {
  val Kind: String = "dedupe"

  /** HEL-814 D4: the engine's own `keep` set, matched case-insensitively at
   *  decode and validated against here at analyze and run. */
  val SupportedKeep: Vector[String] = Vector("first", "last")

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

    /** HEL-814 D4. `keys` stays optional — an empty `keys` is whole-row
     *  distinct, a fully specified algorithm (`pipeline-dedupe-op:9`, UI
     *  requirement `:52`). Only an unknown `keep` is rejected: silently
     *  resolving it to `"first"` INVERTS which row survives. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      StepCodecUtil.unsupportedEnum(Kind, "keep", DedupeConfig.decode(raw).keep, SupportedKeep)
  }
}
