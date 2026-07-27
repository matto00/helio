package com.helio.services

import com.helio.domain.DataField
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-373 tasks.md 5.2 — pure unit tests for
 *  `DataTypeService.overflowStructuredFieldNames` (design.md D1 round-1/
 *  round-3 fix). Purely a function of its two arguments — no DB fixture
 *  needed, mirroring `WorkspaceContextServiceSanitizeSampleRowsSpec`'s
 *  no-fixture pattern for `sanitizeSampleRows`. */
class DataTypeServiceOverflowStructuredFieldNamesSpec extends AnyWordSpec with Matchers {

  private def structuredField(name: String, dataType: String = "string"): DataField =
    DataField(name = name, displayName = name, dataType = dataType, nullable = false)

  "overflowStructuredFieldNames" should {

    "return an empty set when there are fewer fields than the limit" in {
      val fields = (0 until 3).map(i => structuredField(s"col$i")).toVector

      DataTypeService.overflowStructuredFieldNames(fields, limit = 40) shouldBe empty
    }

    "return an empty set when there are exactly as many fields as the limit" in {
      val fields = (0 until 40).map(i => structuredField(s"col$i")).toVector

      DataTypeService.overflowStructuredFieldNames(fields, limit = 40) shouldBe empty
    }

    "return the overflow field names, in declared order, beyond the limit" in {
      val fields = (0 until 45).map(i => structuredField(s"col$i")).toVector

      val overflow = DataTypeService.overflowStructuredFieldNames(fields, limit = 40)

      overflow shouldBe (40 until 45).map(i => s"col$i").toSet
      overflow should not contain "col39"
      overflow should not contain "col0"
    }

    "exclude a field whose dataType string does not parse from both the counted-toward-limit " +
      "set and the overflow set" in {
      val fields = (0 until 3).map(i => structuredField(s"col$i")).toVector :+
        structuredField("mystery", "not-a-real-type")

      // limit=3: the 3 real Structured fields exactly fill the limit; the
      // unparseable field is never counted toward it (so it doesn't push a
      // real field into overflow) and never appears in the overflow set
      // itself (conservatively excluded from the Structured category
      // entirely).
      val overflow = DataTypeService.overflowStructuredFieldNames(fields, limit = 3)

      overflow shouldBe empty
    }

    "exclude a Content-category field from both the counted-toward-limit set and the overflow set" in {
      val fields = (0 until 3).map(i => structuredField(s"col$i")).toVector :+
        structuredField("body", "string-body")

      val overflow = DataTypeService.overflowStructuredFieldNames(fields, limit = 3)

      overflow shouldBe empty
    }
  }
}
