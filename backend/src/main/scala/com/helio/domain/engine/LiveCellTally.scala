package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.steps.CellWeight

import java.util.IdentityHashMap

/** HEL-1630 (owner ruling C6, C7): what the draft preview's tree walk holds, priced in cells. Every cell of every retained frame
 *  weighs one; a text value weighs [[CellWeight.textCells]] more, ONCE per distinct String object across all retained frames
 *  (rows copied from a parent share their text with it, so a column carried through fifty frames is one copy, not fifty).
 *  Frames are added as they land and removed as they are released, so [[held]] is what the walk holds right now.
 *
 *  Single-threaded: the walk's `transformWith` callbacks run one node at a time. */
private[engine] final class LiveCellTally {
  private val texts      = new IdentityHashMap[String, Integer]
  private var frameCells = 0L
  private var textCells  = 0L

  /** Cells held right now. */
  def held: Long = frameCells + textCells

  def add(rows: Seq[Row]): Unit    = rows.foreach(addRow)
  def remove(rows: Seq[Row]): Unit = rows.foreach(removeRow)

  /** Adds `rows` unless that takes [[held]] past `budget`: then the tally is left as it was and the answer is `false`. Stops
   *  scanning at the first row that crosses, so a frame far over budget costs a prefix of a scan, not all of it. */
  def tryAdd(rows: Seq[Row], budget: Long): Boolean = {
    val it    = rows.iterator
    var added = 0
    while (it.hasNext && held <= budget) { addRow(it.next()); added += 1 }
    if (held <= budget) true
    else { rows.iterator.take(added).foreach(removeRow); false }
  }

  private def addRow(row: Row): Unit =
    row.valuesIterator.foreach { v =>
      frameCells += 1
      v match {
        case s: String if CellWeight.textCells(s.length) > 0 =>
          val seen = texts.get(s)
          if (seen == null) { texts.put(s, 1); textCells += CellWeight.textCells(s.length) } else texts.put(s, seen + 1)
        case _ => ()
      }
    }

  private def removeRow(row: Row): Unit =
    row.valuesIterator.foreach { v =>
      frameCells -= 1
      v match {
        case s: String if CellWeight.textCells(s.length) > 0 =>
          val seen = texts.get(s)
          if (seen != null) {
            if (seen <= 1) { texts.remove(s); textCells -= CellWeight.textCells(s.length) } else texts.put(s, seen - 1)
          }
        case _ => ()
      }
    }
}
