package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant

class PanelBuildQuerySpec extends AnyWordSpec with Matchers {

  private val meta = ResourceMeta(
    createdBy   = "user-1",
    createdAt   = Instant.EPOCH,
    lastUpdated = Instant.EPOCH
  )

  private def panel(
      typeId: Option[DataTypeId],
      fieldMapping: Option[JsValue]
  ): Panel = Panel(
    id                  = PanelId("panel-1"),
    dashboardId         = DashboardId("dash-1"),
    title               = "Test",
    meta                = meta,
    appearance          = PanelAppearance.Default,
    panelType           = PanelType.Metric,
    ownerId             = UserId("user-1"),
    typeId              = typeId,
    fieldMapping        = fieldMapping
  )

  "Panel.buildQuery" should {

    "return a PanelQuery with selectedFields derived from fieldMapping values for a bound panel" in {
      val mapping = """{"value":"price","label":"name"}""".parseJson
      val result  = Panel.buildQuery(panel(Some(DataTypeId("dt-1")), Some(mapping)))
      result shouldBe defined
      result.get.selectedFields should contain theSameElementsAs List("price", "name")
      result.get.filters shouldBe Nil
      result.get.sort    shouldBe None
      result.get.limit   shouldBe None
    }

    "return None when typeId is None" in {
      val mapping = """{"value":"price"}""".parseJson
      Panel.buildQuery(panel(None, Some(mapping))) shouldBe None
    }

    "return a PanelQuery with empty selectedFields when fieldMapping is None" in {
      val result = Panel.buildQuery(panel(Some(DataTypeId("dt-1")), None))
      result shouldBe defined
      result.get.selectedFields shouldBe Nil
    }

    "return a PanelQuery with empty selectedFields when fieldMapping is a non-object (array)" in {
      val mapping = """["price","name"]""".parseJson
      val result  = Panel.buildQuery(panel(Some(DataTypeId("dt-1")), Some(mapping)))
      result shouldBe defined
      result.get.selectedFields shouldBe Nil
    }

    "return a PanelQuery with empty selectedFields when fieldMapping is a scalar" in {
      val mapping = JsString("not-an-object")
      val result  = Panel.buildQuery(panel(Some(DataTypeId("dt-1")), Some(mapping)))
      result shouldBe defined
      result.get.selectedFields shouldBe Nil
    }
  }
}
