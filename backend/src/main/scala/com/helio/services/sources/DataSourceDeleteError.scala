package com.helio.services.sources

import com.helio.services.ServiceError

/** HEL-987 design.md Decision 3: the structured 409 body for `DataSourceService.delete`,
 *  carried by a wrapper type -- NOT `ServiceError.Conflict`, which is `Conflict(message: String)`
 *  and cannot hold four fields. Mirrors `AuthoringError`'s precedent exactly: `serviceError`
 *  (here `err`) still drives the HTTP status/message via `ServiceResponse.statusCodeFor`, and
 *  `conflict` is the OPTIONAL, route-branchable extra payload -- `None` for every other failure
 *  (404/403/etc.), so the route renders those with the pre-existing bare `ErrorResponse(err.
 *  message)` shape, unchanged. */
final case class DataSourceDeleteError(conflict: Option[DataSourceDeleteConflict], err: ServiceError)

object DataSourceDeleteError {
  def plain(err: ServiceError): DataSourceDeleteError = DataSourceDeleteError(None, err)

  def conflict(c: DataSourceDeleteConflict): DataSourceDeleteError =
    DataSourceDeleteError(Some(c), ServiceError.Conflict(c.reason))
}

/** The four teardown-compatible fields (matching `TeardownConflictResponse`'s shape) naming the
 *  pipeline that blocks this delete (design.md Decision 1: sole-root-only). */
final case class DataSourceDeleteConflict(
    resourceKind: String,
    resourceId: String,
    resourceName: String,
    reason: String
)
