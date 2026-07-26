package com.helio.domain.panels

import com.helio.domain.{DataFieldType, PanelType, SchemaField}

/** Column-type eligibility rule for one `fieldMapping` slot (design.md D2).
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

/** Canonical `fieldMapping` slot contract for one bindable [[PanelType]]
 *  (design.md D2/D3) — the single backend definition of "which slots does
 *  this panel kind need, and which column types fit each one", consumed by
 *  `PanelCapabilityService` (and, going forward, any other bind-time or
 *  introspection logic that needs the same answer).
 *
 *  Column-type eligibility here is an advisory heuristic, not an enforced
 *  validator: the backend does not validate `fieldMapping` column fit at
 *  bind time today (`ChartPanelConfig`/`MetricPanelConfig`/etc. all decode
 *  `fieldMapping` as an opaque `JsObject`), so a bind against an
 *  "ineligible" column still succeeds — see design.md Risks/Trade-offs.
 *
 *  `requiredSlots`/`optionalSlots` are cross-checked against the frontend's
 *  `panelSlots.ts` (`PANEL_SLOTS`) and `CollectionEditor.tsx`'s hardcoded
 *  item-field keys by `PanelBindingSpecSpec`, each comparison transcribed
 *  from a specific file:line so the three can't silently diverge. */
final case class PanelBindingSpec(
    panelType: PanelType,
    requiredSlots: Vector[String],
    optionalSlots: Vector[String],
    columnEligibility: Map[String, SlotEligibility]
) {
  def allSlots: Vector[String] = requiredSlots ++ optionalSlots

  def eligibilityOf(slotKey: String): SlotEligibility =
    columnEligibility.getOrElse(slotKey, SlotEligibility.Any)
}

object PanelBindingSpec {
  import SlotEligibility._

  // metric → {value, label?, unit?} — bind_panel (helio-mcp/src/tools/write.ts)
  // and panelSlots.ts's `PANEL_SLOTS.metric` (not live-wired to MetricPanel's
  // own editor — see design.md D2 — but still the documented slot set).
  val Metric: PanelBindingSpec = PanelBindingSpec(
    panelType         = PanelType.Metric,
    requiredSlots     = Vector("value"),
    optionalSlots     = Vector("label", "unit"),
    columnEligibility = Map("value" -> Numeric, "label" -> Any, "unit" -> Any)
  )

  // chart → {xAxis, yAxis, series?, annotation?}. `annotation` is a real
  // reserved slot merged outside panelSlots.ts's generic `PANEL_SLOTS.chart`
  // map (BindingEditor.tsx:245-259, schemas/panel.schema.json:95,
  // helio-mcp/src/tools/write.ts:439-440) — included here, not omitted.
  val Chart: PanelBindingSpec = PanelBindingSpec(
    panelType         = PanelType.Chart,
    requiredSlots     = Vector("xAxis", "yAxis"),
    optionalSlots     = Vector("series", "annotation"),
    columnEligibility = Map("xAxis" -> Any, "yAxis" -> Numeric, "series" -> Any, "annotation" -> Any)
  )

  // table → no slots (bind_panel: "table — no fieldMapping needed"; the
  // vestigial `columns` slot in panelSlots.ts is never read — HEL-255).
  val Table: PanelBindingSpec =
    PanelBindingSpec(PanelType.Table, Vector.empty, Vector.empty, Map.empty)

  // collection → the base-type (metric) slots, applied to every bound row
  // (CollectionEditor.tsx:55-57,114-116 hardcodes {value,label,unit}
  // independently of `PANEL_SLOTS` — design.md D2 correction: its doc
  // comment claims derivation from `PANEL_SLOTS.metric` but does not
  // actually import it). Reuses Metric's slot set, which happens to equal
  // that hardcoded key set.
  val Collection: PanelBindingSpec = Metric.copy(panelType = PanelType.Collection)

  // timeline → {time, event}, both required — panelSlots.ts's
  // `PANEL_SLOTS.timeline`, live-wired via TimelineEditor.tsx:113.
  val Timeline: PanelBindingSpec = PanelBindingSpec(
    panelType         = PanelType.Timeline,
    requiredSlots     = Vector("time", "event"),
    optionalSlots     = Vector.empty,
    columnEligibility = Map("time" -> Orderable, "event" -> Any)
  )

  /** The five data-bindable panel kinds `PanelCapabilityService` reports on,
   *  in the fixed order the response is built from. */
  val DataBindable: Vector[PanelBindingSpec] = Vector(Metric, Chart, Table, Collection, Timeline)

  /** `bindable = false` reason emitted by [[evaluate]] when a required slot
   *  has no eligible column (mirrors `PanelCapabilityService`'s prior inline
   *  literal verbatim — HEL-364 task 1.2 extraction is behavior-preserving). */
  val MissingColumnsReason: String = "missing-required-column-type"

  /** Result of evaluating one [[PanelBindingSpec]] against a concrete column
   *  set — extracted (HEL-364 task 1.2) from `PanelCapabilityService.capabilityFor`
   *  so `BoundPanelService`'s pre-write validation gate and
   *  `PanelCapabilityService`'s introspection endpoint share exactly one
   *  implementation of "is this panel type satisfiable by these columns",
   *  rather than two. Carries no `isPipelineOutput`/reason-for-non-output
   *  concept — that check is orthogonal to column-type eligibility and stays
   *  with each call site (`PanelCapabilityService` has a real DataType to ask;
   *  `BoundPanelService`'s projected schema is, by construction, always a
   *  pipeline output). */
  final case class BindabilityResult(
      bindable: Boolean,
      eligibleColumns: Map[String, Vector[String]],
      reason: Option[String],
      message: Option[String]
  )

  /** Evaluate `spec` against `columns` (name + wire-string type, e.g. the
   *  `SchemaField`s `PipelineAnalyzeService.analyze` projects, or a DataType's
   *  own fields). `bindable = true` iff every required slot has at least one
   *  eligible column — `table` (no required slots) is vacuously bindable. */
  def evaluate(spec: PanelBindingSpec, columns: Vector[SchemaField]): BindabilityResult = {
    val eligible = spec.allSlots.map(slot => slot -> eligibleColumnNames(spec, slot, columns)).toMap
    val requiredSatisfied = spec.requiredSlots.forall(slot => eligible.getOrElse(slot, Vector.empty).nonEmpty)
    if (requiredSatisfied)
      BindabilityResult(bindable = true, eligibleColumns = eligible, reason = None, message = None)
    else
      BindabilityResult(
        bindable        = false,
        eligibleColumns = eligible,
        reason          = Some(MissingColumnsReason),
        message         = Some(s"No column satisfies a required slot for '${PanelType.asString(spec.panelType)}'")
      )
  }

  private def eligibleColumnNames(spec: PanelBindingSpec, slotKey: String, columns: Vector[SchemaField]): Vector[String] = {
    val eligibility = spec.eligibilityOf(slotKey)
    columns.filter(c => DataFieldType.fromString(c.`type`).exists(t => SlotEligibility.accepts(eligibility, t))).map(_.name)
  }
}
