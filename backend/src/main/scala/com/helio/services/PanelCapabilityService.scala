package com.helio.services

import com.helio.api.protocols.{PanelCapabilitiesResponse, PanelCapabilityColumnResponse, PanelCapabilityResponse}
import com.helio.domain.panels.{PanelBindingSpec, SlotEligibility}
import com.helio.domain.{AuthenticatedUser, DataFieldType, DataType, DataTypeId, PanelType}
import com.helio.infrastructure.{DataTypeRepository, DataTypeRowRepository}

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `GET /api/types/:id/panel-capabilities` (HEL-365).
 *
 *  Given an owner-scoped DataType, reports which of the five data-bindable
 *  panel kinds (`PanelBindingSpec.DataBindable`) are structurally bindable,
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
  private val MissingColumnsReason: String = "missing-required-column-type"

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
    val capabilities = PanelBindingSpec.DataBindable.map { spec =>
      PanelType.asString(spec.panelType) -> capabilityFor(spec, columns, isPipelineOutput)
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
      spec: PanelBindingSpec,
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
      val eligible = spec.allSlots.map(slot => slot -> eligibleColumnNames(spec, slot, columns)).toMap
      // design.md D3: bindable = every required slot has >=1 eligible
      // column. `table` (no slots) is vacuously true. `chart`/`timeline`'s
      // "+ >=1 column total" clause is subsumed automatically — a numeric
      // (resp. orderable) column is itself a column, so `xAxis`/`event`
      // (eligibility `Any`) are already non-empty whenever `yAxis`/`time` is.
      val requiredSatisfied = spec.requiredSlots.forall(slot => eligible.getOrElse(slot, Vector.empty).nonEmpty)
      if (requiredSatisfied)
        PanelCapabilityResponse(
          bindable        = true,
          requiredSlots   = spec.requiredSlots,
          optionalSlots   = spec.optionalSlots,
          eligibleColumns = eligible,
          reason          = None,
          message         = None
        )
      else
        PanelCapabilityResponse(
          bindable        = false,
          requiredSlots   = spec.requiredSlots,
          optionalSlots   = spec.optionalSlots,
          eligibleColumns = eligible,
          reason          = Some(MissingColumnsReason),
          message         = Some(s"No column satisfies a required slot for '${PanelType.asString(spec.panelType)}'")
        )
    }

  private def eligibleColumnNames(
      spec: PanelBindingSpec,
      slotKey: String,
      columns: Vector[PanelCapabilityColumnResponse]
  ): Vector[String] = {
    val eligibility = spec.eligibilityOf(slotKey)
    columns.filter(c => DataFieldType.fromString(c.dataType).exists(t => SlotEligibility.accepts(eligibility, t))).map(_.name)
  }
}
