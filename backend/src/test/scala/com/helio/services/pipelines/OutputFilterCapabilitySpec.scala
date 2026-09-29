package com.helio.services.pipelines

import com.helio.domain.model.DataFieldType
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1188 task 1.1 — pure-function coverage for `OutputFilterCapability`'s TYPE-based gate
 *  (design.md D2 point 1) and its `Operator` wire mapping. The cardinality-based gate (D2 point 2)
 *  and `buildContract`/`eqInEligibleColumn` need `node_snapshots` data and are covered against a
 *  real EmbeddedPostgres instance in `OutputRoutesSpec` instead (this file's own fixture would be
 *  a second, redundant DB harness for the same coverage). */
class OutputFilterCapabilitySpec extends AnyWordSpec with Matchers {
  import OutputFilterCapability.Operator._

  "OutputFilterCapability.staticOperatorsFor (task 1.1)" should {
    "reports contains only for string and boolean columns (range is meaningless on either)" in {
      OutputFilterCapability.staticOperatorsFor(DataFieldType.StringType) shouldBe Set(Contains)
      OutputFilterCapability.staticOperatorsFor(DataFieldType.BooleanType) shouldBe Set(Contains)
    }

    "reports contains+gte+lte for integer/float/timestamp columns" in {
      OutputFilterCapability.staticOperatorsFor(DataFieldType.IntegerType) shouldBe Set(Contains, Gte, Lte)
      OutputFilterCapability.staticOperatorsFor(DataFieldType.FloatType) shouldBe Set(Contains, Gte, Lte)
      OutputFilterCapability.staticOperatorsFor(DataFieldType.TimestampType) shouldBe Set(Contains, Gte, Lte)
    }

    "reports no operators at all for Content-category columns" in {
      OutputFilterCapability.staticOperatorsFor(DataFieldType.StringBodyType) shouldBe Set.empty
      OutputFilterCapability.staticOperatorsFor(DataFieldType.BinaryRefType) shouldBe Set.empty
    }
  }

  "OutputFilterCapability.cardinalityEligible" should {
    "is true at and below the cap, false above it" in {
      OutputFilterCapability.cardinalityEligible(OutputFilterCapability.MaxDropdownCardinality) shouldBe true
      OutputFilterCapability.cardinalityEligible(OutputFilterCapability.MaxDropdownCardinality + 1) shouldBe false
    }
  }

  "OutputFilterCapability.Operator" should {
    "round-trips every operator through asString/fromString" in {
      Vector(Contains, Eq, In, Gte, Lte).foreach { op =>
        OutputFilterCapability.Operator.fromString(OutputFilterCapability.Operator.asString(op)) shouldBe Some(op)
      }
      OutputFilterCapability.Operator.fromString("bogus") shouldBe None
    }

    "orders a Set's wire strings deterministically, regardless of the Set's own construction order" in {
      OutputFilterCapability.Operator.orderedWireStrings(Set(In, Contains, Eq)) shouldBe Vector("contains", "eq", "in")
      OutputFilterCapability.Operator.orderedWireStrings(Set(Eq, Contains, In)) shouldBe Vector("contains", "eq", "in")
      OutputFilterCapability.Operator.orderedWireStrings(Set(Lte, Gte, Contains)) shouldBe Vector("contains", "gte", "lte")
    }
  }
}
