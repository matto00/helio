package com.helio.domain.engine

import com.helio.domain.model.PipelineExecutionContext
import com.helio.domain.steps.{LimitLabel, RowBudget}

/** HEL-1660 (owner rulings 2-4, design.md D1): the memory limits every real run (manual, scheduled, hook, auto-run, backfill) and the
 *  saved-step preview execute under. They are applied in one place, [[InProcessExecutionBackend.execute]], which every one of those
 *  paths reaches, so no caller can forget them. The draft preview sets its own, smaller ones (`DraftPreviewLimits`). */
object RunLimits {

  /** Owner ruling 2: rows in any one node's output. */
  val MaxNodeRows: Int = RowBudget.RunMaxNodeRows

  /** Owner ruling 4: characters in any one text value a step creates. */
  val MaxStringChars: Int = 1048576

  /** Owner ruling 3: cells (rows x columns, plus the length-priced text they hold, see `CellWeight`) held across every frame the walk
   *  retains plus the frame a node just produced. Sized by `RunPathHeapSpec` so the worst measured run stays at or under 25% of the
   *  768 MB production heap (192 MB); the measurement is recorded in this change's design.md (D6). */
  val MaxLiveCells: Long = 2600000L

  /** Cells one row costs beyond its own values, for pricing a frame (and its JSON copy) in `postWalkCells`: the row map and the JSON object
   *  wrapper, measured at about 6 cells' worth of heap, so a tall frame is priced above a wide one of equal cells. */
  val RowCostCells: Long = 6L

  /** Owner ruling 3, the part the walk's tally cannot see: after the walk a real run holds the frames it retained (each Output's node and
   *  the trunk terminal) AND builds JSON copies of them (the terminal's for the response, one Output node's at a time for its snapshot).
   *  A run whose retained frames plus those copies cost more than this is refused before it writes anything. Sized by `RunPathHeapSpec`. */
  val MaxPostWalkCells: Long = 3900000L

  /** HEL-1679 (owner ruling 3, design.md D3): the widest single row, in characters of its `compactPrint` text, a real run (or backfill) may write. A
   *  snapshot write renders a batch of rows at a time but can never split a row, so a row wider than this would take the write past the per-run
   *  share; it is refused up front instead. Sized by `RunPathHeapSpec` at the joint worst the other limits allow (see design.md D3 and
   *  `evidence/`). It sits above the 1,048,584-character render of a row holding one ruling-4 value, so such a row is always writable. */
  val MaxRowRenderChars: Long = 2000000L

  private def cost(rows: Seq[Map[String, Any]]): Long = rows.iterator.map(_.size.toLong + RowCostCells).sum

  /** The frames a finished run holds, once each by identity, the terminal first: the trunk terminal and every retained Output frame. The one place
   *  that selects them, for `postWalkCells` (cells) and `widestRetainedRowChars` (row width). */
  private def retainedFrames(nodeOutcomes: Map[NodeKey, NodeOutcome], retain: Set[NodeKey], terminalRows: Seq[Map[String, Any]]): Vector[Seq[Map[String, Any]]] = {
    val frames = nodeOutcomes.collect { case (k, o) if retain.contains(k) || (o.rows eq terminalRows) => o.rows }.toVector
    frames.foldLeft(Vector[Seq[Map[String, Any]]](terminalRows))((acc, f) => if (acc.exists(_ eq f)) acc else acc :+ f)
  }

  /** What a real run holds once the walk is done: every retained frame once (by identity) plus the JSON copies the success path makes of
   *  them: the terminal's, and the largest other retained Output frame (those are converted one at a time). */
  def postWalkCells(nodeOutcomes: Map[NodeKey, NodeOutcome], retain: Set[NodeKey], terminalRows: Seq[Map[String, Any]]): Long = {
    val distinct = retainedFrames(nodeOutcomes, retain, terminalRows)
    val others   = distinct.filterNot(_ eq terminalRows)
    val held     = (terminalRows +: others).map(cost).sum
    held + cost(terminalRows) + others.map(cost).maxOption.getOrElse(0L)
  }

  /** Whether a row of `chars` rendered characters is wider than a real run (or backfill) may write. Exactly the limit is accepted. */
  def rowTooWide(chars: Long): Boolean = chars > MaxRowRenderChars

  /** The widest row, in `compactPrint` characters, among `rows` (0 when empty); computed without rendering (`JsonTextLength.ofRow`). */
  def widestRowChars(rows: Iterable[Map[String, Any]]): Long = rows.iterator.map(JsonTextLength.ofRow).maxOption.getOrElse(0L)

  /** The widest row of every frame the success path renders: the trunk terminal and each retained Output frame (the frames `postWalkCells` prices, selected by the same `retainedFrames`). */
  def widestRetainedRowChars(nodeOutcomes: Map[NodeKey, NodeOutcome], retain: Set[NodeKey], terminalRows: Seq[Map[String, Any]]): Long = {
    retainedFrames(nodeOutcomes, retain, terminalRows).map(widestRowChars(_)).max
  }

  /** The context the run backend hands the engine: the limits above, worded as a pipeline run limit. */
  val contextTransform: PipelineExecutionContext => PipelineExecutionContext =
    _.copy(maxNodeRows = Some(MaxNodeRows), maxLiveCells = Some(MaxLiveCells), maxStringChars = Some(MaxStringChars), limitLabel = LimitLabel.Run)
}
