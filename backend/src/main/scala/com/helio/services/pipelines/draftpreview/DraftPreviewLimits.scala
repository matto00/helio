package com.helio.services.pipelines.draftpreview

import com.helio.domain.steps.RowBudget

/** HEL-1630 design.md D7: the draft preview's caps. A request over any of them is refused with `413` naming the cap. */
object DraftPreviewLimits {
  val MaxBodyBytes: Int = 4 * 1024 * 1024

  /** Rows in one input, lane or source frame. The 1,000-row sample cap bounds what a source contributes, but client steps
   *  upstream (unpivot, splittext, a join fan-out) can grow a frame past it. */
  val MaxFrameRows: Int = 10000
  val MaxRoots: Int     = 8
  val MaxLanes: Int     = 8
  val MaxSources: Int   = 8
  val MaxSteps: Int     = 50
  val MaxIdLength: Int  = 64

  /** Rows on the final `rows` line. */
  val MaxResponseRows: Int = 1000

  /** The per-node output ceiling (owner ruling `row-budget`). */
  val MaxNodeRows: Int = RowBudget.DraftMaxNodeRows

  /** The per-request live-cell budget (owner rulings C6, C7): cells (rows x columns, plus the length-priced text they hold, see
   *  `CellWeight`) held across every frame the walk retains plus the frame a node just produced. Sized from `DraftPreviewHeapSpec`'s
   *  measurement so the worst shape measured stays at or under 96 MB. */
  val MaxLiveCells: Long = 1800000L

  /** The longest text one text-creating step (`compute`, `stringops`, `splittext`, `extractheadings`, `chunkbytokencount`, `convertformat`, `cast` to string, `pivot` column names) may create (owner rulings C7, C8, C9), in characters. The 4 MiB body bounds what a
   *  request can supply, and ordinary text (1,000-row samples, article-length cells of tens of thousands of characters) is far
   *  under it; it also bounds the text a nested `concat` builds in one expression. Alongside it each node gets a running
   *  total of new text capped at what the request has left under [[MaxLiveCells]] (`StringBudget`). */
  val MaxStringChars: Int = 262144
}
