package com.helio.domain.panels

import com.helio.domain.{DataFieldType, PanelType}

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
}
