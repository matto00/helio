package com.helio.api.routes

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

/** Unit coverage for the four `Either`-returning helpers underpinning
 *  `DashboardSnapshotRoutes.validateSnapshotPayload`. The integration tests round-trip
 *  these paths through HTTP; this spec confirms each failure case directly so the
 *  `for`-comprehension chain didn't silently drop a case during refactoring. */
final class DashboardSnapshotValidationSpec extends AnyWordSpec with Matchers {

  private val emptyLayout = DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
  private val emptyAppearance = DashboardAppearancePayload(None, None)
  private val emptyDashboard  = DashboardSnapshotDashboardEntry("My Dashboard", emptyAppearance, emptyLayout)

  private def panel(snapshotId: String, panelType: String = "metric"): DashboardSnapshotPanelEntry =
    DashboardSnapshotPanelEntry(
      snapshotId = snapshotId,
      title      = "Title",
      `type`     = panelType,
      appearance = PanelAppearancePayload(None, None, None, None),
      typeId     = None,
      fieldMapping = None,
      content    = None
    )

  "DashboardSnapshotRoutes.validateSnapshotPayload" should {

    "reject version < 1" in {
      val payload = DashboardSnapshotPayload(version = 0, dashboard = emptyDashboard, panels = Vector.empty)
      val result  = DashboardSnapshotRoutes.validateSnapshotPayload(payload)
      result shouldBe Left("version must be >= 1, got 0")
    }

    "reject a blank dashboard name" in {
      val payload = DashboardSnapshotPayload(
        version   = 1,
        dashboard = emptyDashboard.copy(name = "   "),
        panels    = Vector.empty
      )
      val result = DashboardSnapshotRoutes.validateSnapshotPayload(payload)
      result shouldBe Left("dashboard.name must not be blank")
    }

    "reject an unknown panel type" in {
      val payload = DashboardSnapshotPayload(
        version   = 1,
        dashboard = emptyDashboard,
        panels    = Vector(panel("p1", panelType = "not-a-real-type"))
      )
      val result = DashboardSnapshotRoutes.validateSnapshotPayload(payload)
      result.left.toOption.exists(_.toLowerCase.contains("type")) shouldBe true
    }

    "reject a layout that references an unknown snapshotId" in {
      val danglingItem = DashboardLayoutItemPayload(panelId = "ghost-panel", x = 0, y = 0, w = 1, h = 1)
      val layout       = emptyLayout.copy(lg = Vector(danglingItem))
      val payload      = DashboardSnapshotPayload(
        version   = 1,
        dashboard = emptyDashboard.copy(layout = layout),
        panels    = Vector(panel("p1"))
      )
      val result = DashboardSnapshotRoutes.validateSnapshotPayload(payload)
      result shouldBe Left("layout references unknown snapshotId: 'ghost-panel'")
    }

    "accept a well-formed payload" in {
      val item    = DashboardLayoutItemPayload(panelId = "p1", x = 0, y = 0, w = 1, h = 1)
      val layout  = emptyLayout.copy(lg = Vector(item))
      val payload = DashboardSnapshotPayload(
        version   = 1,
        dashboard = emptyDashboard.copy(layout = layout),
        panels    = Vector(panel("p1"))
      )
      DashboardSnapshotRoutes.validateSnapshotPayload(payload) shouldBe Right(())
    }
  }
}
