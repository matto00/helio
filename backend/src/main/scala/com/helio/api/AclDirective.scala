package com.helio.api

import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directive0
import akka.http.scaladsl.server.Directives._
import com.helio.domain.AuthenticatedUser

import scala.concurrent.{ExecutionContext, Future}

/** ACL directive that enforces resource ownership before executing the inner route.
 *
 *  The caller supplies a `resolver` function `(resourceId: String) => Future[Option[String]]`
 *  where the returned `String` is the owner's user ID (`createdBy`), or `None` if the
 *  resource does not exist.
 *
 *  - Resource not found            → 404 Not Found
 *  - Resource found, wrong owner   → 403 Forbidden
 *  - Resource found, correct owner → inner route executes
 *
 *  Registering a new resource type only requires wiring a new resolver in `ApiRoutes` —
 *  the directive itself is resource-type-agnostic.
 */
class AclDirective(implicit ec: ExecutionContext) extends JsonProtocols {

  def authorizeResource(
      resourceId: String,
      user: AuthenticatedUser,
      resolver: String => Future[Option[String]],
      notFoundMessage: String = "Not found"
  ): Directive0 =
    onComplete(resolver(resourceId)).flatMap {
      case scala.util.Success(None) =>
        complete(StatusCodes.NotFound, ErrorResponse(notFoundMessage))

      case scala.util.Success(Some(ownerId)) if ownerId != user.id.value =>
        complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))

      case scala.util.Success(Some(_)) =>
        pass

      case scala.util.Failure(_) =>
        complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
    }
}
