package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{PanelCapabilitiesResponse, PanelCapabilityColumnResponse, PanelCapabilityResponse}
import com.helio.domain.panels.OutputBindingSpec
import com.helio.domain.model.{AuthenticatedUser, DataFieldType, DataType, DataTypeId, OutputKind}
import com.helio.domain.engine.SchemaField
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository}

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `GET /api/types/:id/panel-capabilities` (HEL-365).
 *
 *  Given an owner-scoped DataType, reports which of the six Output kinds
 *  (`OutputBindingSpec.All` — HEL-904: rewired from the retired
 *  `PanelBindingSpec.DataBindable`) are structurally bindable,
 *  each kind's required/optional `fieldMapping` slots, the columns eligible
 *  per slot, and coarse shape signals (columns+types, row count,
 *  single-row flag, pipeline-output vs. source-companion).
 *
 *  Kept separate from [[DataTypeService]] (CRUD-only per its own doc
 *  comment, design.md D6) even though both resolve the same DataType. */
final class PanelCapabilityService(
    dataTypeRepo:    DataTypeRepository,
    dataTypeRowRepo: DataTypeRowRepository
)(implicit ec: ExecutionContext) {

  // The exact literal text `PanelService.rejectCompanionBinding` 400s with
  // (PanelService.scala:306) — a companion DataType's capability report must
  // be traceable to the real bind-time rejection, not a paraphrase.
  private val NotPipelineOutputReason: String = "not-pipeline-output"
  private val NotPipelineOutputMessage: String = "Panels can only bind to pipeline-output data types"

  def getCapabilities(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, PanelCapabilitiesResponse]] =
    // findByIdOwned, exactly like DataTypeService.findById (design.md D5):
    // None covers both "doesn't exist" and "belongs to another owner" —
    // both map to 404, never 403 (existence-not-leaked).
    dataTypeRepo.findByIdOwned(id, user).flatMap {
      case None     => Future.successful(Left(ServiceError.NotFound("DataType not found")))
      case Some(dt) => rowCountOf(id).map(rowCount => Right(build(dt, rowCount)))
    }

  // Mirrors DataTypeService.listRows's null-checked pattern: fixtures that
  // don't wire a DataTypeRowRepository get a 0 row count instead of an NPE.
  private def rowCountOf(id: DataTypeId): Future[Int] =
    if (dataTypeRowRepo == null) Future.successful(0)
    else dataTypeRowRepo.listRows(id.value).map(_.size)

  private def build(dt: DataType, rowCount: Int): PanelCapabilitiesResponse = {
    val columns          = columnsOf(dt)
    val isPipelineOutput = dt.sourceId.isEmpty
    val capabilities = OutputBindingSpec.All.map { spec =>
      OutputKind.asString(spec.outputKind) -> capabilityFor(spec, columns, isPipelineOutput)
    }.toMap

    PanelCapabilitiesResponse(
      dataTypeId       = dt.id.value,
      isPipelineOutput = isPipelineOutput,
      columns          = columns,
      rowCount         = rowCount,
      singleRow        = rowCount == 1,
      capabilities     = capabilities
    )
  }

  // Regular fields + computed fields, in that order — mirrors the frontend's
  // fieldOptions() (frontend/src/features/panels/ui/editors/fieldOptions.ts),
  // which offers both as bindable fieldMapping targets.
  private def columnsOf(dt: DataType): Vector[PanelCapabilityColumnResponse] = {
    val regular = dt.fields.flatMap(f => wireType(f.dataType).map(t => PanelCapabilityColumnResponse(f.name, t, f.nullable)))
    val computed = dt.computedFields.flatMap(cf => wireType(cf.dataType).map(t => PanelCapabilityColumnResponse(cf.name, t, nullable = false)))
    regular ++ computed
  }

  // Round-trips through DataFieldType so an unrecognized `dataType` string
  // (never a real value the domain writes, but not worth throwing over) is
  // silently dropped rather than surfaced with a made-up wire type.
  private def wireType(raw: String): Option[String] = DataFieldType.fromString(raw).map(DataFieldType.asString)

  private def capabilityFor(
      spec: OutputBindingSpec,
      columns: Vector[PanelCapabilityColumnResponse],
      isPipelineOutput: Boolean
  ): PanelCapabilityResponse =
    if (!isPipelineOutput)
      PanelCapabilityResponse(
        bindable        = false,
        requiredSlots   = spec.requiredSlots,
        optionalSlots   = spec.optionalSlots,
        eligibleColumns = Map.empty,
        reason          = Some(NotPipelineOutputReason),
        message         = Some(NotPipelineOutputMessage)
      )
    else {
      // design.md D3 / HEL-364 task 1.2: bindability itself is delegated to
      // the shared `PanelBindingSpec.evaluate` (behavior-preserving
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
