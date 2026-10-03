package com.helio.testsupport

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1216: the guard itself must be failable -- a hand-built body carrying the id under an arbitrary
 *  key name, in an array, nested, as a key, or embedded in a longer string must be flagged. */
class OwnerIdGuardSpec extends AnyWordSpec with Matchers {
  private val id = "0badc0de-1216-4abc-8def-0123456789ab"

  "OwnerIdGuard.leaks" should {
    "flag the id under an arbitrary key name" in {
      OwnerIdGuard.leaks(s"""{"totallyUnrelatedName":"$id"}""".parseJson, id) should have size 1
    }
    "flag the id nested in arrays and objects, with its path" in {
      val found = OwnerIdGuard.leaks(s"""{"a":[{"b":{"c":["x","$id"]}}]}""".parseJson, id)
      found should have size 1
      found.head should include("$.a[0].b.c[1]")
    }
    "flag the id embedded in a longer string (contains-match, not equality)" in {
      OwnerIdGuard.leaks(s"""{"url":"https://x/u/$id/avatar"}""".parseJson, id) should have size 1
    }
    "flag the id used as an object KEY" in {
      OwnerIdGuard.leaks(s"""{"$id":1}""".parseJson, id) should have size 1
    }
    "pass a clean body and a body with a different id" in {
      OwnerIdGuard.leaks("""{"a":[1,true,null,"x"],"b":{"c":"d"}}""".parseJson, id) shouldBe empty
    }
    "assertNoOwnerId throws on a leak and on a non-JSON body containing the id" in {
      an[AssertionError] should be thrownBy OwnerIdGuard.assertNoOwnerId(s"""{"k":"$id"}""", id, "ctx")
      an[AssertionError] should be thrownBy OwnerIdGuard.assertNoOwnerId(s"plain $id text", id, "ctx")
      noException should be thrownBy OwnerIdGuard.assertNoOwnerId("""{"k":"v"}""", id, "ctx")
    }
  }
}
