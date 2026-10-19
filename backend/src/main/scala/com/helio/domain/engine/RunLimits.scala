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

  private def cost(rows: Seq[Map[String, Any]]): Long = rows.iterator.map(_.size.toLong + RowCostCells).sum

  /** What a real run holds once the walk is done: every retained frame once (by identity) plus the JSON copies the success path makes of
   *  them: the terminal's, and the largest other retained Output frame (those are converted one at a time). */
  def postWalkCells(nodeOutcomes: Map[NodeKey, NodeOutcome], retain: Set[NodeKey], terminalRows: Seq[Map[String, Any]]): Long = {
    val frames = nodeOutcomes.collect { case (k, o) if retain.contains(k) || (o.rows eq terminalRows) => o.rows }.toVector
    val distinct = frames.foldLeft(Vector.empty[Seq[Map[String, Any]]])((acc, f) => if (acc.exists(_ eq f)) acc else acc :+ f)
    val others   = distinct.filterNot(_ eq terminalRows)
    val held     = (terminalRows +: others).map(cost).sum
    held + cost(terminalRows) + others.map(cost).maxOption.getOrElse(0L)
  }

  /** The context the run backend hands the engine: the limits above, worded as a pipeline run limit. */
  val contextTransform: PipelineExecutionContext => PipelineExecutionContext =
    _.copy(maxNodeRows = Some(MaxNodeRows), maxLiveCells = Some(MaxLiveCells), maxStringChars = Some(MaxStringChars), limitLabel = LimitLabel.Run)
}
