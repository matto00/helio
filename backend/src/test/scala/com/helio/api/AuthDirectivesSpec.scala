package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken, RawHeader}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{AuthenticatedUser, UserId}
import com.helio.infrastructure.{ApiTokenRepository, UserSessionRepository}
import com.helio.services.ApiTokenService
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.{ExecutionContext, Future}

/** Unit coverage for [[AuthDirectives]] (HEL-287 httpOnly-cookie migration,
 *  design.md D2/D4): session-cookie resolution, the header hard-cutover
 *  (raw session tokens no longer accepted via `Authorization`, PAT tokens
 *  still are), and the CSRF header requirement. Exercised directly against
 *  the directives with stub repositories — no DB, no full `ApiRoutes` — the
 *  route-level round-trip is covered by `ApiRoutesSpec`/`ApiTokenAuthSpec`. */
class AuthDirectivesSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols {

  private val sessionToken = "a-real-session-token"
  private val patToken     = "helio_pat_" + "a" * 64
  private val sessionUser  = AuthenticatedUser(UserId("session-user-id"))
  private val patUser      = AuthenticatedUser(UserId("pat-user-id"))

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == sessionToken) Some(sessionUser) else None)
  }

  private val stubApiTokenRepo: ApiTokenRepository =
    new ApiTokenRepository(null)(ExecutionContext.global) {
      override def findUserByTokenHash(hash: String): Future[Option[AuthenticatedUser]] =
        Future.successful(if (hash == ApiTokenService.sha256Hex(patToken)) Some(patUser) else None)
      override def touchLastUsed(hash: String): Future[Unit] = Future.successful(())
    }

  private val directives = new AuthDirectives(stubSessionRepo, Some(stubApiTokenRepo))

  private val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

  private val authenticateRoute =
    directives.authenticate { user => complete(StatusCodes.OK, user.id.value) }

  private val optionalAuthenticateRoute =
    directives.optionalAuthenticate {
      case Some(user) => complete(StatusCodes.OK, user.id.value)
      case None       => complete(StatusCodes.OK, "anonymous")
    }

  private val csrfRoute =
    directives.requireCsrfHeader { complete(StatusCodes.OK, "passed") }

  "AuthDirectives.authenticate" should {

    "resolve identity from a valid session cookie" in {
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionToken)) ~> authenticateRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe sessionUser.id.value
      }
    }

    "reject a raw session token sent via the Authorization header (hard cutover, design.md D2)" in {
      Get("/").withHeaders(Authorization(OAuth2BearerToken(sessionToken))) ~> authenticateRoute ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "resolve a PAT bearer token via the Authorization header unchanged" in {
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patToken))) ~> authenticateRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe patUser.id.value
      }
    }

    "reject when neither a session cookie nor an Authorization header is present" in {
      Get("/") ~> authenticateRoute ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "prefer the session cookie over a simultaneously-present PAT header" in {
      Get("/")
        .withHeaders(Cookie(SessionCookies.Name -> sessionToken), Authorization(OAuth2BearerToken(patToken))) ~>
        authenticateRoute ~> check {
          status shouldBe StatusCodes.OK
          responseAs[String] shouldBe sessionUser.id.value
        }
    }
  }

  "AuthDirectives.optionalAuthenticate" should {

    "yield anonymous access when no credential is present at all" in {
      Get("/") ~> optionalAuthenticateRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe "anonymous"
      }
    }

    "reject (not silently anonymize) an invalid credential" in {
      Get("/").withHeaders(Cookie(SessionCookies.Name -> "not-a-real-session")) ~> optionalAuthenticateRoute ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }

  "AuthDirectives.requireCsrfHeader" should {

    "pass a GET request through even with a session cookie and no CSRF header" in {
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionToken)) ~> csrfRoute ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "reject a non-GET request that carries the session cookie but no CSRF header" in {
      Post("/").withHeaders(Cookie(SessionCookies.Name -> sessionToken)) ~> csrfRoute ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "pass a non-GET request that carries the session cookie and the CSRF header" in {
      Post("/").withHeaders(Cookie(SessionCookies.Name -> sessionToken), csrfHeader) ~> csrfRoute ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "pass a PAT-authenticated non-GET request with no session cookie and no CSRF header" in {
      Post("/").withHeaders(Authorization(OAuth2BearerToken(patToken))) ~> csrfRoute ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "pass a non-GET request with no credential at all (e.g. register/login minting the cookie)" in {
      Post("/") ~> csrfRoute ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }
}
