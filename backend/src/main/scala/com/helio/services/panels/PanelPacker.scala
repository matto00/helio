package com.helio.services.panels

import com.helio.domain.model.{DashboardLayoutItem, OutputKind, PanelId, PanelKind}

import scala.collection.mutable.ArrayBuffer

/** Pure Scala port of helio-news' `_pack` / `_fill_shelf` / `_clamp` /
 *  `_BOUNDS` (`~/Development/helio-news/news/run.py`, HEL-367). Flows an
 *  ordered list of `(panelId, kind, w, h)` sizes left-to-right across a
 *  `cols`-wide grid, wrapping to a new shelf when a row would overflow, so
 *  overlapping rectangles are impossible by construction.
 *
 *  Zero HTTP/DB dependency (design.md Goals) — `AutoLayoutService` is the
 *  only caller. Input order IS visual order (design.md D3): no re-sorting
 *  by kind, size, or panel id. Same input + `cols` ⇒ byte-identical output,
 *  always. */
object PanelPacker {

  /** One input size to pack. `kind` is looked up server-side by the caller
   *  from the dashboard's actual panels — never trusted from the request
   *  body (design.md D4). */
  final case class PackInput(panelId: PanelId, kind: String, w: Int, h: Int)

  /** Per-kind floor/ceiling. `maxW` is implicitly `cols`, applied in
   *  [[clamp]] exactly like `_clamp`'s `min(GRID_COLS, w)`. */
  private final case class ClampBounds(minW: Int, minH: Int, maxH: Int)

  /** `_BOUNDS.get(kind, (1, 2, 24))`'s fallback — used for any kind not in
   *  [[Bounds]] (text/divider/timeline, per design.md D4's table). */
  private val DefaultBounds = ClampBounds(minW = 1, minH = 2, maxH = 24)

  /** Ported verbatim from `_BOUNDS` (design.md D4), with one HEL-904
   *  adjustment: `Metric`/`Chart`/`Table`/`Collection` collapsed onto the
   *  single `PanelKind.Output` kind now that they're the same panel type —
   *  bounds merged to the widest of the four former entries (`Chart`'s) as a
   *  placeholder pending the real per-Output-kind sizing decision (design.md
   *  references a future "decision-15 default size" for `POST /api/panels`
   *  that this ticket doesn't itself define). */
  private val Bounds: Map[String, ClampBounds] = Map(
    PanelKind.Output     -> ClampBounds(minW = 4, minH = 6, maxH = 24),
    PanelKind.Image      -> ClampBounds(minW = 3, minH = 5, maxH = 24),
    PanelKind.Markdown   -> ClampBounds(minW = 3, minH = 5, maxH = 24)
  )

  /** `_FILL_THRESHOLD` in helio-news is a fixed `7` against a fixed
   *  `GRID_COLS = 12` — that codebase never varies its grid width. This port
   *  makes `cols` configurable (ticket scope), so the threshold scales with
   *  it: `round(cols * 7 / 12)` preserves the same ~58%-full trigger ratio
   *  at any grid width, rather than hard-coding `7` (which would be
   *  unreachable below a 7-column grid). Judgment call — helio-news has no
   *  reference behavior for a non-12 grid to match against; flagged for
   *  review. */
  private def fillThreshold(cols: Int): Int =
    math.max(1, math.round(cols * 7.0 / 12).toInt)

  /** Clamp one item's `(w, h)` to its kind's bounds. Exposed for direct unit
   *  testing — mirrors `_clamp`. */
  def clamp(kind: String, w: Int, h: Int, cols: Int): (Int, Int) = {
    val bounds   = Bounds.getOrElse(kind, DefaultBounds)
    val clampedW = math.max(bounds.minW, math.min(cols, w))
    val clampedH = math.max(bounds.minH, math.min(bounds.maxH, h))
    (clampedW, clampedH)
  }

