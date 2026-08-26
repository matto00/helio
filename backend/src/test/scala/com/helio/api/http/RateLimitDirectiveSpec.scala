package com.helio.api.http

import com.helio.api._
import com.helio.domain.model.{ApiTokenId, AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, UserSessionRepository}
import com.helio.services.auth.ApiTokenService
import com.helio.services.ratelimit.InMemoryRateLimiter
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.{ExecutionContext, Future}

/** Route-testkit coverage for [[RateLimitDirective]] (HEL-495 tasks.md 3.3) — the ticket's actual
 *  verification bar: 429 status + Retry-After header + JSON ErrorResponse body, independent
 *  budgets across users/PATs, and the same key being throttled. Exercised directly against the
 *  directive with stub repositories, mirroring `AuthDirectivesSpec`'s style — no DB, no full
 *  `ApiRoutes`.
 *
 *  **Scope note:** IP-based keying for unauthenticated/invalid-credential requests was deferred to
 *  HEL-837 after repeated adversarial review found trusted-client-IP-behind-a-proxy extraction to
 *  be its own hard problem — see [[RateLimitDirective]]'s scaladoc. The tests below cover only the
 *  authenticated (session/PAT) keying path shipped here, plus the deliberate pass-through behavior
 *  for everything else. */
class RateLimitDirectiveSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols {

  private val sessionTokenA = "session-token-a"
  private val sessionTokenB = "session-token-b"
  private val userA         = AuthenticatedUser(UserId("user-a"))
  private val userB         = AuthenticatedUser(UserId("user-b"))

  private val patTokenA1 = "helio_pat_" + "1" * 64
  private val patTokenA2 = "helio_pat_" + "2" * 64
  private val tokenIdA1  = ApiTokenId("token-a1")
  private val tokenIdA2  = ApiTokenId("token-a2")

  private def stubSessionRepo(valid: Map[String, AuthenticatedUser]): UserSessionRepository =
    new UserSessionRepository {
      override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
        Future.successful(valid.get(token))
    }

  private def stubApiTokenRepo(
      resolvable: Map[String, (AuthenticatedUser, ApiTokenId, Option[Set[String]])]
  ): ApiTokenRepository =
    new ApiTokenRepository(null)(ExecutionContext.global) {
      override def findUserByTokenHash(hash: String): Future[Option[(AuthenticatedUser, ApiTokenId)]] =
        Future.successful(resolvable.get(hash).map { case (user, tokenId, _) => (user, tokenId) })
      override def touchLastUsed(hash: String): Future[Unit] = Future.successful(())
      override def findPrincipalByTokenHash(
          hash: String
      ): Future[Option[(AuthenticatedUser, ApiTokenId, Option[Set[String]])]] =
        Future.successful(resolvable.get(hash))
    }

  private val sessionRepo = stubSessionRepo(Map(sessionTokenA -> userA, sessionTokenB -> userB))
  private val apiTokenRepo = stubApiTokenRepo(
    Map(
      ApiTokenService.sha256Hex(patTokenA1) -> (userA, tokenIdA1, None),
      ApiTokenService.sha256Hex(patTokenA2) -> (userA, tokenIdA2, None)
    )
  )

  private def newDirective(limit: Int = 1, windowSeconds: Int = 60): RateLimitDirective =
    new RateLimitDirective(new InMemoryRateLimiter(), sessionRepo, Some(apiTokenRepo), limit, windowSeconds)

  private def routeFor(directive: RateLimitDirective, limit: Option[Int] = None) =
    limit match {
      case Some(l) => directive.rateLimit(l) { complete(StatusCodes.OK, "ok") }
      case None    => directive.rateLimit() { complete(StatusCodes.OK, "ok") }
    }

  "RateLimitDirective.rateLimit" should {

    "pass an under-limit request through" in {
      val route = routeFor(newDirective(limit = 2))
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "reject an over-limit request with 429, a Retry-After header, and a JSON ErrorResponse body" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
        responseAs[ErrorResponse].message should not be empty
      }
    }

    "keep two different users' budgets independent" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      // Exhaust user A's budget.
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
      // User B is unaffected.
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenB)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "throttle the SAME key across repeated requests" in {
      val directive = newDirective(limit = 2)
      val route = routeFor(directive)
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }

    "keep two PATs belonging to the SAME user independently budgeted" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      // Exhaust PAT 1's budget.
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patTokenA1))) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patTokenA1))) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
      // PAT 2, also belonging to user A, is unaffected.
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patTokenA2))) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "allow a route-specific tighter limit to override the global default" in {
      val directive = newDirective(limit = 100) // generous global default
      val route = routeFor(directive, limit = Some(1)) // tighter per-route limit
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
    }

    // HEL-495 delivery split (see RateLimitDirective's scaladoc): IP-based keying for
    // unauthenticated/invalid-credential requests was deferred to HEL-837. These three tests pin
    // down the deliberate pass-through behavior that results -- a request this directive cannot
    // key on a session or PAT is simply not rate-limited, no matter how many times it repeats.

    "not rate-limit an unauthenticated request no matter how many times it repeats" in {
      val route = routeFor(newDirective(limit = 1))
      // Limit is 1, but with no session/PAT credential at all every one of these must still pass.
      Get("/") ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/") ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/") ~> route ~> check { status shouldBe StatusCodes.OK }
    }

    "not rate-limit a request carrying an invalid/expired session cookie" in {
      val route = routeFor(newDirective(limit = 1))
      val invalidCookie = Cookie(SessionCookies.Name -> "not-a-real-session")
      Get("/").withHeaders(invalidCookie) ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/").withHeaders(invalidCookie) ~> route ~> check { status shouldBe StatusCodes.OK }
    }

    "not rate-limit a request carrying an unresolvable PAT bearer token" in {
      val route = routeFor(newDirective(limit = 1))
      val invalidBearer = Authorization(OAuth2BearerToken("helio_pat_" + "0" * 64))
      Get("/").withHeaders(invalidBearer) ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/").withHeaders(invalidBearer) ~> route ~> check { status shouldBe StatusCodes.OK }
    }
  }
}
