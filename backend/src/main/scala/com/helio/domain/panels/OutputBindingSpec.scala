package com.helio.domain.panels

import com.helio.domain.model.{DataFieldType, OutputKind}
import com.helio.domain.engine.SchemaField

/** HEL-904 (Outputs remodel) task 3.6 — `PanelBindingSpec` becomes
 *  `OutputBindingSpec`, keyed by [[OutputKind]] instead of `PanelType`
 *  (design.md's "Output kinds" decision / ticket.md task 3.6). Same
 *  slot/eligibility logic as `PanelBindingSpec` — this is the Output-side
 *  successor, added additively alongside it. `PanelBindingSpec` itself, and
 *  the bound `*Panel.scala` subtypes it describes, are retired later in the
 *  same task once every consumer (`PanelCapabilityService` §3.11,
 *  `PanelRepository`/`PanelService`, the wire protocols) is rewired onto
 *  Outputs — this file is the first, non-breaking increment of that work,
 *  landed on its own so the tree keeps compiling throughout (mirrors how
 *  `Output`/`OutputRepository` themselves were added additively in tasks
 *  1.1/1.5 before anything read or wrote them).
 *
 *  Reuses [[SlotEligibility]] (defined alongside `PanelBindingSpec` in this
 *  same package) rather than duplicating it — both specs describe the same
 *  underlying column-type-fitness concept, just keyed by a different enum. */
final case class OutputBindingSpec(
    outputKind: OutputKind,
    requiredSlots: Vector[String],
    optionalSlots: Vector[String],
    columnEligibility: Map[String, SlotEligibility]
) {
  def allSlots: Vector[String] = requiredSlots ++ optionalSlots

  def eligibilityOf(slotKey: String): SlotEligibility =
    columnEligibility.getOrElse(slotKey, SlotEligibility.Any)
}

object OutputBindingSpec {
  import SlotEligibility._

  // metric → {value, label?, unit?} — carried over verbatim from
  // `PanelBindingSpec.Metric` (same slot contract, new key).
  val Metric: OutputBindingSpec = OutputBindingSpec(
    outputKind        = OutputKind.Metric,
    requiredSlots     = Vector("value"),
    optionalSlots     = Vector("label", "unit"),
    columnEligibility = Map("value" -> Numeric, "label" -> Any, "unit" -> Any)
  )

  // chart → {xAxis, yAxis, series?, annotation?} — carried over verbatim
  // from `PanelBindingSpec.Chart`.
  val Chart: OutputBindingSpec = OutputBindingSpec(
    outputKind        = OutputKind.Chart,
    requiredSlots     = Vector("xAxis", "yAxis"),
    optionalSlots     = Vector("series", "annotation"),
    columnEligibility = Map("xAxis" -> Any, "yAxis" -> Numeric, "series" -> Any, "annotation" -> Any)
  )

  // table → no slots — carried over verbatim from `PanelBindingSpec.Table`.
  val Table: OutputBindingSpec =
    OutputBindingSpec(OutputKind.Table, Vector.empty, Vector.empty, Map.empty)

  // collection → the metric slot set, applied per bound row — carried over
  // verbatim from `PanelBindingSpec.Collection`.
  val Collection: OutputBindingSpec = Metric.copy(outputKind = OutputKind.Collection)

  // timeline → {time, event}, both required — carried over verbatim from
  // `PanelBindingSpec.Timeline`.
  val Timeline: OutputBindingSpec = OutputBindingSpec(
    outputKind        = OutputKind.Timeline,
    requiredSlots     = Vector("time", "event"),
    optionalSlots     = Vector.empty,
    columnEligibility = Map("time" -> Orderable, "event" -> Any)
  )

  // markdown → no fieldMapping slots at all (design.md: "a markdown template
  // interpolated from rows" — the binding is a free-form template string
  // against the row shape, not a per-slot column mapping like the other five
  // kinds). Vacuously bindable, same as `table`. New in this ticket — no
  // `PanelBindingSpec` predecessor (data-bound text/markdown panels were not
  // in `PanelBindingSpec.DataBindable` before HEL-904).
  val Markdown: OutputBindingSpec =
    OutputBindingSpec(OutputKind.Markdown, Vector.empty, Vector.empty, Map.empty)

  /** The six Output kinds `PanelCapabilityService` reports on (§3.11), in
   *  the fixed order the response is built from — successor to
   *  `PanelBindingSpec.DataBindable`. */
  val All: Vector[OutputBindingSpec] = Vector(Metric, Chart, Table, Collection, Timeline, Markdown)

  /** `bindable = false` reason emitted by [[evaluate]] — mirrors
   *  `PanelBindingSpec.MissingColumnsReason` verbatim. */
  val MissingColumnsReason: String = "missing-required-column-type"

  /** Result of evaluating one [[OutputBindingSpec]] against a concrete
   *  column set — mirrors `PanelBindingSpec.BindabilityResult`. */
  final case class BindabilityResult(
      bindable: Boolean,
      eligibleColumns: Map[String, Vector[String]],
      reason: Option[String],
      message: Option[String]
  )

  /** Evaluate `spec` against `columns` (name + wire-string type — the
   *  `SchemaField`s a pipeline node's projected schema carries). `bindable =
   *  true` iff every required slot has at least one eligible column —
   *  `table`/`markdown` (no required slots) are vacuously bindable. */
  def evaluate(spec: OutputBindingSpec, columns: Vector[SchemaField]): BindabilityResult = {
    val eligible = spec.allSlots.map(slot => slot -> eligibleColumnNames(spec, slot, columns)).toMap
    val requiredSatisfied = spec.requiredSlots.forall(slot => eligible.getOrElse(slot, Vector.empty).nonEmpty)
    if (requiredSatisfied)
      BindabilityResult(bindable = true, eligibleColumns = eligible, reason = None, message = None)
    else
      BindabilityResult(
        bindable        = false,
        eligibleColumns = eligible,
        reason          = Some(MissingColumnsReason),
        message         = Some(s"No column satisfies a required slot for '${OutputKind.asString(spec.outputKind)}'")
      )
  }

  private def eligibleColumnNames(spec: OutputBindingSpec, slotKey: String, columns: Vector[SchemaField]): Vector[String] = {
    val eligibility = spec.eligibilityOf(slotKey)
    columns.filter(c => DataFieldType.fromString(c.`type`).exists(t => SlotEligibility.accepts(eligibility, t))).map(_.name)
  }
}
