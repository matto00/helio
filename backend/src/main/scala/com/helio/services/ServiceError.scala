package com.helio.services

/** Domain failure model returned by services on the `Left` channel of
 *  `Future[Either[ServiceError, A]]`.
 *
 *  Services are HTTP-agnostic — they return `ServiceError` values, and the
 *  HTTP layer (`ServiceResponse.complete`) maps each variant to the appropriate
 *  status code + `ErrorResponse(message)` body.
 *
 *  This is intentionally a small, closed set. Anything that can't be cleanly
 *  expressed as one of these belongs in the `Future`'s failure channel
 *  (i.e., a thrown exception), which the route adapter surfaces as 500.
 */
sealed trait ServiceError {
  def message: String
}

object ServiceError {
  final case class BadRequest(message: String) extends ServiceError
  final case class Unauthorized(message: String = "Invalid email or password") extends ServiceError
  final case class NotFound(message: String = "Not found") extends ServiceError
  final case class Forbidden(message: String = "Forbidden") extends ServiceError
  final case class Conflict(message: String) extends ServiceError
  /** 422 Unprocessable Entity — the request was well-formed but couldn't be
   *  processed due to semantic issues (e.g. pipeline source type unsupported,
   *  execution failed for a request-supplied input). */
  final case class UnprocessableEntity(message: String) extends ServiceError
  /** Upstream / external service failure — used by connector preview / refresh
   *  paths that propagate REST or SQL fetch errors back as 502. */
  final case class BadGateway(message: String) extends ServiceError
  final case class InternalError(message: String) extends ServiceError
  /** 413 Request Entity Too Large — used by content-connector ingestion paths
   *  (HEL-215) whose size check necessarily lives at the service layer (the
   *  route never sees the fetched bytes for URL-based ingestion, only the
   *  URL). CSV's existing oversized-upload check lives entirely at the route
   *  layer and doesn't need this variant. */
  final case class PayloadTooLarge(message: String) extends ServiceError
}
