package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreateMetricRequest, UpdateMetricRequest}
import com.helio.domain._
import com.helio.infrastructure.{DataTypeRepository, MetricRepository}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/metrics` (HEL-493, 418-B — the Semantic/Metric
 *  Layer epic's REST surface on top of HEL-446's `MetricRepository`).
 *
 *  Create/update validate, in order: `name` non-empty; `dataTypeId` resolves
 *  to a caller-owned, pipeline-output DataType (`sourceId == None` — the V41
 *  rule, reusing the check pattern in
 *  `DashboardProposalService.preValidateBindings` per design.md Decision 2,
 *  not the helper itself — that method is panel-shaped and lives in a
 *  different concern); `measureField` and every `allowedDimensions` entry
 *  are field names of that DataType; `aggregation` is in
 *  `MetricAggregation.values`. Binding-shape failures return
 *  `ServiceError.UnprocessableEntity` (422); a structurally-empty `name`
 *  returns `ServiceError.BadRequest` (400) — matching the AC's explicit
 *  422/400 split. */
final class MetricService(
    metricRepo:   MetricRepository,
    dataTypeRepo: DataTypeRepository
)(implicit ec: ExecutionContext) {

  // ── Read ──────────────────────────────────────────────────────────────────

  def findAll(user: AuthenticatedUser, page: Page): Future[PagedResult[MetricDefinition]] =
    metricRepo.findAll(user.id, page)

  def findById(id: MetricId, user: AuthenticatedUser): Future[Either[ServiceError, MetricDefinition]] =
    metricRepo.findByIdOwned(id, user).map {
      case Some(m) => Right(m)
      case None    => Left(ServiceError.NotFound("Metric not found"))
    }

  /** Owner-scoped "where used" read (HEL-560 tasks.md 1.2): 404 via
   *  `findByIdOwned` first, matching every other per-id metric route, then
   *  the repository's usage query. */
  def usage(id: MetricId, user: AuthenticatedUser): Future[Either[ServiceError, MetricUsage]] =
    metricRepo.findByIdOwned(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Metric not found")))
      case Some(_) =>
        metricRepo.usage(id, user).map(panels => Right(MetricUsage(id, panels.size, panels)))
    }

  // ── Create ────────────────────────────────────────────────────────────────

  def create(req: CreateMetricRequest, user: AuthenticatedUser): Future[Either[ServiceError, MetricDefinition]] =
    RequestValidation.validateMetricName(req.name) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(name) =>
        resolveAndValidateDataType(req.dataTypeId, req.measureField, req.allowedDimensions, req.aggregation, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(dt) =>
            val now = Instant.now()
            val metric = MetricDefinition(
              id                = MetricId(UUID.randomUUID().toString),
              ownerId           = user.id,
              dataTypeId        = dt.id,
              name              = name,
              description       = req.description.map(_.trim).filter(_.nonEmpty),
              measureField      = req.measureField,
              aggregation       = req.aggregation,
              allowedDimensions = req.allowedDimensions,
              format            = req.format.getOrElse(MetricFormat(None, None, None, None)),
              deprecated        = false,
              createdAt         = now,
              updatedAt         = now
            )
            metricRepo.insert(metric, user).map {
              case Right(m)  => Right(m)
              case Left(err) => Left(ServiceError.UnprocessableEntity(err))
            }
        }
    }

  // ── Update (ACL-gated) ────────────────────────────────────────────────────

  def update(id: MetricId, req: UpdateMetricRequest, user: AuthenticatedUser): Future[Either[ServiceError, MetricDefinition]] =
    metricRepo.findByIdOwned(id, user).flatMap {
      case None           => Future.successful(Left(ServiceError.NotFound("Metric not found")))
      case Some(existing) => applyUpdate(existing, req, user)
    }

  /** `dataTypeId` is not independently patchable (not in the ticket's field
   *  list) — `measureField`/`allowedDimensions`/`aggregation` are always
   *  re-validated against the metric's existing (unchanged) `dataTypeId`, so
   *  a `PATCH` that only touches `name` still re-runs the full binding check
   *  (design.md Decision 3, mirroring `DataTypeService.applyUpdate`/
   *  `AlertRuleService.applyUpdate`). */
  private def applyUpdate(existing: MetricDefinition, req: UpdateMetricRequest, user: AuthenticatedUser): Future[Either[ServiceError, MetricDefinition]] = {
    val nameResult: Either[ServiceError, String] = req.name match {
      case None    => Right(existing.name)
      case Some(n) => RequestValidation.validateMetricName(n).left.map(ServiceError.BadRequest(_))
    }

    nameResult match {
      case Left(err) => Future.successful(Left(err))
      case Right(name) =>
        val measureField      = req.measureField.getOrElse(existing.measureField)
        val aggregation       = req.aggregation.getOrElse(existing.aggregation)
        val allowedDimensions = req.allowedDimensions.getOrElse(existing.allowedDimensions)
        val description       = req.description.fold(existing.description)(identity)
        val format             = req.format.fold(existing.format)(_.getOrElse(MetricFormat(None, None, None, None)))
        val deprecated         = req.deprecated.getOrElse(existing.deprecated)

        resolveAndValidateDataType(existing.dataTypeId.value, measureField, allowedDimensions, aggregation, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            val updated = existing.copy(
              name              = name,
              description       = description,
              measureField      = measureField,
              aggregation       = aggregation,
              allowedDimensions = allowedDimensions,
              format            = format,
              deprecated        = deprecated,
              updatedAt         = Instant.now()
            )
            metricRepo.update(updated, user).map {
              case Right(Some(m)) => Right(m)
              case Right(None)    => Left(ServiceError.NotFound("Metric not found"))
              case Left(err)      => Left(ServiceError.UnprocessableEntity(err))
            }
        }
    }
  }

  // ── Delete (ACL-gated) ────────────────────────────────────────────────────

  /** Deletes the metric and returns the number of panels that were bound to
   *  it at deletion time (HEL-560 design.md D2) — those panels are unbound
   *  via the `ON DELETE SET NULL` FK (V76/HEL-500), the count just travels
   *  back so `MetricRoutes` can surface it in the `X-Unbound-Panel-Count`
   *  response header. Computed BEFORE the delete so the join still resolves
   *  the (about to be removed) `metric_id` rows. */
  def delete(id: MetricId, user: AuthenticatedUser): Future[Either[ServiceError, Int]] =
    metricRepo.findByIdOwned(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Metric not found")))
      case Some(_) =>
        metricRepo.countBoundPanels(id, user).flatMap { count =>
          metricRepo.delete(id, user).map {
            case true  => Right(count)
            case false => Left(ServiceError.NotFound("Metric not found"))
          }
        }
    }

  // ── Validation ────────────────────────────────────────────────────────────

  /** Resolves `dataTypeId` (owner-scoped) and validates, in the AC's order:
   *  the DataType exists and is owned by the caller; it is a pipeline-output
   *  DataType (`sourceId` absent); `measureField` and every
   *  `allowedDimensions` entry are field names of that DataType; `aggregation`
   *  is in the allow-list. Returns the resolved `DataType` on success so
   *  `create` can pull its (already-validated) `id` without a second lookup
   *  (design.md Decision 2). */
  private def resolveAndValidateDataType(
      dataTypeId: String,
      measureField: String,
      allowedDimensions: Vector[String],
      aggregation: String,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, DataType]] =
    dataTypeRepo.findByIdOwned(DataTypeId(dataTypeId), user).map {
      case None =>
        Left(ServiceError.UnprocessableEntity(
          s"dataTypeId does not resolve to a DataType owned by the caller: $dataTypeId"
        ))
      case Some(dt) if dt.sourceId.isDefined =>
        Left(ServiceError.UnprocessableEntity(
          "Metrics can only bind to pipeline-output DataTypes (dataTypeId's sourceId must be absent)"
        ))
      case Some(dt) =>
        val fieldNames  = dt.fields.map(_.name).toSet
        val unknownRefs = (Vector(measureField) ++ allowedDimensions).distinct.filterNot(fieldNames.contains)
        if (unknownRefs.nonEmpty)
          Left(ServiceError.UnprocessableEntity(
            s"measureField/allowedDimensions must be fields of the bound DataType; unknown: ${unknownRefs.mkString(", ")}"
          ))
        else
          MetricAggregation.validate(aggregation) match {
            case Left(err) => Left(ServiceError.UnprocessableEntity(err))
            case Right(_)  => Right(dt)
          }
    }
}
