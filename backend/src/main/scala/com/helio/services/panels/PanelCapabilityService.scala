package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{PanelCapabilitiesResponse, PanelCapabilityColumnResponse, PanelCapabilityResponse}
import com.helio.domain.panels.OutputBindingSpec
import com.helio.domain.model.{AuthenticatedUser, DataFieldType, DataTypeId, Output, OutputId, OutputKind}
import com.helio.domain.engine.SchemaField
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `GET /api/types/:id/panel-capabilities` (HEL-365), and (HEL-904 task 3.11)
 *  every internal caller that needs the same shape signals (`RefinementGrounding`,
 *  `DashboardAuthoringService`, `AssistantToolExecutor`, `AssistantService`).
 *
 *  Given an owner-scoped Output, reports which of the six Output kinds
 *  (`OutputBindingSpec.All` — HEL-904: rewired from the retired
 *  `PanelBindingSpec.DataBindable`) are structurally bindable,
 *  each kind's required/optional `fieldMapping` slots, the columns eligible
 *  per slot, and coarse shape signals (columns+types, row count,
 *  single-row flag).
 *
 *  HEL-904 task 3.11: rewired off `DataTypeRepository`/`DataTypeRowRepository` onto
 *  `OutputRepository`/`NodeSnapshotRepository`. The public `getCapabilities` signature is
 *  DELIBERATELY left keyed by `DataTypeId` (not `OutputId`) even though it now resolves an
 *  Output — every caller (the still-live `GET /api/types/:id/panel-capabilities` route,
 *  `RefinementGrounding`, `DashboardAuthoringService`, `AssistantToolExecutor`) already threads a
 *  bare id STRING sourced from `WorkspaceContextDataType.id` (itself an Output's id since task
 *  3.12) through a `DataTypeId(...)` wrapper; retargeting every call site's wrapper type is
 *  section 4/5's wire-shape-renaming job, not this task's. `id.value` is reinterpreted as an
 *  `OutputId` internally, which is safe because both are opaque `String` wrappers over the same
 *  id space post-3.12.
 *
 *  Kept separate from [[com.helio.services.pipelines.DataTypeService]] (CRUD-only per its own doc
 *  comment, design.md D6) even though both used to resolve the same DataType; now resolves an
 *  Output instead. */
final class PanelCapabilityService(
    outputRepo:       OutputRepository,
    nodeSnapshotRepo: NodeSnapshotRepository
)(implicit ec: ExecutionContext) {

  def getCapabilities(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, PanelCapabilitiesResponse]] =
    // findByIdOwned, exactly like DataTypeService.findById used to (design.md D5):
    // None covers both "doesn't exist" and "belongs to another owner" —
    // both map to 404, never 403 (existence-not-leaked).
    outputRepo.findByIdOwned(OutputId(id.value), user).flatMap {
      case None         => Future.successful(Left(ServiceError.NotFound("DataType not found")))
      case Some(output) => rowCountOf(output).map(rowCount => Right(build(output, rowCount)))
    }

  // Mirrors the prior DataTypeRowRepository-null-checked pattern: fixtures that
  // don't wire a NodeSnapshotRepository get a 0 row count instead of an NPE.
  private def rowCountOf(output: Output): Future[Int] =
    if (nodeSnapshotRepo == null) Future.successful(0)
    else nodeSnapshotRepo.listRows(output.node.pipelineId.value, output.node.stepId.map(_.value)).map(_.size)

  private def build(output: Output, rowCount: Int): PanelCapabilitiesResponse = {
    val columns = columnsOf(output)
    // HEL-904 task 3.11: an Output has no source-companion concept at all (that distinction was
    // retired with the DataType/Metric split) -- every Output is, by construction, a projection
    // of a pipeline node, so `isPipelineOutput` is unconditionally `true` and the prior
    // "not-pipeline-output" 400-mirroring branch is now dead-but-harmless (never reached).
    val isPipelineOutput = true
    val capabilities = OutputBindingSpec.All.map { spec =>
      OutputKind.asString(spec.outputKind) -> capabilityFor(spec, columns)
    }.toMap

    PanelCapabilitiesResponse(
      dataTypeId       = output.id.value,
      isPipelineOutput = isPipelineOutput,
      columns          = columns,
      rowCount         = rowCount,
      singleRow        = rowCount == 1,
      capabilities     = capabilities
    )
  }

  // An Output's schema carries only {name, type} (no nullability signal) -- mirrors
  // WorkspaceContextService.toDataTypeEntry's identical `nullable = false` default for the same
  // reason (HEL-904 task 3.12). Outputs have no computed-field concept of their own.
  private def columnsOf(output: Output): Vector[PanelCapabilityColumnResponse] =
    output.schema.flatMap(sf => wireType(sf.`type`).map(t => PanelCapabilityColumnResponse(sf.name, t, nullable = false)))

  // Round-trips through DataFieldType so an unrecognized `type` string
  // (never a real value the domain writes, but not worth throwing over) is
  // silently dropped rather than surfaced with a made-up wire type.
  private def wireType(raw: String): Option[String] = DataFieldType.fromString(raw).map(DataFieldType.asString)

  private def capabilityFor(
      spec: OutputBindingSpec,
      columns: Vector[PanelCapabilityColumnResponse]
  ): PanelCapabilityResponse = {
    // design.md D3 / HEL-364 task 1.2: bindability itself is delegated to
    // the shared `OutputBindingSpec.evaluate` (behavior-preserving
    // extraction — same required-slot-has->=1-eligible-column rule,
    // `table`'s no-slots case still vacuously true). `chart`/`timeline`'s
    // "+ >=1 column total" clause is still subsumed automatically — a
    // numeric (resp. orderable) column is itself a column, so `xAxis`/
    // `event` (eligibility `Any`) are already non-empty whenever
    // `yAxis`/`time` is.
    val schemaColumns = columns.map(c => SchemaField(c.name, c.dataType))
    val result = OutputBindingSpec.evaluate(spec, schemaColumns)
    PanelCapabilityResponse(
      bindable        = result.bindable,
      requiredSlots   = spec.requiredSlots,
      optionalSlots   = spec.optionalSlots,
      eligibleColumns = result.eligibleColumns,
      reason          = result.reason,
      message         = result.message
    )
  }
}
