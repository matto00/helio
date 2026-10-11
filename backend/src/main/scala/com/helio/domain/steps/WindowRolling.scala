package com.helio.domain.steps

import com.helio.domain.engine.PipelineRowJson

import java.math.{BigDecimal => JBigDecimal}
import scala.collection.mutable

/** HEL-1316: the trailing rolling-frame algorithm behind `WindowStep`'s `rolling_*` functions, split out of
 *  `WindowStep` to keep it under the file-size budget. Behaviour is specified on `WindowStep` and in the
 *  `pipeline-window-op` spec. */
private[steps] object WindowRolling {

  /** HEL-1316: one partition's trailing rolling values, keyed by original row index.
   *
   *  `rows` mode: the sorted partition's position `p` frames positions `max(0, p - N + 1)..p`. `days` mode: rows with a
   *  parseable key (per `datebucket`'s date parsing) are ordered by that UTC date (index tie-break); a row dated `d`
   *  frames every row dated within `[d - (N - 1), d]`, so same-date peers share one frame and one value. A row with a
   *  null or unparseable key gets `null` and is in no frame. Frame bounds never move backwards, so sum/count slide
   *  and min/max use monotonic deques: O(n) after the sort. */
  def compute(groupRows: Seq[(PipelineRowJson.Row, Int)], cfg: WindowConfig, field: String): Map[Int, Any] = {
    val size = cfg.frameSize.get // `WindowStep.apply` already threw on a missing frameSize
    if (cfg.frameUnit.contains("days")) {
      val key = cfg.orderBy.head.field
      val dated = groupRows
        .flatMap { case (row, idx) => DateBucketStep.parseToUtcDate(row.getOrElse(key, null)).map(d => (d, row, idx)) }
        .sortBy { case (d, _, idx) => (d.toEpochDay, idx) }
      val dates  = dated.map(_._1.toEpochDay).toIndexedSeq
      val values = dated.map { case (_, row, _) => numericValue(row, field) }.toIndexedSeq
      var start  = 0
      // `lastPeer(i)`: the last position dated like position i, so peers share one frame.
      val lastPeer = new Array[Int](dates.size)
      var i        = dates.size - 1
      while (i >= 0) {
        lastPeer(i) = if (i + 1 < dates.size && dates(i + 1) == dates(i)) lastPeer(i + 1) else i
        i -= 1
      }
      val ranges = dates.indices.map { p =>
        while (dates(start) < dates(p) - (size - 1)) start += 1
        (start, lastPeer(p))
      }
      val framed = slideFrames(cfg.function, values, ranges)
      val nulls  = groupRows.map(_._2).toSet -- dated.map(_._3)
      dated.map(_._3).zip(framed).toMap ++ nulls.map(_ -> (null: Any))
    } else {
      val sorted = groupRows.sorted(WindowStep.rowOrdering(cfg.orderBy))
      val values = sorted.map { case (row, _) => numericValue(row, field) }.toIndexedSeq
      val ranges = values.indices.map(p => (math.max(0, p - size + 1), p))
      sorted.map(_._2).zip(slideFrames(cfg.function, values, ranges)).toMap
    }
  }

  /** A contributing value: non-null, numerically coercible, and finite (NaN/Infinity are skipped, as SQL aggregates
   *  skip unusable values and as spray-json cannot encode them). */
  private def numericValue(row: PipelineRowJson.Row, field: String): Option[Double] =
    PipelineRowJson.toDouble(row.getOrElse(field, null)).filter(d => !d.isNaN && !d.isInfinity)

  /** Aggregates `values` over inclusive `(start, end)` ranges whose bounds are non-decreasing. Sum is an exact
   *  `BigDecimal` so add/subtract never drifts; the result is `null` (count: `0`) when no value contributed. */
  private def slideFrames(function: String, values: IndexedSeq[Option[Double]], ranges: IndexedSeq[(Int, Int)]): Seq[Any] = {
    var added   = -1
    var removed = 0
    var sum     = JBigDecimal.ZERO
    var count   = 0
    val deque   = mutable.ArrayDeque.empty[Int]
    val wantMin = function == "rolling_min"
    val wantMax = function == "rolling_max"
    ranges.map { case (start, end) =>
      while (added < end) {
        added += 1
        values(added).foreach { v =>
          sum = sum.add(new JBigDecimal(v))
          count += 1
          if (wantMin) { while (deque.nonEmpty && values(deque.last).get >= v) deque.removeLast(); deque.append(added) }
          if (wantMax) { while (deque.nonEmpty && values(deque.last).get <= v) deque.removeLast(); deque.append(added) }
        }
      }
      while (removed < start) {
        values(removed).foreach { v =>
          sum = sum.subtract(new JBigDecimal(v))
          count -= 1
          if (deque.headOption.contains(removed)) deque.removeHead()
        }
        removed += 1
      }
      function match {
        case "rolling_count" => count
        case _ if count == 0 => null
        case "rolling_sum"   => sum.doubleValue
        case "rolling_avg"   => sum.doubleValue / count
        case _               => values(deque.head).get // rolling_min / rolling_max
      }
    }
  }
}
