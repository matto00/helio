package com.helio.api.http

import com.helio.api._
import com.helio.api.http.{AuthDirectives, SessionCookies}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken, RawHeader}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.model.{ApiTokenId, AuditSource, AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, UserSessionRepository}
import com.helio.services.auth.ApiTokenService
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

  private val sessionToken   = "a-real-session-token"
  private val patToken       = "helio_pat_" + "a" * 64
  private val scopedPatToken = "helio_pat_" + "b" * 64
  private val sessionUser    = AuthenticatedUser(UserId("session-user-id"))
  private val patUser        = AuthenticatedUser(UserId("pat-user-id"))
  private val patTokenId     = ApiTokenId("pat-token-id")
  private val scopedTokenId  = ApiTokenId("scoped-token-id")
  private val allowedPipelineIds = Set("pipeline-1")

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == sessionToken) Some(sessionUser) else None)
  }

  private val stubApiTokenRepo: ApiTokenRepository =
    new ApiTokenRepository(null)(ExecutionContext.global) {
      override def findUserByTokenHash(hash: String): Future[Option[(AuthenticatedUser, ApiTokenId)]] =
        Future.successful(if (hash == ApiTokenService.sha256Hex(patToken)) Some((patUser, patTokenId)) else None)
      override def touchLastUsed(hash: String): Future[Unit] = Future.successful(())
      // HEL-369: backs `confineScopedToken`'s speculative resolution. Only
      // `scopedPatToken` resolves to a *scoped* row (Some(allowedPipelineIds));
      // `patToken` resolves but is unscoped (None); anything else doesn't
      // resolve at all.
      override def findPrincipalByTokenHash(hash: String): Future[Option[(AuthenticatedUser, ApiTokenId, Option[Set[String]])]] =
        Future.successful(hash match {
          case h if h == ApiTokenService.sha256Hex(scopedPatToken) => Some((patUser, scopedTokenId, Some(allowedPipelineIds)))
          case h if h == ApiTokenService.sha256Hex(patToken)       => Some((patUser, ApiTokenId("unscoped-token-id"), None))
          case _                                                   => None
        })
    }

  private val directives = new AuthDirectives(stubSessionRepo, Some(stubApiTokenRepo))

  private val csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

  private val authenticateRoute =
    directives.authenticate { user => complete(StatusCodes.OK, user.id.value) }

  private val provenanceRoute =
    directives.authenticate { user =>
      complete(StatusCodes.OK, s"${user.id.value}|${AuditSource.asString(user.source)}|${user.tokenId.map(_.value).getOrElse("none")}")
    }

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

    "resolve a session-cookie request with source=ui and no token id (HEL-483)" in {
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionToken)) ~> provenanceRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe s"${sessionUser.id.value}|ui|none"
      }
    }

    "resolve a PAT bearer request with source=pat and the resolving token's id (HEL-483)" in {
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patToken))) ~> provenanceRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe s"${patUser.id.value}|pat|${patTokenId.value}"
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

  "AuthDirectives.confineScopedToken (HEL-369 design.md Decision 2)" should {

    val confineRoute =
      directives.confineScopedToken { tokenScope =>
        complete(StatusCodes.OK, tokenScope.map(_.allowedPipelineIds.toVector.sorted.mkString(",")).getOrElse("none"))
      }

    "pass through (None) when a session cookie is present, without inspecting a simultaneously-present scoped-PAT header" in {
      Get("/dashboards")
        .withHeaders(Cookie(SessionCookies.Name -> sessionToken), Authorization(OAuth2BearerToken(scopedPatToken))) ~>
        confineRoute ~> check {
          status shouldBe StatusCodes.OK
          responseAs[String] shouldBe "none"
        }
    }

    "pass through (None) when no Authorization header is present at all" in {
      Get("/dashboards") ~> confineRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe "none"
      }
    }

    "pass through (None) for an unscoped PAT" in {
      Get("/dashboards").withHeaders(Authorization(OAuth2BearerToken(patToken))) ~> confineRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe "none"
      }
    }

    "pass through (None) for an invalid/unresolved bearer token" in {
      Get("/dashboards").withHeaders(Authorization(OAuth2BearerToken("helio_pat_" + "0" * 64))) ~> confineRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe "none"
      }
    }

    "extract Some(TokenScope) for a scoped token on a /hooks/... path" in {
      Get("/hooks/run").withHeaders(Authorization(OAuth2BearerToken(scopedPatToken))) ~> confineRoute ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe "pipeline-1"
      }
    }

    "reject a scoped token with 403 on a non-hooks path (the round-1 design-gate bypass this closes)" in {
      Get("/dashboards").withHeaders(Authorization(OAuth2BearerToken(scopedPatToken))) ~> confineRoute ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "reject a scoped token with 403 on a path that merely starts with \"hooks\" (exact-segment match, not a prefix test)" in {
      Get("/hooksomething").withHeaders(Authorization(OAuth2BearerToken(scopedPatToken))) ~> confineRoute ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }
  }
}
