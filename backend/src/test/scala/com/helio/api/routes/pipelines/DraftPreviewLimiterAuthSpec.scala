package com.helio.api.routes.pipelines

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.model.{ApiToken, ApiTokenId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ApiTokenRepository
import com.helio.services.auth.ApiTokenService
import com.helio.services.pipelines.draftpreview.DraftPreviewConfig
import com.helio.services.ratelimit.RateLimitConfig
import com.helio.testsupport.DraftPreviewApiFixture
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken, RawHeader, `Retry-After`}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest, StatusCodes}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1630 tasks 5.4 and 5.5: the endpoint's own budget, its exemption from the general `/api` bucket, and everything that must
 *  still wrap it (authentication, the CSRF header, scoped-token confinement).
 *
 *  The general limit is injected as 3 per window so that "untouched" is observable: after any number of exempt requests a probe
 *  route still gets all 3 of its requests. The probe is `GET /api/auth/me`. */
class DraftPreviewLimiterAuthSpec extends DraftPreviewApiFixture {

  override protected def rateLimitConfig: RateLimitConfig           = RateLimitConfig(requestsPerWindow = 3, windowSeconds = 60)
  override protected def draftPreviewConfig: DraftPreviewConfig     = DraftPreviewConfig(requestsPerWindow = 120, maxInFlight = 8, maxInFlightPerPrincipal = 2)

  private var tokens: ApiTokenRepository = _
  override protected def apiTokenRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): ApiTokenRepository = {
    tokens = new ApiTokenRepository(ctx)(ec)
    tokens
  }

  private def mintToken(user: String, scoped: Option[Set[String]]): String = {
    val raw = ApiTokenService.TokenPrefix + "synthetic-test-token-" + UUID.randomUUID().toString.replace("-", "")
    await(tokens.create(ApiToken(ApiTokenId(UUID.randomUUID().toString), UserId(user), ApiTokenService.sha256Hex(raw), "t", Instant.now(), None, None, scoped)))
    raw
  }

  private val oneStep = draftBody(Vector(rootOf("r", jobj("a" -> intCell(1)))), Vector(limitStep("a", 1))).compactPrint

  private def status(r: HttpRequest) = r ~> routes ~> check(response.status)
  private def me(user: String)       = req(HttpMethods.GET, "/api/auth/me", user)

  "the draft-preview limiter" should {
    "allow 120 requests in a window and answer the 121st 429 with Retry-After and its own message" in {
      val seed = seedPipeline()
      (1 to 120).foreach(i => withClue(s"request $i")(preview(seed, userA, JsObject(Map("roots" -> JsArray(rootOf("r")), "steps" -> JsArray.empty))).status shouldBe StatusCodes.OK))
      previewRequest(seed, userA, oneStep) ~> routes ~> check {
        response.status shouldBe StatusCodes.TooManyRequests
        header[`Retry-After`] should not be empty
        responseAs[String].parseJson shouldBe JsObject("message" -> JsString("Draft preview rate limit exceeded"))
      }
    }

    "leave the general /api bucket untouched: every draft-preview request is exempt, so the probe keeps its full budget of 3" in {
      val seed = seedPipeline()
      (1 to 6).foreach(_ => previewRequest(seed, userB, oneStep) ~> routes ~> check(response.status))
      status(me(userB)) shouldBe StatusCodes.OK
      status(me(userB)) shouldBe StatusCodes.OK
      status(me(userB)) shouldBe StatusCodes.OK
      me(userB) ~> routes ~> check {
        response.status shouldBe StatusCodes.TooManyRequests
        responseAs[String].parseJson shouldBe JsObject("message" -> JsString("Rate limit exceeded"))
      }
    }

    "still count near-miss paths against the general bucket: a GET, a trailing slash and an extra segment each cost one" in {
      val seed = seedPipeline()
      status(req(HttpMethods.GET, s"/api/pipelines/${seed.pipeline}/draft-preview", userC)) should not be StatusCodes.TooManyRequests
      status(req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview/", userC, Some(oneStep))) should not be StatusCodes.TooManyRequests
      status(req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview/extra", userC, Some(oneStep))) should not be StatusCodes.TooManyRequests
      // Three requests spent: the probe is refused at once, which it would not be had any near-miss been exempt.
      me(userC) ~> routes ~> check {
        response.status shouldBe StatusCodes.TooManyRequests
        responseAs[String].parseJson shouldBe JsObject("message" -> JsString("Rate limit exceeded"))
      }
    }
  }

  "everything that wraps the endpoint" should {
    "refuse a hook-scoped PAT before anything is evaluated" in {
      val seed   = seedPipeline()
      val scoped = mintToken(userA, Some(Set("some-pipeline")))
      val before = sourceAccess.get
      HttpRequest(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview", entity = HttpEntity(ContentTypes.`application/json`, oneStep))
        .addHeader(Authorization(OAuth2BearerToken(scoped))) ~> routes ~> check {
        response.status shouldBe StatusCodes.Forbidden
        responseAs[String] should not include "\"type\""
      }
      sourceAccess.get shouldBe before
    }

    "accept an unscoped PAT, which needs no CSRF header, and bucket it on its own key" in {
      val seed = seedPipeline()
      val pat  = mintToken(userA, None)
      HttpRequest(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview", entity = HttpEntity(ContentTypes.`application/json`, oneStep))
        .addHeader(Authorization(OAuth2BearerToken(pat))) ~> routes ~> check {
        response.status shouldBe StatusCodes.OK
        responseAs[String] should include("\"type\":\"rows\"")
      }
    }

    "refuse a session POST that omits the CSRF header" in {
      val seed = seedPipeline()
      HttpRequest(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview", entity = HttpEntity(ContentTypes.`application/json`, oneStep))
        .addHeader(Cookie(SessionCookies.Name -> tokenOf(userA))) ~> routes ~> check {
        response.status shouldBe StatusCodes.Forbidden
        responseAs[String] should include("CSRF")
      }
      HttpRequest(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview", entity = HttpEntity(ContentTypes.`application/json`, oneStep))
        .addHeader(Cookie(SessionCookies.Name -> tokenOf(userA)))
        .addHeader(RawHeader(AuthDirectives.CsrfHeaderName, "0")) ~> routes ~> check { response.status shouldBe StatusCodes.Forbidden }
    }

    "answer 401 to an unauthenticated request" in {
      val seed = seedPipeline()
      HttpRequest(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview", entity = HttpEntity(ContentTypes.`application/json`, oneStep)) ~> routes ~> check {
        response.status shouldBe StatusCodes.Unauthorized
      }
    }
  }
}
