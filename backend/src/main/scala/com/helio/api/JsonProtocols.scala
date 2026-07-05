package com.helio.api

import com.helio.api.protocols._

/** Aggregator trait that composes every per-domain protocol trait.
 *
 *  Per-domain traits live under `com.helio.api.protocols` and own their
 *  own case classes, companion-object converters, and `implicit val ...Format`
 *  definitions. This trait carries zero formats of its own — it exists only
 *  to give downstream call sites (routes, tests, repositories) a single
 *  `extends JsonProtocols` mix-in that pulls every JSON formatter into scope.
 *
 *  Inter-trait dependencies (each declared via `extends` inside the per-domain
 *  trait, so the macro resolution order is correct here regardless of order):
 *
 *  - `PanelProtocol      extends ResourceProtocol`     (PanelResponse carries ResourceMetaResponse)
 *  - `DashboardProtocol  extends PanelProtocol`        (DuplicateDashboardResponse + snapshot use panel types)
 *  - `PipelineProtocol   extends DataTypeProtocol`     (PipelineAnalyzeResponse uses SchemaFieldResponse)
 *  - `DataSourceProtocol extends DataTypeProtocol`     (CreateSourceResponse carries DataTypeResponse)
 *
 *  All re-exports for backward compatibility happen via `package object protocols`
 *  / wildcard import below: every case class and companion is in
 *  `com.helio.api.protocols`, and the package object re-exports them into
 *  `com.helio.api` so call sites that say `import com.helio.api._` still see them.
 */
trait JsonProtocols
    extends ResourceProtocol
    with AuthProtocol
    with ApiTokenProtocol
    with PanelProtocol
    with DashboardProtocol
    with DataTypeProtocol
    with DataSourceProtocol
    with PipelineProtocol
    with PermissionProtocol
    with PaginationProtocol
