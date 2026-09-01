package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{PanelCapabilitiesResponse, PanelCapabilityColumnResponse, PanelCapabilityResponse}
import com.helio.domain.panels.OutputBindingSpec
import com.helio.domain.model.{AuthenticatedUser, DataFieldType, Output, OutputId, OutputKind}
import com.helio.domain.engine.SchemaField
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for every internal caller that needs panel-capability shape signals
 *  (`RefinementGrounding`, `DashboardAuthoringService`, `AssistantToolExecutor`,
 *  `AssistantService`). HEL-904 cycle 29: the route this originally backed
 *  (`GET /api/types/:id/panel-capabilities`) was already deleted outright alongside
 *  `DataTypeRoutes` in task 4.1 — this class's own doc comment (and the design.md text it cited)
 *  had gone stale claiming the route was "still-live"; corrected here so P1.3 doesn't inherit a
 *  false premise (P1.3's own ticket body already correctly assumes the route is gone).
 *
 *  Given an owner-scoped Output, reports which of the six Output kinds
 *  (`OutputBindingSpec.All` — HEL-904: rewired from the retired
 *  `PanelBindingSpec.DataBindable`) are structurally bindable,
 *  each kind's required/optional `fieldMapping` slots, the columns eligible
 *  per slot, and coarse shape signals (columns+types, row count,
 *  single-row flag).
 *
 *  HEL-904 task 3.11 rewired this off `DataTypeRepository`/`DataTypeRowRepository` onto
 *  `OutputRepository`/`NodeSnapshotRepository`. Cycle 29 finishes the retarget: the public
 *  `getCapabilities` signature is now keyed by `OutputId` (not the retired `DataTypeId`, which no
 *  longer exists anywhere in `model.scala`) — every caller (`RefinementGrounding`,
 *  `DashboardAuthoringService`, `AssistantToolExecutor`) now wraps its bare id string directly in
 *  `OutputId(...)` at the call site, matching what this class actually resolves. */
final class PanelCapabilityService(
    outputRepo:       OutputRepository,
    nodeSnapshotRepo: NodeSnapshotRepository
)(implicit ec: ExecutionContext) {

  def getCapabilities(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, PanelCapabilitiesResponse]] =
    // findByIdOwned: None covers both "doesn't exist" and "belongs to another owner" —
    // both map to 404, never 403 (existence-not-leaked).
    outputRepo.findByIdOwned(id, user).flatMap {
      case None         => Future.successful(Left(ServiceError.NotFound("Output not found")))
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
      outputId         = output.id.value,
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
