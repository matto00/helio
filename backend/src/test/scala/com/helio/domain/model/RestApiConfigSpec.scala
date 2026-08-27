package com.helio.domain.model

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-826 task 1.3 — unit coverage for the two request-issuing safety-guard helpers.
 *  Both are called ONLY at the two request-issuing choke points (`buildResolvedRequest`,
 *  `buildEphemeralRequest`) — see design.md Decision 3's decode-is-total invariant; this
 *  spec exercises the helpers directly, independent of any HTTP plumbing. */
class RestApiConfigSpec extends AnyWordSpec with Matchers {

  "RestApiConfig.rejectBodyOnSafeMethod" should {
    "reject a body on GET" in {
      RestApiConfig.rejectBodyOnSafeMethod("GET", Some("""{"a":1}""")).isLeft shouldBe true
    }

    "reject a body on HEAD" in {
      RestApiConfig.rejectBodyOnSafeMethod("HEAD", Some("""{"a":1}""")).isLeft shouldBe true
    }

    "reject a body on a lowercase 'get' (case-insensitive method match)" in {
      RestApiConfig.rejectBodyOnSafeMethod("get", Some("""{"a":1}""")).isLeft shouldBe true
    }

    "accept a body on POST" in {
      RestApiConfig.rejectBodyOnSafeMethod("POST", Some("""{"a":1}""")) shouldBe Right(())
    }

    "accept a body on PUT" in {
      RestApiConfig.rejectBodyOnSafeMethod("PUT", Some("""{"a":1}""")) shouldBe Right(())
    }

    "accept GET with no body" in {
      RestApiConfig.rejectBodyOnSafeMethod("GET", None) shouldBe Right(())
    }
  }

  "RestApiConfig.parseBodyContentType" should {
    "default to application/json when unset" in {
      val Right(ct) = RestApiConfig.parseBodyContentType(None): @unchecked
      ct.mediaType.toString shouldBe "application/json"
    }

    "parse a valid explicit content type" in {
      val Right(ct) = RestApiConfig.parseBodyContentType(Some("text/plain")): @unchecked
      ct.mediaType.toString shouldBe "text/plain"
    }

    "reject an unparseable content-type string" in {
      RestApiConfig.parseBodyContentType(Some("not a content type;;;")).isLeft shouldBe true
    }
  }
}
