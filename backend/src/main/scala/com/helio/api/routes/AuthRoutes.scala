package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.unmarshalling.Unmarshal
import com.github.t3hnar.bcrypt._
import com.helio.api._
import com.helio.domain.{User, UserId, UserSession}
import com.helio.infrastructure.UserRepository
import spray.json._

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.util.{Failure, Success}

class AuthRoutes(
    userRepo: UserRepository,
    googleClientId: String = "",
    googleClientSecret: String = "",
    googleRedirectUri: String = ""
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  private val rng = new SecureRandom()

  private def generateToken(): String = {
    val bytes = new Array[Byte](32)
    rng.nextBytes(bytes)
    bytes.map("%02x".format(_)).mkString
  }

  // In-memory CSRF state store: state -> expiry (epochSecond)
  // In production, this would be a session cookie or distributed store.
  private val csrfStateStore = new ConcurrentHashMap[String, Long]()
  private val CsrfStateTtlSeconds = 300L // 5 minutes

  private def generateCsrfState(): String = {
    val bytes = new Array[Byte](16)
    rng.nextBytes(bytes)
    val state = bytes.map("%02x".format(_)).mkString
    csrfStateStore.put(state, Instant.now().getEpochSecond + CsrfStateTtlSeconds)
    state
  }

  private def validateCsrfState(state: String): Boolean = {
    val expiryOpt = Option(csrfStateStore.remove(state))
    expiryOpt.exists(_ > Instant.now().getEpochSecond)
  }

  private val InvalidCredentialsMsg = "Invalid email or password"
  // A structurally valid 60-char BCrypt hash used to equalise timing when the email is not found.
  // Format: $2a$<cost>$<22-char salt><31-char checksum> (total 60 chars after the $2a$12$ prefix).
  private val DummyHash = "$2a$12$WnXAlhcaBqZYNJqSnJmFNeY38EqpqKpUwHiMw.xsJp7yDt0hXJqP2"

  private def createSession(userId: UserId): Future[UserSession] = {
    val now = Instant.now()
    val session = UserSession(
      token     = generateToken(),
      userId    = userId,
      createdAt = now,
      expiresAt = now.plusSeconds(30L * 24 * 60 * 60)
    )
    userRepo.createSession(session)
  }

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
        org.apache.pekko.http.scaladsl.model.headers.RawHeader("Authorization", s"Bearer $accessToken")
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
        path("register") {
          post {
            entity(as[RegisterRequest]) { request =>
              RequestValidation.validateRegisterRequest(request) match {
                case Left(err) =>
                  complete(StatusCodes.BadRequest, ErrorResponse(err))
                case Right(req) =>
                  val result = for {
                    existing <- userRepo.findByEmail(req.email)
                    response <- existing match {
                      case Some(_) =>
                        Future.successful(Left("email already registered"))
                      case None =>
                        val passwordHash = req.password.bcryptBounded(12)
                        val now = Instant.now()
                        val user = User(
                          id          = UserId(UUID.randomUUID().toString),
                          email       = req.email,
                          displayName = req.displayName,
                          createdAt   = now
                        )
                        val session = UserSession(
                          token     = generateToken(),
                          userId    = user.id,
                          createdAt = now,
                          expiresAt = now.plusSeconds(30L * 24 * 60 * 60)
                        )
                        for {
                          createdUser    <- userRepo.insert(user, Some(passwordHash))
                          createdSession <- userRepo.createSession(session)
                        } yield Right(AuthResponse(
                          token     = createdSession.token,
                          expiresAt = createdSession.expiresAt.toString,
                          user      = UserResponse.fromDomain(createdUser)
                        ))
                    }
                  } yield response

                  onComplete(result) {
                    case Success(Right(authResp)) =>
                      complete(StatusCodes.Created, authResp)
                    case Success(Left(_)) =>
                      complete(StatusCodes.Conflict, ErrorResponse("email already registered"))
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                  }
              }
            }
          }
        },
        path("login") {
          post {
            entity(as[LoginRequest]) { request =>
              RequestValidation.validateLoginRequest(request) match {
                case Left(err) =>
                  complete(StatusCodes.BadRequest, ErrorResponse(err))
                case Right(req) =>
                  val result = for {
                    userOpt <- userRepo.findByEmail(req.email)
                    response <- userOpt match {
                      case None =>
                        // Run dummy bcrypt to equalise timing — prevents user enumeration via response time
                        req.password.isBcryptedBounded(DummyHash)
                        Future.successful(Left(InvalidCredentialsMsg))
                      case Some(user) =>
                        userRepo.getPasswordHash(user.id).flatMap {
                          case None =>
                            Future.successful(Left(InvalidCredentialsMsg))
                          case Some(hash) =>
                            if (req.password.isBcryptedBounded(hash)) {
                              val now = Instant.now()
                              val session = UserSession(
                                token     = generateToken(),
                                userId    = user.id,
                                createdAt = now,
                                expiresAt = now.plusSeconds(30L * 24 * 60 * 60)
                              )
                              userRepo.createSession(session).map { createdSession =>
                                Right(AuthResponse(
                                  token     = createdSession.token,
                                  expiresAt = createdSession.expiresAt.toString,
                                  user      = UserResponse.fromDomain(user)
                                ))
                              }
                            } else {
                              Future.successful(Left(InvalidCredentialsMsg))
                            }
                        }
                    }
                  } yield response

                  onComplete(result) {
                    case Success(Right(authResp)) =>
                      complete(StatusCodes.OK, authResp)
                    case Success(Left(msg)) =>
                      complete(StatusCodes.Unauthorized, ErrorResponse(msg))
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                  }
              }
            }
          }
        },
        path("logout") {
          post {
            optionalHeaderValueByType(Authorization) {
              case Some(Authorization(OAuth2BearerToken(token))) =>
                val result = for {
                  sessionOpt <- userRepo.findSession(token)
                  response <- sessionOpt match {
                    case None =>
                      Future.successful(Left(()))
                    case Some(_) =>
                      userRepo.deleteSession(token).map(_ => Right(()))
                  }
                } yield response

                onComplete(result) {
                  case Success(Right(_)) =>
                    complete(StatusCodes.NoContent)
                  case Success(Left(_)) =>
                    complete(StatusCodes.Unauthorized, ErrorResponse("Invalid or expired token"))
                  case Failure(ex) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                }
              case _ =>
                complete(StatusCodes.Unauthorized, ErrorResponse("Authorization header required"))
            }
          }
        },
        path("google") {
          get {
            val state = generateCsrfState()
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
              // Validate CSRF state parameter
              val stateValid = stateOpt.exists(validateCsrfState)
              if (!stateValid) {
                complete(StatusCodes.BadRequest, ErrorResponse("Invalid or missing OAuth state parameter"))
              } else {
                errorOpt match {
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
                          session     <- createSession(user.id)
                        } yield AuthResponse(
                          token     = session.token,
                          expiresAt = session.expiresAt.toString,
                          user      = UserResponse.fromDomain(user)
                        )

                        onComplete(result) {
                          case Success(authResp) =>
                            complete(StatusCodes.OK, authResp)
                          case Failure(ex) if ex.getMessage != null && ex.getMessage.contains("Google token exchange failed") =>
                            complete(StatusCodes.BadGateway, ErrorResponse("Failed to exchange authorization code"))
                          case Failure(ex) if ex.getMessage != null && ex.getMessage.contains("Google userinfo fetch failed") =>
                            complete(StatusCodes.BadGateway, ErrorResponse("Failed to exchange authorization code"))
                          case Failure(ex) if ex.getMessage != null && ex.getMessage.startsWith("No access_token") =>
                            complete(StatusCodes.BadGateway, ErrorResponse("Failed to exchange authorization code"))
                          case Failure(ex) =>
                            complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                        }
                    }
                }
              }
            }
          }
        }
    )
}
