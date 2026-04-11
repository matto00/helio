package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.github.t3hnar.bcrypt._
import com.helio.api._
import com.helio.domain.{User, UserId, UserSession}
import com.helio.infrastructure.UserRepository

import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.util.{Failure, Success}

final class AuthRoutes(
    userRepo: UserRepository
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
                          createdUser    <- userRepo.insert(user, passwordHash)
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
        }
    )
}
