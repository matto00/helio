package com.helio.services

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import com.helio.api.protocols.{
  DashboardAppearancePayload,
  DashboardLayoutItemPayload,
  DashboardLayoutPayload,
  DashboardSnapshotDashboardEntry,
  DashboardSnapshotPanelEntry,
  DashboardSnapshotPayload,
  PanelAppearancePayload
}
import com.helio.domain.ChartAppearance
import spray.json.{JsObject, JsString}

/** Unit coverage for the four `Either`-returning helpers underpinning
 *  `DashboardService.validateSnapshotPayload`. The integration tests round-trip
 *  these paths through HTTP; this spec confirms each failure case directly so the
 *  `for`-comprehension chain didn't silently drop a case during refactoring. */
final class DashboardSnapshotValidationSpec extends AnyWordSpec with Matchers {

  private val emptyLayout = DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
  private val emptyAppearance = DashboardAppearancePayload(None, None)
  private val emptyDashboard  = DashboardSnapshotDashboardEntry("My Dashboard", emptyAppearance, emptyLayout)
  private val currentVersion  = DashboardSnapshotPayload.CurrentVersion

  // HEL-368: `id` defaults to `None` here to double as coverage that a
  // pre-existing snapshot lacking `id` (an export captured before this field
  // existed) still validates identically to one that carries it.
  private def panel(snapshotId: String, panelType: String = "metric"): DashboardSnapshotPanelEntry =
    DashboardSnapshotPanelEntry(
      snapshotId = snapshotId,
      id         = None,
      title      = "Title",
      `type`     = panelType,
      appearance = PanelAppearancePayload(None, None, None, None),
      config     = JsObject.empty
    )

  private val aggregationJson: JsObject =
    JsObject("groupBy" -> JsString("category"), "agg" -> JsString("sum"), "yField" -> JsString("amount"))

  // HEL-624 task 5.8 — a chart entry combining `chartType: "scatter"` with a
  // present `aggregation` (5th enforcement site: `POST /api/dashboards/import`).
  private def chartPanel(
      snapshotId: String,
      chartType: String,
      aggregation: Option[JsObject]
  ): DashboardSnapshotPanelEntry =
    DashboardSnapshotPanelEntry(
      snapshotId = snapshotId,
      id         = None,
      title      = "Chart",
      `type`     = "chart",
      appearance = PanelAppearancePayload(None, None, None, Some(ChartAppearance.Default.copy(chartType = Some(chartType)))),
      config     = JsObject(
        Map("fieldMapping" -> JsObject.empty) ++ aggregation.map("aggregation" -> _)
      )
    )

  "DashboardService.validateSnapshotPayload" should {

    "reject a prior wire version" in {
      val payload = DashboardSnapshotPayload(version = 1, dashboard = emptyDashboard, panels = Vector.empty)
      val result  = DashboardService.validateSnapshotPayload(payload)
      result.left.toOption.exists(_.contains("no longer supported")) shouldBe true
    }

    "reject a blank dashboard name" in {
      val payload = DashboardSnapshotPayload(
        version   = currentVersion,
        dashboard = emptyDashboard.copy(name = "   "),
        panels    = Vector.empty
      )
      val result = DashboardService.validateSnapshotPayload(payload)
      result shouldBe Left("dashboard.name must not be blank")
    }

    "reject an unknown panel type" in {
      val payload = DashboardSnapshotPayload(
        version   = currentVersion,
        dashboard = emptyDashboard,
        panels    = Vector(panel("p1", panelType = "not-a-real-type"))
      )
      val result = DashboardService.validateSnapshotPayload(payload)
      result.left.toOption.exists(_.toLowerCase.contains("type")) shouldBe true
    }

    "reject a layout that references an unknown snapshotId" in {
      val danglingItem = DashboardLayoutItemPayload(panelId = "ghost-panel", x = 0, y = 0, w = 1, h = 1)
      val layout       = emptyLayout.copy(lg = Vector(danglingItem))
      val payload      = DashboardSnapshotPayload(
        version   = currentVersion,
        dashboard = emptyDashboard.copy(layout = layout),
        panels    = Vector(panel("p1"))
      )
      val result = DashboardService.validateSnapshotPayload(payload)
      result shouldBe Left("layout references unknown snapshotId: 'ghost-panel'")
    }

    "accept a well-formed payload" in {
      val item    = DashboardLayoutItemPayload(panelId = "p1", x = 0, y = 0, w = 1, h = 1)
      val layout  = emptyLayout.copy(lg = Vector(item))
      val payload = DashboardSnapshotPayload(
        version   = currentVersion,
        dashboard = emptyDashboard.copy(layout = layout),
        panels    = Vector(panel("p1"))
      )
      DashboardService.validateSnapshotPayload(payload) shouldBe Right(())
    }

    // HEL-624 task 5.8 — 5th enforcement site: POST /api/dashboards/import.
    "reject a scatter+aggregation chart entry (zero writes)" in {
      val payload = DashboardSnapshotPayload(
        version   = currentVersion,
        dashboard = emptyDashboard,
        panels    = Vector(chartPanel("p1", "scatter", Some(aggregationJson)))
      )
      val result = DashboardService.validateSnapshotPayload(payload)
      result.isLeft shouldBe true
      result.left.toOption.get should include("aggregation is not supported for scatter charts")
    }

    "accept a valid (non-conflicting) chart entry — scatter with no aggregation (no regression)" in {
      val payload = DashboardSnapshotPayload(
        version   = currentVersion,
        dashboard = emptyDashboard,
        panels    = Vector(chartPanel("p1", "scatter", None))
      )
      DashboardService.validateSnapshotPayload(payload) shouldBe Right(())
    }

    "accept a valid (non-conflicting) chart entry — bar with aggregation (no regression)" in {
      val payload = DashboardSnapshotPayload(
        version   = currentVersion,
        dashboard = emptyDashboard,
        panels    = Vector(chartPanel("p1", "bar", Some(aggregationJson)))
      )
      DashboardService.validateSnapshotPayload(payload) shouldBe Right(())
    }
  }
}
