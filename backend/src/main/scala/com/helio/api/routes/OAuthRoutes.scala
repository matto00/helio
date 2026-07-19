package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.unmarshalling.Unmarshal
import com.helio.api._
import com.helio.services.AuthService
import org.slf4j.LoggerFactory
import spray.json._

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.util.{Failure, Success}

/** Google OAuth handlers.
 *
 *  HTTP-heavy concerns (redirect kickoff, code → token exchange, userinfo
 *  fetch, CSRF state parameter) stay here because the test suite overrides
 *  `exchangeCodeForTokenImpl` / `fetchGoogleProfileImpl` as protected hooks.
 *  Once the Google profile has been obtained, the route hands off to
 *  [[AuthService.completeOAuth]] for the user upsert + session mint.
 *
 *  CSRF state generation/validation is also delegated to `AuthService` so the
 *  in-memory token store lives next to the rest of the auth surface.
 *
 *  HEL-287 CodeQL #8: the callback response no longer echoes the session
 *  token in the JSON body — it is set via `Set-Cookie` (see
 *  [[SessionCookies]]), matching `AuthRoutes` register/login. */
class OAuthRoutes(
    authService: AuthService,
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = "",
    // HEL-287: default preserves existing test call sites that construct
    // OAuthRoutes positionally without a cookie config.
    cookieConfig: CookieConfig = CookieConfig(secure = false)
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private val log = LoggerFactory.getLogger(getClass)

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  protected def exchangeCodeForTokenImpl(code: String): Future[String] = {
    val formData = FormData(
      "code"          -> code,
      "client_id"     -> googleClientId,
      "client_secret" -> googleClientSecret,
      "redirect_uri"  -> googleRedirectUri,
      "grant_type"    -> "authorization_code"
    )
    val request = HttpRequest(
      method = HttpMethods.POST,
      uri    = "https://oauth2.googleapis.com/token",
      entity = formData.toEntity
    )
    Http()(system.classicSystem).singleRequest(request).flatMap { response =>
      Unmarshal(response.entity).to[String].flatMap { body =>
        if (response.status.isSuccess()) {
          val json        = body.parseJson.asJsObject
          val accessToken = json.fields.get("access_token").collect { case JsString(t) => t }
          accessToken match {
            case Some(token) => Future.successful(token)
            case None        => Future.failed(new RuntimeException("No access_token in Google response"))
          }
        } else {
          Future.failed(new RuntimeException(s"Google token exchange failed: ${response.status}"))
        }
      }
    }
  }

  protected def fetchGoogleProfileImpl(accessToken: String): Future[GoogleProfile] = {
    val request = HttpRequest(
      method  = HttpMethods.GET,
      uri     = "https://www.googleapis.com/oauth2/v3/userinfo",
      headers = scala.collection.immutable.Seq(
        RawHeader("Authorization", s"Bearer $accessToken")
      )
    )
    Http()(system.classicSystem).singleRequest(request).flatMap { response =>
      Unmarshal(response.entity).to[String].flatMap { body =>
        if (response.status.isSuccess()) {
          Future.successful(body.parseJson.convertTo[GoogleProfile])
        } else {
          Future.failed(new RuntimeException(s"Google userinfo fetch failed: ${response.status}"))
        }
      }
    }
  }

  val routes: Route =
    concat(
      path("google") {
        get { redirect(buildGoogleAuthUrl(authService.generateCsrfState()), StatusCodes.Found) }
      },
      path("google" / "callback") {
        get {
          parameters("code".?, "error".?, "state".?) { (codeOpt, errorOpt, stateOpt) =>
            handleCallback(codeOpt, errorOpt, stateOpt)
          }
        }
      }
    )

  private def handleCallback(codeOpt: Option[String], errorOpt: Option[String], stateOpt: Option[String]): Route =
    if (!stateOpt.exists(authService.validateCsrfState))
      complete(StatusCodes.BadRequest, ErrorResponse("Invalid or missing OAuth state parameter"))
    else errorOpt match {
      case Some("access_denied") => complete(StatusCodes.BadRequest, ErrorResponse("OAuth access denied"))
      case Some(err)             => complete(StatusCodes.BadRequest, ErrorResponse(s"OAuth error: $err"))
      case None => codeOpt match {
        case None       => complete(StatusCodes.BadRequest, ErrorResponse("OAuth error: missing authorization code"))
        case Some(code) => completeOAuthExchange(code)
      }
    }

  private def completeOAuthExchange(code: String): Route = {
    val result = for {
      accessToken <- exchangeCodeForTokenImpl(code)
      profile     <- fetchGoogleProfileImpl(accessToken)
      authResult  <- authService.completeOAuth(profile)
    } yield authResult

    onComplete(result) {
      case Success(authResult) =>
        setCookie(SessionCookies.issue(authResult.token, cookieConfig)) {
          complete(StatusCodes.OK, authResult.response)
        }
      case Failure(ex) if isUpstreamOAuthError(ex) => complete(StatusCodes.BadGateway, ErrorResponse("Failed to exchange authorization code"))
      case Failure(ex) =>
        // HEL-311: never echo raw exception text to the client — log the full
        // exception + stack trace server-side and return a generic body.
        log.error("OAuth callback failed unexpectedly during code exchange", ex)
        complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
    }
  }

  private def buildGoogleAuthUrl(state: String): String = {
    val params = Map(
      "client_id"     -> googleClientId,
      "redirect_uri"  -> googleRedirectUri,
      "response_type" -> "code",
      "scope"         -> "openid email profile",
      "state"         -> state
    )
    val queryString = params.map { case (k, v) =>
      s"${URLEncoder.encode(k, StandardCharsets.UTF_8)}=${URLEncoder.encode(v, StandardCharsets.UTF_8)}"
    }.mkString("&")
    s"https://accounts.google.com/o/oauth2/v2/auth?$queryString"
  }

  private def isUpstreamOAuthError(ex: Throwable): Boolean = {
    val msg = Option(ex.getMessage).getOrElse("")
    msg.contains("Google token exchange failed") ||
      msg.contains("Google userinfo fetch failed") ||
      msg.startsWith("No access_token")
  }
}
