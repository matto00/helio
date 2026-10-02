package com.helio.services.panels

import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem}

/** The single layout write policy (HEL-1071, design D2/D3). A caller-supplied breakpoint is
 *  validated only when it differs from the stored one: a breakpoint identical to stored
 *  passes through untouched (so a user edit never 400s because of an untouched stored-bad
 *  breakpoint), an absent one is preserved, and a changed one must be fully valid — else the
 *  whole write is rejected and nothing is saved. Never clamps or reflows caller input. */
/** How `DashboardService.update` treats a layout in the request. `Validate` is the only policy
 *  reachable from any route/body; `RestorePriorStored` is internal to patch-set rollback/undo,
 *  which writes back a value that was previously stored (possibly stored-bad) and must not 400. */
sealed trait LayoutWritePolicy
object LayoutWritePolicy {
  case object Validate extends LayoutWritePolicy
  private[services] case object RestorePriorStored extends LayoutWritePolicy
}

object LayoutPolicy {

  val Breakpoints: Vector[String] = Vector("lg", "md", "sm", "xs")

  /** A subset of breakpoints to write; `None` = leave as stored. */
  final case class Patch(
      lg: Option[Vector[DashboardLayoutItem]] = None,
      md: Option[Vector[DashboardLayoutItem]] = None,
      sm: Option[Vector[DashboardLayoutItem]] = None,
      xs: Option[Vector[DashboardLayoutItem]] = None
  ) {
    def get(bp: String): Option[Vector[DashboardLayoutItem]] = bp match {
      case "lg" => lg
      case "md" => md
      case "sm" => sm
      case "xs" => xs
    }
    def isEmpty: Boolean = lg.isEmpty && md.isEmpty && sm.isEmpty && xs.isEmpty
  }

  object Patch {
    def full(layout: DashboardLayout): Patch =
      Patch(Some(layout.lg), Some(layout.md), Some(layout.sm), Some(layout.xs))
  }

  def stored(layout: DashboardLayout, bp: String): Vector[DashboardLayoutItem] = bp match {
    case "lg" => layout.lg
    case "md" => layout.md
    case "sm" => layout.sm
    case "xs" => layout.xs
  }

  /** Order-insensitive multiset equality over `(panelId, x, y, w, h)`. */
  def sameItems(a: Vector[DashboardLayoutItem], b: Vector[DashboardLayoutItem]): Boolean =
    a.size == b.size && a.groupBy(identity).view.mapValues(_.size).toMap == b.groupBy(identity).view.mapValues(_.size).toMap

  private val MaxReported = 10

  /** Violations of every breakpoint in `patch` that differs from `existing`. */
  def violations(existing: DashboardLayout, patch: Patch): Vector[(String, LayoutValidator.Violation)] =
    Breakpoints.flatMap { bp =>
      patch.get(bp).filterNot(sameItems(_, stored(existing, bp))).toVector.flatMap { items =>
        LayoutValidator.violations(items.map(LayoutValidator.toRect), LayoutBreakpointScaling.breakpointCols(bp)).map(bp -> _)
      }
    }

  def message(vs: Vector[(String, LayoutValidator.Violation)]): String = {
    val shown = vs.take(MaxReported).map { case (bp, v) => s"breakpoint '$bp': ${LayoutValidator.describe(v)}" }
    val more  = if (vs.size > MaxReported) s"; and ${vs.size - MaxReported} more" else ""
    "Layout rejected: " + shown.mkString("; ") + more
  }

  /** Merge `patch` into `existing`: absent and identical breakpoints keep the stored value (and
   *  stored order); changed ones must be valid, else `Left(message)` and nothing should be saved. */
  def apply(existing: DashboardLayout, patch: Patch): Either[String, DashboardLayout] = {
    val vs = violations(existing, patch)
    if (vs.nonEmpty) Left(message(vs))
    else Right(merge(existing, patch))
  }

  /** Internal restore-of-a-previously-stored-value path (patch-set rollback/undo): no validation. */
  def applyUnvalidated(existing: DashboardLayout, patch: Patch): DashboardLayout = merge(existing, patch)

  private def merge(existing: DashboardLayout, patch: Patch): DashboardLayout = {
    def pick(bp: String): Vector[DashboardLayoutItem] = {
      val current = stored(existing, bp)
      patch.get(bp).filterNot(sameItems(_, current)).getOrElse(current)
    }
    DashboardLayout(pick("lg"), pick("md"), pick("sm"), pick("xs"))
  }
}

/** The item a new panel was placed at in each breakpoint (HEL-1071, design D4/D11). */
final case class PlacedLayouts(lg: DashboardLayoutItem, md: DashboardLayoutItem, sm: DashboardLayoutItem, xs: DashboardLayoutItem)
