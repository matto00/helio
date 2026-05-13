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
  final case class InternalError(message: String) extends ServiceError
}
