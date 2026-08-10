package com.helio.api.protocols

import com.helio.api.JsonProtocols
import com.helio.domain.{DataTypeId, MetricDefinition, MetricFormat, MetricId, UserId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant

/** JSON round-trip tests for the metric wire types (HEL-446 tasks.md 5.5). */
class MetricProtocolSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private val now = Instant.parse("2026-05-14T00:00:00Z")

  "MetricFormat" should {

    "round-trip with all fields present" in {
      val fmt = MetricFormat(unit = Some("USD"), decimals = Some(2), prefix = Some("$"), suffix = Some("/mo"))
      fmt.toJson.convertTo[MetricFormat] shouldBe fmt
    }

    "round-trip with all fields absent" in {
      val fmt = MetricFormat(unit = None, decimals = None, prefix = None, suffix = None)
      fmt.toJson.convertTo[MetricFormat] shouldBe fmt
    }
  }

  "MetricResponse.fromDomain" should {

    "round-trip through JSON" in {
      val domain = MetricDefinition(
        id                = MetricId("metric-1"),
        ownerId           = UserId("00000000-0000-0000-0000-000000000001"),
        dataTypeId        = DataTypeId("dt-1"),
        name              = "Total Revenue",
        description       = Some("Sum of revenue field"),
        measureField      = "revenue",
        aggregation       = "sum",
        allowedDimensions = Vector("region", "product"),
        format            = MetricFormat(Some("USD"), Some(2), Some("$"), None),
        deprecated        = false,
        createdAt         = now,
        updatedAt         = now
      )
      val response = MetricResponse.fromDomain(domain)
      response.toJson.convertTo[MetricResponse] shouldBe response

      response.id                shouldBe "metric-1"
      response.ownerId           shouldBe "00000000-0000-0000-0000-000000000001"
      response.dataTypeId        shouldBe "dt-1"
      response.aggregation       shouldBe "sum"
      response.allowedDimensions shouldBe Vector("region", "product")
      response.format            shouldBe MetricFormat(Some("USD"), Some(2), Some("$"), None)
      response.createdAt         shouldBe now.toString
    }
  }
}
