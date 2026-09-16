package com.helio.api.protocols.pipelines

import com.helio.api.JsonProtocols
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1136 task 2.2 — the wire-shape contract that matters most here: an ungrouped entry's
 *  `group` field is ABSENT from the JSON object, never present-and-null (design.md Decision 4,
 *  ticket.md owner ruling 2, C5). A test asserting `group: null` would pass against a serializer
 *  that never actually satisfies the real contract -- this test inspects the raw `JsObject` keys,
 *  not just the round-tripped case class, which can't distinguish "absent" from "null". */
class PipelineStepCatalogProtocolSpec extends AnyWordSpec with Matchers with JsonProtocols {

  "PipelineStepCatalogEntryResponse" should {

    "omit the group key entirely when group is None (not null)" in {
      val entry = PipelineStepCatalogEntryResponse(
        kind        = "assert",
        label       = "Assert / validate",
        description = "Validate rows against rules and flag or fail ones that don't match.",
        group       = None,
        authorable  = true
      )
      val json = entry.toJson.asJsObject
      json.fields.keySet should not contain "group"
    }

    "include the group key with the group's id when group is Some" in {
      val entry = PipelineStepCatalogEntryResponse(
        kind        = "select",
        label       = "Select fields",
        description = "Keep only the selected columns, dropping the rest.",
        group       = Some("filter-shape"),
        authorable  = true
      )
      val json = entry.toJson.asJsObject
      json.fields("group") shouldBe JsString("filter-shape")
    }
  }

  "PipelineStepCatalogResponse" should {

    "convey groups and steps as JSON arrays, not objects (order-bearing per design.md Decision 3)" in {
      val response = PipelineStepCatalogResponse(
        groups = Vector(StepGroupResponse("filter-shape", "Filter & shape")),
        steps  = Vector.empty
      )
      val json = response.toJson.asJsObject
      json.fields("groups") shouldBe a[JsArray]
      json.fields("steps") shouldBe a[JsArray]
    }
  }
}
