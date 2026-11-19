package com.helio.services

import com.helio.domain.engine.DatasetRowValidator.FieldError

/** HEL-1087 design.md D5: the failure channel of `PanelService.submitForm` (and, upstream,
 *  `DataSourceService.appendFormRow`) — an ordinary `ServiceError` (status code + `message`)
 *  carrying an ADDITIONAL, possibly-empty set of structured `fieldErrors`. `PanelRoutes
 *  .completeSubmit` renders `FieldValidationErrorResponse(message, fieldErrors)` when
 *  `fieldErrors` is non-empty, else the plain `ErrorResponse(message)` every other route already
 *  emits (D5) — a 403/404/non-form-400 carries no field errors and renders exactly like any
 *  other `ServiceError`. */
final case class FormSubmitError(
    err:         ServiceError,
    fieldErrors: Vector[FieldError] = Vector.empty,
    // HEL-1784: set where each failure is produced, so what a non-owner submitter is told never depends on matching
    // a message string.
    reason:      FormSubmitError.Reason = FormSubmitError.Reason.Other
)

object FormSubmitError {
  sealed trait Reason
  object Reason {
    /** The row failed validation (the form's own rules, the dataset's declaration or the counter row shape). */
    case object FieldErrors extends Reason
    /** The append would exceed the dataset's row cap. */
    case object RowLimit    extends Reason
    /** The bound source is not a dataset. */
    case object SourceKind  extends Reason
    /** Everything else: not found, forbidden, not a form panel. */
    case object Other       extends Reason
  }

  def apply(err: ServiceError): FormSubmitError = FormSubmitError(err, Vector.empty, Reason.Other)

  /** Builds the `400` case from a non-empty set of structured field errors, joining them into a
   *  human-readable `message` (mirrors the row-append API's existing `"; "`-joined summary
   *  style — `field '<name>' — <reason>` per error). */
  def fromFieldErrors(errors: Vector[FieldError]): FormSubmitError = {
    val message = errors.map(e => s"field '${e.field}' — ${e.reason}").mkString("; ")
    FormSubmitError(ServiceError.BadRequest(message), errors, Reason.FieldErrors)
  }
}
