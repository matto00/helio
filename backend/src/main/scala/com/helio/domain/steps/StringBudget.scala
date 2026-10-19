package com.helio.domain.steps

import java.util.Locale

/** HEL-1630 (owner ruling C7): how the draft preview prices text. A cell is priced at `BytesPerCell` bytes (the measured heap per
 *  boxed cell in `DraftPreviewHeapSpec`), and a text value at `BytesPerChar` bytes per character on top of that (UTF-16, the
 *  worst case: the JVM stores Latin-1 text at one byte per character). */
object CellWeight {
  val BytesPerCell: Long = 46L
  val BytesPerChar: Long = 2L

  /** The cells a text of `length` characters weighs beyond the one cell holding it. */
  def textCells(length: Int): Long = length.toLong * BytesPerChar / BytesPerCell
}

/** HEL-1630 (owner ruling C7), reused by every run and the saved preview in HEL-1660 (owner ruling 4): the cap on text a text-creating step creates (`compute`, `stringops`; `splittext`, `extractheadings`, `chunkbytokencount`, `convertformat`, `cast` to string since owner ruling C8; `pivot` column names since C9), so the post-node cell budget
 *  is not the only thing between one step and the heap. One instance per node, built by the engine: `maxChars` bounds any single
 *  text value, `limitBytes` the running total of new text this node has created (the live-cell headroom at the moment the node
 *  starts, in bytes). A breach is that step's error, with a message of its own worded by `label`. A context with no budget (a direct step call) is unbounded. */
final class StringBudget(val maxChars: Int, limitBytes: Long, val label: LimitLabel = LimitLabel.Draft) {
  private var usedBytes = 0L

  /** Charges the text a step just created (every cell value of another type is free). */
  def chargeValue(value: Any): Unit = value match {
    case s: String => charge(s.length)
    case _         => ()
  }

  def charge(length: Int): Unit = {
    if (length > maxChars) throw StringBudget.tooLong(maxChars, label)
    usedBytes += length.toLong * CellWeight.BytesPerChar
    if (usedBytes > limitBytes) throw StringBudget.exceeded(limitBytes, label)
  }

  /** The longest text `length` characters may reach before it is built (a concatenation checks first, so it never allocates it). */
  def checkLength(length: Long): Unit = if (length > maxChars) throw StringBudget.tooLong(maxChars, label)
}

object StringBudget {
  private def mebibytes(bytes: Long): String = String.format(Locale.US, "%.1f", Double.box(bytes / 1048576.0))

  /** One text value over the per-value cap. */
  def tooLong(maxChars: Int, label: LimitLabel = LimitLabel.Draft): StepConfigError =
    new StepConfigError(s"${label.sentence} text limit reached: this step would create a text value of more than $maxChars characters. Shorten the expression or the text it joins.")

  /** The running total of new text one node creates over what the request has left. */
  def exceeded(limitBytes: Long, label: LimitLabel = LimitLabel.Draft): StepConfigError =
    new StepConfigError(s"${label.sentence} text limit reached: this step would create more than ${mebibytes(limitBytes)} MB of new text at once, which is what this ${label.scope} has left. Shorten the text or end the branch earlier.")
}
