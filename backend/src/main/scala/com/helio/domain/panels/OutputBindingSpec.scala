package com.helio.domain.panels

import com.helio.domain.model.{DataFieldType, OutputKind}
import com.helio.domain.engine.SchemaField

/** Column-type eligibility rule for one `fieldMapping` slot (design.md D2).
 *  Moved here from the retired `PanelBindingSpec` (HEL-904 task 3.6 collapse)
 *  — same three-value contract, unchanged semantics.
 *
 *  `Numeric` accepts `integer`/`float` (a metric `value` / chart `yAxis`
 *  needs a summable column); `Orderable` accepts `timestamp`/`integer`/
 *  `float` (a timeline `time` needs something sortable); `Any` accepts
 *  every column (`label`/`unit`/`xAxis`/`series`/`annotation`/`event`). */
sealed trait SlotEligibility
object SlotEligibility {
  case object Numeric   extends SlotEligibility
  case object Orderable extends SlotEligibility
  case object Any        extends SlotEligibility

  def accepts(eligibility: SlotEligibility, fieldType: DataFieldType): Boolean = eligibility match {
    case Numeric =>
      fieldType == DataFieldType.IntegerType || fieldType == DataFieldType.FloatType
    case Orderable =>
      fieldType == DataFieldType.TimestampType ||
        fieldType == DataFieldType.IntegerType ||
        fieldType == DataFieldType.FloatType
    case Any => true
  }
}

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

  /** HEL-906 (task 3.6, absorbed bug HEL-892) — validates the SLOT NAMES of a
   *  `fieldMapping` (not column-type eligibility, which `evaluate` already
   *  covers) against `spec`'s own `requiredSlots ++ optionalSlots`. Returns
   *  `Left` naming every unknown key and the full valid-slot list for this
   *  kind (never just the first bad key, so a caller sees the whole problem
   *  in one round trip) -- the ticket's "400 naming the valid slots for that
   *  kind" contract. Pure domain logic; not yet wired to a live HTTP route
   *  (no endpoint accepts an Output `fieldMapping` payload in this cycle —
   *  see execution-progress.md's CR8 deferral) but exercised directly by
   *  `OutputBindingSpecSpec`. */
  def validateFieldMapping(spec: OutputBindingSpec, fieldMapping: Map[String, String]): Either[String, Unit] = {
    val validSlots  = spec.allSlots
    val unknownKeys = fieldMapping.keySet.diff(validSlots.toSet)
    if (unknownKeys.isEmpty) Right(())
    else Left(
      s"Unknown fieldMapping slot(s) for '${OutputKind.asString(spec.outputKind)}': " +
        s"${unknownKeys.toVector.sorted.mkString(", ")}. Valid slots: ${validSlots.mkString(", ")}"
    )
  }

  /** HEL-907 task 1.4 — grounds a `fieldMapping`'s VALUES (column names) against the actual
   *  projected schema AT THE OUTPUT'S OWN NODE (`PipelineAnalyzeService.analyzeNodes` for a
   *  step-targeted Output; the source's own `inferredSchema` directly for a source-attached one,
   *  `nodeStepId: None` paired with the Output's own `rootId` — `analyzeNodes` omits the source
   *  itself from its per-node map, and a bare `null`/`None` `nodeStepId` with no accompanying
   *  root is never a valid encoding under multi-root pipelines; see
   *  `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md` R12/R15). A
   *  DIFFERENT check from [[validateFieldMapping]] above (which validates the mapping's KEYS —
   *  the slot names — against the kind's own spec, never touching the schema at all): a
   *  proposal or MCP tool call can name a real slot (`value`, `time`, ...) but point it at a
   *  column that doesn't exist at this specific node, e.g. because it exists on the TRUNK but
   *  this Output targets a TAIL branch that dropped or renamed it, or the column was consumed by
   *  an aggregate/select step upstream of this node. Column-TYPE eligibility (`SlotEligibility`)
   *  is a separate, already-covered concern (`evaluate`'s `eligibleColumns`) — this function only
   *  checks EXISTENCE by name, never type. Returns `Left` naming every missing column (never just
   *  the first), mirroring `validateFieldMapping`'s own "whole problem in one round trip"
   *  contract. */
  def validateFieldMappingColumnsExist(fieldMapping: Map[String, String], schema: Vector[SchemaField]): Either[String, Unit] = {
    val columnNames = schema.map(_.name).toSet
    val missing     = fieldMapping.values.toVector.distinct.filterNot(columnNames.contains)
    if (missing.isEmpty) Right(())
    else Left(
      s"fieldMapping references column(s) not present at this node: ${missing.sorted.mkString(", ")}. " +
        s"Available columns: ${schema.map(_.name).sorted.mkString(", ")}"
    )
  }
}
