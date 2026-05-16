package com.helio.api.routes

import org.apache.pekko.http.scaladsl.marshalling.ToResponseMarshallable
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.services.ServiceError

import scala.concurrent.Future

/** Bridge between services (`Future[Either[ServiceError, A]]`) and Pekko HTTP.
 *
 *  A single call site keeps route files free of the boilerplate that would
 *  otherwise be duplicated for every endpoint:
 *
 *  {{{
 *  ServiceResponse.run(panelService.update(id, req, user))(panel =>
 *    PanelResponse.fromDomain(panel)
 *  )
 *  }}}
 *
 *  Wire shape is preserved byte-for-byte: each `ServiceError` variant maps to
 *  the same status code + `ErrorResponse(message)` body that the pre-CS2b
 *  routes emitted inline. */
object ServiceResponse extends JsonProtocols {

  /** Complete the route from a service result. `success` builds the marshalled
   *  response body from the `Right` value; the response status is taken from
   *  the marshallable itself (e.g. wrap in `StatusCodes.Created -> body` to
   *  override the default `200 OK`). */
  def run[A](result: Future[Either[ServiceError, A]])(
      success: A => ToResponseMarshallable
  ): Route =
    onSuccess(result) {
      case Right(a) => complete(success(a))
      case Left(e)  => completeError(e)
    }

  /** Variant for endpoints whose success path returns `204 NoContent` (e.g. DELETE). */
  def runNoContent(result: Future[Either[ServiceError, Unit]]): Route =
    onSuccess(result) {
      case Right(_) => complete(StatusCodes.NoContent)
      case Left(e)  => completeError(e)
    }

  private def completeError(e: ServiceError): Route = e match {
    case ServiceError.BadRequest(m)    => complete(StatusCodes.BadRequest, ErrorResponse(m))
    case ServiceError.Unauthorized(m)  => complete(StatusCodes.Unauthorized, ErrorResponse(m))
    case ServiceError.NotFound(m)      => complete(StatusCodes.NotFound, ErrorResponse(m))
    case ServiceError.Forbidden(m)     => complete(StatusCodes.Forbidden, ErrorResponse(m))
    case ServiceError.Conflict(m)            => complete(StatusCodes.Conflict, ErrorResponse(m))
    case ServiceError.UnprocessableEntity(m) => complete(StatusCodes.UnprocessableEntity, ErrorResponse(m))
    case ServiceError.BadGateway(m)          => complete(StatusCodes.BadGateway, ErrorResponse(m))
    case ServiceError.InternalError(m)       => complete(StatusCodes.InternalServerError, ErrorResponse(m))
  }
}
