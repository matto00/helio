package com.helio.domain.panels

import com.helio.domain.model.{DataFieldType, PanelType}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Cross-checks `PanelBindingSpec`'s slot definitions against the frontend's
 *  documented slot contract (design.md D2, task 5.6) — literal Scala
 *  constants transcribed at write time (a snapshot, not a live TS parser),
 *  each commented with the frontend file:line it mirrors. A future edit to
 *  either side without updating the other fails this spec. */
class PanelBindingSpecSpec extends AnyWordSpec with Matchers {

  // frontend/src/features/panels/state/panelSlots.ts `PANEL_SLOTS.chart`,
  // live-wired via FieldMappingSlots (BindingEditor.tsx:331). Omits
  // `annotation` on purpose — that reserved slot is merged in separately
  // outside the generic slot loop (BindingEditor.tsx:245-259,
  // schemas/panels/panel.schema.json:95, helio-mcp/src/tools/write.ts:439-440).
  private val PanelSlotsTsChartSlots: Set[String] = Set("xAxis", "yAxis", "series")

  // frontend/src/features/panels/state/panelSlots.ts `PANEL_SLOTS.timeline`,
  // live-wired via TimelineEditor.tsx:113. Both required.
  private val PanelSlotsTsTimelineSlots: Set[String] = Set("time", "event")

  // frontend/src/features/panels/ui/editors/CollectionEditor.tsx:55-57,114-116
  // hardcodes these three keys independently of `PANEL_SLOTS` (its own
  // line-35 doc comment claims derivation from `PANEL_SLOTS.metric`, but the
  // component never actually imports `PANEL_SLOTS` — design.md D2
  // correction). This is the real cross-check target for `collection`.
  private val CollectionEditorTsxItemKeys: Set[String] = Set("value", "label", "unit")

  "PanelBindingSpec.Chart" should {
    "match panelSlots.ts's PANEL_SLOTS.chart once the separately-merged `annotation` slot is excluded" in {
      val allSlots = (PanelBindingSpec.Chart.requiredSlots ++ PanelBindingSpec.Chart.optionalSlots).toSet
      (allSlots - "annotation") shouldBe PanelSlotsTsChartSlots
    }

    "still declare `annotation` as a real (optional) slot" in {
      PanelBindingSpec.Chart.optionalSlots should contain("annotation")
    }
  }

  "PanelBindingSpec.Timeline" should {
    "match panelSlots.ts's PANEL_SLOTS.timeline exactly, both required" in {
      PanelBindingSpec.Timeline.requiredSlots.toSet shouldBe PanelSlotsTsTimelineSlots
      PanelBindingSpec.Timeline.optionalSlots shouldBe empty
    }
  }

  "PanelBindingSpec.Collection" should {
    "match PanelBindingSpec.Metric's required/optional slot sets" in {
      PanelBindingSpec.Collection.requiredSlots shouldBe PanelBindingSpec.Metric.requiredSlots
      PanelBindingSpec.Collection.optionalSlots shouldBe PanelBindingSpec.Metric.optionalSlots
    }

    "match CollectionEditor.tsx's hardcoded item-field keys (not PANEL_SLOTS-wired, design.md D2)" in {
      val allSlots = (PanelBindingSpec.Collection.requiredSlots ++ PanelBindingSpec.Collection.optionalSlots).toSet
      allSlots shouldBe CollectionEditorTsxItemKeys
    }

    "match PanelBindingSpec.Metric's slot set too (the two independent hardcodings agree)" in {
      val collectionSlots = (PanelBindingSpec.Collection.requiredSlots ++ PanelBindingSpec.Collection.optionalSlots).toSet
      val metricSlots      = (PanelBindingSpec.Metric.requiredSlots ++ PanelBindingSpec.Metric.optionalSlots).toSet
      collectionSlots shouldBe metricSlots
    }
  }

  "PanelBindingSpec.Table" should {
    "have no slots (bind_panel: table needs no fieldMapping)" in {
      PanelBindingSpec.Table.requiredSlots shouldBe empty
      PanelBindingSpec.Table.optionalSlots shouldBe empty
    }
  }

  "PanelBindingSpec.DataBindable" should {
    "cover exactly the five data-bindable panel kinds, in a fixed order" in {
      PanelBindingSpec.DataBindable.map(_.panelType) shouldBe Vector(
        PanelType.Metric,
        PanelType.Chart,
        PanelType.Table,
        PanelType.Collection,
        PanelType.Timeline
      )
    }
  }

  "SlotEligibility.accepts" should {
    "accept only integer/float for Numeric" in {
      SlotEligibility.accepts(SlotEligibility.Numeric, DataFieldType.IntegerType) shouldBe true
      SlotEligibility.accepts(SlotEligibility.Numeric, DataFieldType.FloatType) shouldBe true
      SlotEligibility.accepts(SlotEligibility.Numeric, DataFieldType.StringType) shouldBe false
      SlotEligibility.accepts(SlotEligibility.Numeric, DataFieldType.TimestampType) shouldBe false
    }

    "accept timestamp/integer/float for Orderable" in {
      SlotEligibility.accepts(SlotEligibility.Orderable, DataFieldType.TimestampType) shouldBe true
      SlotEligibility.accepts(SlotEligibility.Orderable, DataFieldType.IntegerType) shouldBe true
      SlotEligibility.accepts(SlotEligibility.Orderable, DataFieldType.FloatType) shouldBe true
      SlotEligibility.accepts(SlotEligibility.Orderable, DataFieldType.StringType) shouldBe false
    }

    "accept every column type for Any" in {
      SlotEligibility.accepts(SlotEligibility.Any, DataFieldType.StringType) shouldBe true
      SlotEligibility.accepts(SlotEligibility.Any, DataFieldType.BooleanType) shouldBe true
    }
  }
}
