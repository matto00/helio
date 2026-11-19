package com.helio.services.panels

import com.helio.domain.panels.FormPanelConfig
import com.helio.services.{FormSubmitError, ServiceError}
import com.helio.services.FormSubmitError.Reason

/** What a rejected form submit tells a submitter who is not the form's owner (HEL-1784 design.md D4). Such a submitter
 *  is entitled to the fields the form binds and nothing else about the dataset, so a rejection must not name a declared
 *  field the form does not configure, and must not state the dataset's row cap. The mapping needs only the form's
 *  configured field names, so it cannot be used to probe which names the dataset declares. */
private[panels] object FormSubmitErrorMasking {

  val GenericMismatch: String = "This form no longer matches its dataset. Ask its owner to update it."
  val RowLimit: String        = "This form's dataset can't accept more entries"

  def forNonOwner(config: FormPanelConfig, error: FormSubmitError): FormSubmitError =
    error.reason match {
      case Reason.FieldErrors =>
        val configured = config.fields.map(_.sourceField).toSet
        val kept       = error.fieldErrors.filter(e => configured.contains(e.field))
        if (kept.size == error.fieldErrors.size) error
        else FormSubmitError(ServiceError.BadRequest(GenericMismatch), kept, Reason.FieldErrors)
      case Reason.RowLimit   => FormSubmitError(ServiceError.BadRequest(RowLimit), reason = Reason.RowLimit)
      case Reason.SourceKind => FormSubmitError(ServiceError.BadRequest(GenericMismatch), reason = Reason.SourceKind)
      case Reason.Other      => error
    }
}
