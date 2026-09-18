package com.helio.services

import com.helio.domain.engine.DatasetRowValidator.FieldError

/** HEL-1087 design.md D5: the failure channel of `PanelService.submitForm` (and, upstream,
 *  `DataSourceService.appendFormRow`) — an ordinary `ServiceError` (status code + `message`)
 *  carrying an ADDITIONAL, possibly-empty set of structured `fieldErrors`. `PanelRoutes
 *  .completeSubmit` renders `FieldValidationErrorResponse(message, fieldErrors)` when
 *  `fieldErrors` is non-empty, else the plain `ErrorResponse(message)` every other route already
 *  emits (D5) — a 403/404/non-form-400 carries no field errors and renders exactly like any
 *  other `ServiceError`. */
final case class FormSubmitError(err: ServiceError, fieldErrors: Vector[FieldError] = Vector.empty)

object FormSubmitError {
  def apply(err: ServiceError): FormSubmitError = FormSubmitError(err, Vector.empty)

  /** Builds the `400` case from a non-empty set of structured field errors, joining them into a
   *  human-readable `message` (mirrors the row-append API's existing `"; "`-joined summary
   *  style — `field '<name>' — <reason>` per error). */
  def fromFieldErrors(errors: Vector[FieldError]): FormSubmitError = {
    val message = errors.map(e => s"field '${e.field}' — ${e.reason}").mkString("; ")
    FormSubmitError(ServiceError.BadRequest(message), errors)
  }
}
