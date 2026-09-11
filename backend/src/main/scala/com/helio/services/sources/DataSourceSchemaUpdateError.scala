package com.helio.services.sources

import com.helio.api.protocols.sources.SchemaUpdateConflictResponse
import com.helio.services.ServiceError

/** HEL-1124 design.md Decision 6: the structured 409 body for
 *  `DataSourceService.updateDatasetSchema`, mirroring `DataSourceDeleteError`'s (HEL-987)
 *  precedent exactly -- `err` still drives the HTTP status/message via
 *  `ServiceResponse.statusCodeFor`, and `conflict` is the OPTIONAL, route-branchable structured
 *  payload, `None` for every non-409 failure (404/400/etc.), so the route renders those with the
 *  pre-existing bare `ErrorResponse(err.message)` shape, unchanged. */
final case class DataSourceSchemaUpdateError(conflict: Option[SchemaUpdateConflictResponse], err: ServiceError)

object DataSourceSchemaUpdateError {
  def plain(err: ServiceError): DataSourceSchemaUpdateError = DataSourceSchemaUpdateError(None, err)

  def conflict(body: SchemaUpdateConflictResponse): DataSourceSchemaUpdateError =
    DataSourceSchemaUpdateError(Some(body), ServiceError.Conflict(body.message))
}
