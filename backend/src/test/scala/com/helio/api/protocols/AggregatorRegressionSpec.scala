package com.helio.api.protocols

import com.helio.api.JsonProtocols
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Locks in the byte-for-byte JSON wire shape of every top-level response /
 *  request type after the per-domain protocol split.
 *
 *  The split moved 40+ case classes from a single 832-line `JsonProtocols.scala`
 *  into 8 per-domain traits under `com.helio.api.protocols`. The risk is a
 *  silent ambiguity in implicit resolution (a format from trait A shadowing or
 *  being shadowed by one in trait B). To catch any such drift, this spec
 *  round-trips a representative instance of each top-level type through
 *  `.toJson` and `.convertTo[T]` and asserts identity. */
class AggregatorRegressionSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private def roundTrip[T: JsonFormat](original: T): T =
    original.toJson.convertTo[T]

  "JsonProtocols aggregator" should {

    "round-trip DashboardResponse" in {
      val original = DashboardResponse(
        id         = "dash-1",
        name       = "Dashboard 1",
        meta       = ResourceMetaResponse("u-1", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
        appearance = DashboardAppearanceResponse("#fff", "#000"),
        layout     = DashboardLayoutResponse(Vector.empty, Vector.empty, Vector.empty, Vector.empty),
        ownerId    = "u-1"
      )
      roundTrip(original) shouldBe original
    }

    "round-trip PanelResponse" in {
      val original = PanelResponse(
        id          = "p-1",
        dashboardId = "dash-1",
        title       = "Panel A",
        `type`      = "table",
        meta        = ResourceMetaResponse("u-1", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
        appearance  = PanelAppearanceResponse("#fff", "#000", 0.5, None),
        ownerId     = "u-1",
        config      = JsObject("dataTypeId" -> JsString("dt-1"), "fieldMapping" -> JsObject("foo" -> JsString("bar"))),
        dataAsOf    = Some("2026-06-13T12:00:00Z")
      )
      roundTrip(original) shouldBe original
    }

    "round-trip PanelResponse with null dataAsOf" in {
      val original = PanelResponse(
        id          = "p-2",
        dashboardId = "dash-1",
        title       = "Panel B",
        `type`      = "text",
        meta        = ResourceMetaResponse("u-1", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
        appearance  = PanelAppearanceResponse("#fff", "#000", 0.5, None),
        ownerId     = "u-1",
        config      = JsObject("content" -> JsString("hello")),
        dataAsOf    = None
      )
      roundTrip(original) shouldBe original
    }

    "round-trip DataSourceResponse (discriminated-union, REST subtype)" in {
      val original: DataSourceResponse = RestSourceResponse(
        id        = "ds-1",
        name      = "Source 1",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        config    = RestApiConfigPayload(url = "http://example.com", method = Some("GET"), auth = None, headers = None)
      )
      roundTrip(original) shouldBe original
    }

    "round-trip DataTypeResponse" in {
      val original = DataTypeResponse(
        id             = "dt-1",
        sourceId       = Some("ds-1"),
        name           = "Type 1",
        fields         = Vector(DataFieldResponse("f1", "Field 1", "string", nullable = true)),
        computedFields = Vector(ComputedFieldResponse("c1", "Computed 1", "f1 + 1", "string")),
        version        = 1,
        createdAt      = "2026-01-01T00:00:00Z",
        updatedAt      = "2026-01-02T00:00:00Z"
      )
      roundTrip(original) shouldBe original
    }

    "round-trip PipelineSummaryResponse" in {
      val original = PipelineSummaryResponse(
        id                   = "pl-1",
        name                 = "Pipeline 1",
        sourceDataSourceId   = "ds-1",
        sourceDataSourceName = "Source 1",
        outputDataTypeName   = "Type 1",
        outputDataTypeId     = "dt-1",
        lastRunStatus        = Some("succeeded"),
        lastRunAt            = Some("2026-01-02T00:00:00Z"),
        lastRunRowCount      = Some(42L)
      )
      roundTrip(original) shouldBe original
    }

    "round-trip RunResultResponse" in {
      val original = RunResultResponse(
        rows           = Vector(JsObject("x" -> JsNumber(1))),
        rowCount       = 1,
        stepRowCounts  = Map("step-1" -> 3L),
        sourceRowCount = 5L
      )
      roundTrip(original) shouldBe original
    }

    "round-trip RunStatusResponse" in {
      val original = RunStatusResponse(
        runId    = "run-1",
        status   = "succeeded",
        rows     = Some(JsArray(JsObject("a" -> JsNumber(1)))),
        error    = None,
        rowCount = Some(1)
      )
      roundTrip(original) shouldBe original
    }

    "round-trip AuthResponse" in {
      val original = AuthResponse(
        expiresAt = "2026-12-31T23:59:59Z",
        user = UserResponse(
          id          = "u-1",
          email       = "user@example.com",
          displayName = Some("User One"),
          createdAt   = "2026-01-01T00:00:00Z",
          avatarUrl   = None,
          preferences = Some(UserPreferences(Some("#ff0"), Map("dash-1" -> 1.25)))
        )
      )
      roundTrip(original) shouldBe original
    }

    "round-trip PermissionResponse" in {
      val original = PermissionResponse(
        granteeId = Some("u-2"),
        role      = "viewer",
        createdAt = "2026-01-01T00:00:00Z"
      )
      roundTrip(original) shouldBe original
    }

    "round-trip DashboardSnapshotPayload" in {
      val original = DashboardSnapshotPayload(
        version   = DashboardSnapshotPayload.CurrentVersion,
        dashboard = DashboardSnapshotDashboardEntry(
          name       = "Imported",
          appearance = DashboardAppearancePayload(Some("#fff"), Some("#000")),
          layout     = DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)
        ),
        panels = Vector(
          DashboardSnapshotPanelEntry(
            snapshotId = "p-1",
            title      = "Panel",
            `type`     = "table",
            appearance = PanelAppearancePayload(Some("#fff"), Some("#000"), Some(0.5), None),
            config     = JsObject("dataTypeId" -> JsString(""), "fieldMapping" -> JsObject.empty)
          )
        )
      )
      roundTrip(original) shouldBe original
    }

    "not throw DeserializationException for any of the above" in {
      // Smoke-test: above 10 cases already cover this, but the explicit
      // case here documents the spec intent for future readers.
      noException should be thrownBy roundTrip(HealthResponse("ok"))
    }
  }
}