  /** One packed item, mutable during a single [[pack]] call so [[fillShelf]]
   *  can widen `w`/`x` in place — mirrors `_pack`'s dict mutation. Never
   *  escapes this object; `pack` converts every item to an immutable
   *  [[DashboardLayoutItem]] before returning. */
  private final case class MutableItem(panelId: PanelId, var x: Int, var y: Int, var w: Int, var h: Int)

  /** Widen a nearly-full shelf's items to close the ragged right edge,
   *  mirroring `_fill_shelf` exactly: widen every item proportionally,
   *  settle any rounding drift on the widest item, then re-flow `x` left to
   *  right. Mutates `shelf` in place; no-op for an empty, already-flush, or
   *  too-sparse shelf. */
  private def fillShelf(shelf: ArrayBuffer[MutableItem], cols: Int): Unit = {
    if (shelf.isEmpty) return
    val used = shelf.map(_.w).sum
    if (used >= cols || used < fillThreshold(cols)) return

    shelf.foreach(p => p.w = math.max(1, math.round(p.w.toDouble * cols / used).toInt))

    val drift = cols - shelf.map(_.w).sum
    if (drift != 0) {
      val widest = shelf.maxBy(_.w)
      widest.w = math.max(1, widest.w + drift)
    }

    var x = 0
    shelf.foreach { p =>
      p.x = x
      x += p.w
    }
  }

  /** Flow `items` left-to-right across `cols` columns, wrapping to a new
   *  shelf when a row would overflow (`x + w > cols`). Preserves input
   *  order as visual order. Empty input returns an empty result; a single
   *  item is placed at `(0, 0)` (widened by [[fillShelf]] only if it clears
   *  the fill threshold on its own shelf). */
  def pack(items: Vector[PackInput], cols: Int): Vector[DashboardLayoutItem] = {
    val allItems = ArrayBuffer.empty[MutableItem]
    var shelf    = ArrayBuffer.empty[MutableItem]
    var x        = 0
    var y        = 0
    var shelfH   = 0

    items.foreach { input =>
      val (w, h) = clamp(input.kind, input.w, input.h, cols)
      if (x + w > cols) {
        fillShelf(shelf, cols)
        shelf = ArrayBuffer.empty[MutableItem]
        x = 0
        y += shelfH
        shelfH = 0
      }
      val item = MutableItem(input.panelId, x, y, w, h)
      allItems += item
      shelf += item
      x += w
      shelfH = math.max(shelfH, h)
    }
    fillShelf(shelf, cols)

    allItems.map(i => DashboardLayoutItem(i.panelId, i.x, i.y, i.w, i.h)).toVector
  }
}

/** Decision-15 (epic spec `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`
 *  lines 44 / 140 / 224): the server-owned default grid size for a freshly
 *  placed `POST /api/panels` Output panel, keyed by the referenced Output's
 *  own `kind` — distinct from [[PanelPacker.Bounds]], which clamps sizes for
 *  the (unrelated) `/auto-layout` re-flow endpoint and has no per-Output-kind
 *  granularity (every Output panel collapses onto one `PanelKind.Output`
 *  bound there). This table is the one place decision-15's six explicit
 *  sizes live — never duplicated on the frontend (`useOutputPickerData`/
 *  `panelService.ts` send no layout at all; see their own comments). */
object OutputPanelDefaultSize {
  final case class Size(w: Int, h: Int)

  private val Sizes: Map[OutputKind, Size] = Map(
    OutputKind.Metric     -> Size(w = 3, h = 2),
    OutputKind.Chart      -> Size(w = 6, h = 4),
    OutputKind.Table      -> Size(w = 6, h = 6),
    OutputKind.Collection -> Size(w = 6, h = 4),
    OutputKind.Timeline   -> Size(w = 4, h = 6),
    OutputKind.Markdown   -> Size(w = 4, h = 4)
  )

  def forKind(kind: OutputKind): Size = Sizes(kind)
}
