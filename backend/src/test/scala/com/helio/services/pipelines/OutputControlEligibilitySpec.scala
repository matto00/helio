package com.helio.services.pipelines

import com.helio.domain.model.DataFieldType
import com.helio.domain.panels.OutputControlSpec
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1189 tasks.md 4.1 — pure-function coverage for `OutputControlEligibility.kindsFor`
 *  (design.md D3), covering every kind's operator/type boundary and the AC's "two Outputs, same
 *  column type, different filterability" scenario. */
class OutputControlEligibilitySpec extends AnyWordSpec with Matchers {
  import OutputFilterCapability.Operator._

  "OutputControlEligibility.kindsFor" should {
    "offers text iff Contains is present, regardless of type" in {
      OutputControlEligibility.kindsFor("c", Set(Contains), DataFieldType.StringType) should contain("text")
      OutputControlEligibility.kindsFor("c", Set(), DataFieldType.StringType) should not contain "text"
    }

    "offers dropdown iff both Eq and In are present, for any type" in {
      OutputControlEligibility.kindsFor("c", Set(Eq, In), DataFieldType.StringType) should contain("dropdown")
      OutputControlEligibility.kindsFor("c", Set(Eq, In), DataFieldType.IntegerType) should contain("dropdown")
      OutputControlEligibility.kindsFor("c", Set(Eq), DataFieldType.StringType) should not contain "dropdown"
      OutputControlEligibility.kindsFor("c", Set(In), DataFieldType.StringType) should not contain "dropdown"
    }

    "offers numeric-range iff Gte+Lte present AND type is integer or float, never for other types" in {
      OutputControlEligibility.kindsFor("c", Set(Gte, Lte), DataFieldType.IntegerType) should contain("numeric-range")
      OutputControlEligibility.kindsFor("c", Set(Gte, Lte), DataFieldType.FloatType) should contain("numeric-range")
      OutputControlEligibility.kindsFor("c", Set(Gte, Lte), DataFieldType.TimestampType) should not contain "numeric-range"
      OutputControlEligibility.kindsFor("c", Set(Gte), DataFieldType.IntegerType) should not contain "numeric-range"
    }

    "offers date-range iff Gte+Lte present AND type is timestamp, never for other types" in {
      OutputControlEligibility.kindsFor("c", Set(Gte, Lte), DataFieldType.TimestampType) should contain("date-range")
      OutputControlEligibility.kindsFor("c", Set(Gte, Lte), DataFieldType.IntegerType) should not contain "date-range"
      OutputControlEligibility.kindsFor("c", Set(Lte), DataFieldType.TimestampType) should not contain "date-range"
    }

    "offers nothing for an empty operator set" in {
      OutputControlEligibility.kindsFor("c", Set(), DataFieldType.StringType) shouldBe empty
    }

    "a timestamp column with contains+gte+lte offers both text and date-range, never numeric-range" in {
      val kinds = OutputControlEligibility.kindsFor("occurred_at", Set(Contains, Gte, Lte), DataFieldType.TimestampType)
      kinds should contain("text")
      kinds should contain("date-range")
      kinds should not contain "numeric-range"
    }

    // AC: "Test two Outputs with the same column types but different filterability."
    "two Outputs with an identically-typed string column report different offered kinds when cardinality differs" in {
      // Output A: region column is low-cardinality (eq/in-eligible, as OutputFilterCapability.buildContract would resolve it).
      val outputA = OutputControlEligibility.kindsFor("region", Set(Contains, Eq, In), DataFieldType.StringType)
      // Output B: same declared type, high cardinality -- no eq/in.
      val outputB = OutputControlEligibility.kindsFor("region", Set(Contains), DataFieldType.StringType)

      outputA should contain("dropdown")
      outputB should not contain "dropdown"
      // Both still offer text -- only dropdown eligibility diverges with cardinality.
      outputA should contain("text")
      outputB should contain("text")
    }
  }

  "OutputControlEligibility.ValidKinds" should {
    "matches OutputControlSpec.ValidKinds (domain/panels mirror)" in {
      OutputControlEligibility.ValidKinds shouldBe OutputControlSpec.ValidKinds
    }
  }
}
