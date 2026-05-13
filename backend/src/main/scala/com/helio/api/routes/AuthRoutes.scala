package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.github.t3hnar.bcrypt._
import com.helio.api._
import com.helio.domain.{User, UserId, UserSession}
import com.helio.infrastructure.UserRepository

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.util.{Failure, Success}

/** Credential-based auth handlers: `/register`, `/login`, `/logout`.
 *  Google OAuth handlers live in `OAuthRoutes`; both share helpers in `AuthSupport`. */
class AuthRoutes(
    userRepo: UserRepository,
    @annotation.unused googleClientId: String = "",
    @annotation.unused googleClientSecret: String = "",
    @annotation.unused googleRedirectUri: String = ""
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  private val InvalidCredentialsMsg = "Invalid email or password"
  // A structurally valid 60-char BCrypt hash used to equalise timing when the email is not found.
  // Format: $2a$<cost>$<22-char salt><31-char checksum> (total 60 chars after the $2a$12$ prefix).
  private val DummyHash = "$2a$12$WnXAlhcaBqZYNJqSnJmFNeY38EqpqKpUwHiMw.xsJp7yDt0hXJqP2"

  val routes: Route =
    concat(
      path("register") {
        post {
          entity(as[RegisterRequest]) { request =>
            RequestValidation.validateRegisterRequest(request) match {
              case Left(err) =>
                complete(StatusCodes.BadRequest, ErrorResponse(err))
              case Right(req) =>
                onComplete(handleRegister(req)) {
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
                onComplete(handleLogin(req)) {
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
              onComplete(handleLogout(token)) {
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
      }
    )

  private def handleRegister(req: RegisterRequest): Future[Either[String, AuthResponse]] =
    userRepo.findByEmail(req.email).flatMap {
      case Some(_) =>
        Future.successful(Left("email already registered"))
      case None =>
        val passwordHash = req.password.bcryptBounded(12)
        val now          = Instant.now()
        val user = User(
          id          = UserId(UUID.randomUUID().toString),
          email       = req.email,
          displayName = req.displayName,
          createdAt   = now
        )
        val session = UserSession(
          token     = AuthSupport.generateSessionToken(),
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

  private def handleLogin(req: LoginRequest): Future[Either[String, AuthResponse]] =
    userRepo.findByEmail(req.email).flatMap {
      case None =>
        // Run dummy bcrypt to equalise timing — prevents user enumeration via response time
        req.password.isBcryptedBounded(DummyHash)
        Future.successful(Left(InvalidCredentialsMsg))
      case Some(user) =>
        userRepo.getPasswordHash(user.id).flatMap {
          case None =>
            Future.successful(Left(InvalidCredentialsMsg))
          case Some(hash) if req.password.isBcryptedBounded(hash) =>
            val session = AuthSupport.buildSession(user.id)
            userRepo.createSession(session).map { created =>
              Right(AuthResponse(
                token     = created.token,
                expiresAt = created.expiresAt.toString,
                user      = UserResponse.fromDomain(user)
              ))
            }
          case Some(_) =>
            Future.successful(Left(InvalidCredentialsMsg))
        }
    }

  private def handleLogout(token: String): Future[Either[Unit, Unit]] =
    userRepo.findSession(token).flatMap {
      case None    => Future.successful(Left(()))
      case Some(_) => userRepo.deleteSession(token).map(_ => Right(()))
    }
}
