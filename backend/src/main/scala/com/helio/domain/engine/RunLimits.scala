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

  /** The context the run backend hands the engine: the limits above, worded as a pipeline run limit. */
  val contextTransform: PipelineExecutionContext => PipelineExecutionContext =
    _.copy(maxNodeRows = Some(MaxNodeRows), maxLiveCells = Some(MaxLiveCells), maxStringChars = Some(MaxStringChars), limitLabel = LimitLabel.Run)
}
