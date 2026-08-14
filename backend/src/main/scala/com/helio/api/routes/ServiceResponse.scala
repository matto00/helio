package com.helio.api.routes

import org.apache.pekko.http.scaladsl.marshalling.ToResponseMarshallable
import org.apache.pekko.http.scaladsl.model.{HttpHeader, StatusCode, StatusCodes}
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

  /** Variant of `runNoContent` for endpoints whose success path needs to
   *  attach a header computed from the service result before completing
   *  `204` (HEL-560: `DELETE /api/metrics/:id` returns the unbound panel
   *  count via `X-Unbound-Panel-Count` rather than a response body, keeping
   *  the existing body-less contract additive/non-breaking). */
  def runNoContentWithHeader[A](result: Future[Either[ServiceError, A]])(header: A => HttpHeader): Route =
    onSuccess(result) {
      case Right(a) => respondWithHeader(header(a)) { complete(StatusCodes.NoContent) }
      case Left(e)  => completeError(e)
    }

  /** Variant of `run` for endpoints whose success path needs to attach its
   *  own directives around the completed response (e.g. `setCookie` — HEL-287
   *  login/register/OAuth-callback, which set the session cookie from a
   *  value only known once the service `Future` completes, so it can't be
   *  wrapped as a static outer directive the way `setCookie` normally is). */
  def runWith[A](result: Future[Either[ServiceError, A]])(success: A => Route): Route =
    onSuccess(result) {
      case Right(a) => success(a)
      case Left(e)  => completeError(e)
    }

  private def completeError(e: ServiceError): Route = complete(statusCodeFor(e), ErrorResponse(e.message))

  /** Status-code mapping for each `ServiceError` variant — `private[routes]` (not `private`) so
   *  `DashboardAuthoringRoutes`'s bespoke completion helper (HEL-401 design.md D1: `completeError`
   *  above hardcodes the generic `ErrorResponse` and can't thread an extra `kind` field) can reuse
   *  the SAME mapping rather than duplicating this switch — the only thing that route bypasses is
   *  the response BODY shape, never the status-code contract every route already relies on. */
  private[routes] def statusCodeFor(e: ServiceError): StatusCode = e match {
    case ServiceError.BadRequest(_)          => StatusCodes.BadRequest
    case ServiceError.Unauthorized(_)        => StatusCodes.Unauthorized
    case ServiceError.NotFound(_)            => StatusCodes.NotFound
    case ServiceError.Forbidden(_)           => StatusCodes.Forbidden
    case ServiceError.Conflict(_)            => StatusCodes.Conflict
    case ServiceError.UnprocessableEntity(_) => StatusCodes.UnprocessableEntity
    case ServiceError.BadGateway(_)          => StatusCodes.BadGateway
    case ServiceError.InternalError(_)       => StatusCodes.InternalServerError
    case ServiceError.PayloadTooLarge(_)     => StatusCodes.RequestEntityTooLarge
  }
}
