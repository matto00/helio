package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** Route-level coverage for `POST /api/dashboards` with the HEL-363 opt-in
 *  `ifExists: "return"` get-or-create field, plus the D3 regression guard
 *  that plain create / duplicate / rename stay byte-for-byte unchanged.
 *  Shares the fixture (real RLS, seeded users) via `ApplyProposalSpecBase`. */
class DashboardGetOrCreateSpec extends ApplyProposalSpecBase {

  private def create(body: String) =
    Post("/api/dashboards", json(body)).addHeader(sessionCookie).addHeader(csrfHeader)

  private def idOf(response: String): String =
    response.parseJson.asJsObject.fields("id").convertTo[String]

  "POST /api/dashboards with ifExists" should {

    "create on the first call when no same-owner match exists (201)" in {
      create("""{"name":"AI News","ifExists":"return"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "return the SAME dashboard id (200, not 201) on a repeated sequential call — no duplicate created" in {
      val before = dashboardCount()
      val firstId = create("""{"name":"Repeated Rebuild","ifExists":"return"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        idOf(responseAs[String])
      }
      dashboardCount() shouldBe (before + 1)

      create("""{"name":"Repeated Rebuild","ifExists":"return"}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        idOf(responseAs[String]) shouldBe firstId
      }
      // Still exactly one — no duplicate was created.
      dashboardCount() shouldBe (before + 1)
    }

    "match case-insensitively and after trimming" in {
      val firstId = create("""{"name":"Case Test","ifExists":"return"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        idOf(responseAs[String])
      }
      create("""{"name":"  case test  ","ifExists":"return"}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        idOf(responseAs[String]) shouldBe firstId
      }
    }

    "be owner-scoped — another owner's same-named dashboard is never returned" in {
      seedDashboardForOwner("Shared Name", otherId)

      // The calling owner (userId) has no dashboard named "Shared Name" yet —
      // must create its own, never return the other owner's row.
      create("""{"name":"Shared Name","ifExists":"return"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "leave plain create (no ifExists) unaffected — always creates, even with an existing same-name match" in {
      val before = dashboardCount()
      create("""{"name":"Plain Create Dup"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      create("""{"name":"Plain Create Dup"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      dashboardCount() shouldBe (before + 2)
    }

    "leave duplicate unaffected — same-owner name collision with the copy is still allowed" in {
      val before = dashboardCount()
      val id = create("""{"name":"Dup Source"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        idOf(responseAs[String])
      }
      Post(s"/api/dashboards/$id/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      Post(s"/api/dashboards/$id/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      // Source + two "(copy)" dashboards, both named identically — no collision check.
      dashboardCount() shouldBe (before + 3)
    }

    "leave rename unaffected — PATCH name to collide with an existing dashboard is still allowed" in {
      create("""{"name":"Rename Target A"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      val bId = create("""{"name":"Rename Target B"}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        idOf(responseAs[String])
      }
      Patch(s"/api/dashboards/$bId", json("""{"name":"Rename Target A"}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }
}
