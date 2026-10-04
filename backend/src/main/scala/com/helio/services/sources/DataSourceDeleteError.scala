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

/** The four teardown-compatible fields (matching `TeardownConflictResponse`'s shape) plus the referencing
 *  pipelines and form panels the caller may see (HEL-989 `any-reference`, widened by HEL-1252 from roots
 *  to every persisted reference kind). `pipelines`/`panels` omit anything the caller cannot access; those
 *  contribute only the counts `hiddenPipelineCount`/`hiddenPanelCount` (counts only, never an identity) and an
 *  unnamed mention in `reason`. */
final case class DataSourceDeleteConflict(
    resourceKind: String,
    resourceId: String,
    resourceName: String,
    reason: String,
    pipelines: Vector[DataSourceDeleteConflictPipeline] = Vector.empty,
    panels: Vector[DataSourceDeleteConflictPanel] = Vector.empty,
    // HEL-1252: counts of referencing resources the caller cannot see -- COUNTS ONLY, never an identity (C2).
    hiddenPipelineCount: Int = 0,
    hiddenPanelCount: Int = 0
)

/** `references` lists the kinds this pipeline holds on the source: root, join, lookup, union, upsertTarget. */
final case class DataSourceDeleteConflictPipeline(id: String, name: String, references: Vector[String] = Vector.empty)

final case class DataSourceDeleteConflictPanel(id: String, title: String, dashboardId: String, dashboardName: String)
