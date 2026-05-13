package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.unmarshalling.Unmarshal
import com.helio.api._
import com.helio.infrastructure.UserRepository
import spray.json._

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.util.{Failure, Success}

/** Google OAuth handlers split out of `AuthRoutes`.
 *  Hosts `GET /google` (kickoff) and `GET /google/callback` (token exchange + sign-in). */
class OAuthRoutes(
    userRepo: UserRepository,
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = ""
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

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
        get {
          val state = AuthSupport.generateCsrfState()
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
          val googleAuthUrl = s"https://accounts.google.com/o/oauth2/v2/auth?$queryString"
          redirect(googleAuthUrl, StatusCodes.Found)
        }
      },
      path("google" / "callback") {
        get {
          parameters("code".?, "error".?, "state".?) { (codeOpt, errorOpt, stateOpt) =>
            val stateValid = stateOpt.exists(AuthSupport.validateCsrfState)
            if (!stateValid)
              complete(StatusCodes.BadRequest, ErrorResponse("Invalid or missing OAuth state parameter"))
            else errorOpt match {
              case Some(err) =>
                val message = if (err == "access_denied") "OAuth access denied" else s"OAuth error: $err"
                complete(StatusCodes.BadRequest, ErrorResponse(message))

              case None =>
                codeOpt match {
                  case None =>
                    complete(StatusCodes.BadRequest, ErrorResponse("OAuth error: missing authorization code"))

                  case Some(code) =>
                    val result = for {
                      accessToken <- exchangeCodeForTokenImpl(code)
                      profile     <- fetchGoogleProfileImpl(accessToken)
                      email        = profile.email.getOrElse(s"google:${profile.sub}@helio.invalid")
                      user        <- userRepo.upsertGoogleUser(profile.sub, email, profile.name, profile.picture)
                      session     <- AuthSupport.createSession(userRepo, user.id)
                    } yield AuthResponse(
                      token     = session.token,
                      expiresAt = session.expiresAt.toString,
                      user      = UserResponse.fromDomain(user)
                    )

                    onComplete(result) {
                      case Success(authResp) =>
                        complete(StatusCodes.OK, authResp)
                      case Failure(ex) if isUpstreamOAuthError(ex) =>
                        complete(StatusCodes.BadGateway, ErrorResponse("Failed to exchange authorization code"))
                      case Failure(ex) =>
                        complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                    }
                }
            }
          }
        }
      }
    )

  private def isUpstreamOAuthError(ex: Throwable): Boolean = {
    val msg = Option(ex.getMessage).getOrElse("")
    msg.contains("Google token exchange failed") ||
      msg.contains("Google userinfo fetch failed") ||
      msg.startsWith("No access_token")
  }
}
