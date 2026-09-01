package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-906 cycle 5 (coordinator ruling, AC-3 "real structural guard"): proves `SchemaField`'s
 *  constructor is the one choke point every construction site passes through -- a garbage
 *  (non-canonical) `type` string throws immediately, no matter which of the 31+ call sites in
 *  `backend/src/main/scala/` tried to build it. If a future refactor removes the `require` from
 *  `SchemaField`'s primary constructor, THIS test fails, not just a code review. */
class SchemaFieldStructuralGuardSpec extends AnyWordSpec with Matchers {

  "SchemaField's constructor" should {
    "accept every canonical DataFieldType wire value" in {
      Vector("string", "integer", "float", "boolean", "timestamp", "string-body", "binary-ref").foreach { canonical =>
        noException should be thrownBy SchemaField("f", canonical)
      }
    }

    "throw for a non-canonical synonym that was never canonicalized (\"number\")" in {
      an[IllegalArgumentException] should be thrownBy SchemaField("amount", "number")
    }

    "throw for a genuinely unrecognized type (\"banana\") -- the exact `canonicalizeLegacy`" +
      " passthrough gap this guard closes" in {
      an[IllegalArgumentException] should be thrownBy SchemaField("x", "banana")
    }

    "throw for an empty type string" in {
      an[IllegalArgumentException] should be thrownBy SchemaField("x", "")
    }

    "name every valid type in the exception message" in {
      val ex = the[IllegalArgumentException] thrownBy SchemaField("x", "banana")
      ex.getMessage should include("string")
      ex.getMessage should include("integer")
      ex.getMessage should include("float")
      ex.getMessage should include("boolean")
      ex.getMessage should include("timestamp")
      ex.getMessage should include("string-body")
      ex.getMessage should include("binary-ref")
    }
  }
}
