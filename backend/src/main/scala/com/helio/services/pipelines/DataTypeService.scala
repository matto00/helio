package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.domain.engine.ExpressionEvaluator
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.pipelines.{ComputedFieldPayload, UpdateDataTypeRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository}
import spray.json.JsObject

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/types`. Light service — CRUD + expression
 *  validation. */
final class DataTypeService(
    dataTypeRepo:    DataTypeRepository,
    dataTypeRowRepo: DataTypeRowRepository,
    dataSourceRepo:  DataSourceRepository,
    // HEL-477: nullable-optional wiring mirrors this file's other DI.
    auditService: AuditService = null
)(implicit ec: ExecutionContext) {

  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, "data_type", resourceId, JsObject.empty)

  // ── Read ──────────────────────────────────────────────────────────────────

  /** `tag`, when given, exact-matches (HEL-366 tasks.md 2.5) — `None` is the
   *  pre-existing unfiltered behavior. */
  def findAll(user: AuthenticatedUser, page: Page, tag: Option[String] = None): Future[PagedResult[DataType]] =
    dataTypeRepo.findAll(user.id, page, tag)

  def findById(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    dataTypeRepo.findByIdOwned(id, user).map {
      case Some(dt) => Right(dt)
      case None     => Left(ServiceError.NotFound("DataType not found"))
    }

  /** `limit`/`excludeKeys` forward straight to the repo AFTER the
   *  `findByIdOwned` ownership check below — no new RLS surface (HEL-372
   *  design.md D4). Defaults (`None`/`Set.empty`) preserve the exact prior
   *  unbounded/full-content behavior for every existing caller. */
  def listRows(
      id: DataTypeId,
      user: AuthenticatedUser,
      limit: Option[Int] = None,
      excludeKeys: Set[String] = Set.empty
  ): Future[Either[ServiceError, Vector[JsObject]]] =
    dataTypeRepo.findByIdOwned(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("DataType not found")))
      case Some(_) =>
        if (dataTypeRowRepo == null)
          Future.successful(Right(Vector.empty))
        else
          dataTypeRowRepo.listRows(id.value, limit, excludeKeys).map(rows => Right(rows))
    }

  def validateExpression(id: DataTypeId, expr: String, user: AuthenticatedUser): Future[Either[ServiceError, ExpressionValidationResult]] =
    dataTypeRepo.findByIdOwned(id, user).map {
      case None     => Left(ServiceError.NotFound("DataType not found"))
      case Some(dt) =>
        val fieldNames = dt.fields.map(_.name).toSet
        // validateTolerant (not the pipeline compute step's strict validate): DataType
        // computed fields are a separate feature whose save path hard-blocks on
        // validation failure, so this preserves today's bare-identifier-accepting
        // behavior unchanged (design.md Decision 4, "DataTypeService boundary").
        ExpressionEvaluator.validateTolerant(expr, fieldNames) match {
          case Right(_)  => Right(ExpressionValidationResult(valid = true, message = None))
          case Left(msg) => Right(ExpressionValidationResult(valid = false, message = Some(msg)))
        }
    }

  // ── Update / delete (ACL-gated) ───────────────────────────────────────────

  def update(
      id: DataTypeId,
      request: UpdateDataTypeRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, DataType]] =
    dataTypeRepo.findByIdOwned(id, user).flatMap {
      case None     => Future.successful(Left(ServiceError.NotFound("DataType not found")))
      case Some(existing) => applyUpdate(existing, request, user)
    }

  private def applyUpdate(existing: DataType, request: UpdateDataTypeRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] = {
    val incomingComputedFields: Vector[ComputedFieldPayload] =
      request.computedFields.getOrElse(Vector.empty)

    val tooLong = incomingComputedFields.find(_.expression.length > RequestValidation.MaxExpressionLength)
    tooLong match {
      case Some(cf) =>
        Future.successful(Left(ServiceError.BadRequest(
          s"Expression for field '${cf.name}' exceeds maximum length of ${RequestValidation.MaxExpressionLength} characters"
        )))
      case None =>
        val updatedRegularFields = request.fields
          .map(_.map(p => DataField(p.name, p.displayName, p.dataType, p.nullable)))
          .getOrElse(existing.fields)
        val fieldNames = updatedRegularFields.map(_.name).toSet

        val exprError = incomingComputedFields.foldLeft(Option.empty[String]) {
          case (Some(err), _) => Some(err)
          case (None, cf) =>
            // validateTolerant, matching validateExpression above — see comment there.
            ExpressionEvaluator.validateTolerant(cf.expression, fieldNames) match {
              case Left(msg) => Some(s"Invalid expression for computed field '${cf.name}': $msg")
              case Right(_)  => None
            }
        }

        exprError match {
          case Some(msg) =>
            Future.successful(Left(ServiceError.BadRequest(msg)))
          case None =>
            val now = Instant.now()
            val updatedComputedFields = request.computedFields
              .map(_.map(p => ComputedField(p.name, p.displayName, p.expression, p.dataType)))
              .getOrElse(existing.computedFields)
            val updated = existing.copy(
              name           = request.name.getOrElse(existing.name),
              fields         = updatedRegularFields,
              computedFields = updatedComputedFields,
              updatedAt      = now
            )
            dataTypeRepo.update(updated, user).map {
              case Some(dt) =>
                audit("data_type.update", Some(dt.id.value), user)
                Right(dt)
              case None     => Left(ServiceError.NotFound("DataType not found"))
            }
        }
    }
  }

  def delete(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    dataTypeRepo.findByIdOwned(id, user).flatMap {
      case None     => Future.successful(Left(ServiceError.NotFound("DataType not found")))
      case Some(dt) =>
        checkSourceLink(dt).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  =>
            dataTypeRepo.existsBoundToAnyOwnedPanel(id, user).flatMap {
              case true =>
                Future.successful(Left(ServiceError.Conflict("Cannot delete DataType: one or more panels are bound to it")))
              case false =>
                dataTypeRepo.delete(id, user).map { _ =>
                  audit("data_type.delete", Some(id.value), user)
                  Right(())
                }
            }
        }
    }

  /** Reject the delete when the DataType is the auto-inferred schema of a
   *  still-existing DataSource. Without this guard, the user can delete a
   *  source's schema row from the Type Registry sidebar and the Sources page
   *  silently renders no schema for the orphaned source (HEL-256).
   *
   *  Uses `findByIdInternal` (privileged): this is error-message rendering only —
   *  the source name is shown to the user who already owns the DataType that
   *  links to it.  No data is returned about the source's content.
   *
   *  HEL-366 cross-reference: `WorkspaceTeardownRepository.sourceLinkConflict`
   *  reimplements a narrow, tag-scoped, app-pool variant of this same
   *  existence check for the bulk-teardown path — it cannot call this method
   *  (privileged pool via `findByIdInternal`, not composable into teardown's
   *  app-pool transaction; see design.md Decision 3/6). A future schema
   *  change to `sourceId`'s semantics here is a prompt to check that method
   *  too. */
  private def checkSourceLink(dt: DataType): Future[Either[ServiceError, Unit]] =
    dt.sourceId match {
      case None => Future.successful(Right(()))
      case Some(srcId) =>
        dataSourceRepo.findByIdInternal(srcId).map {
          case None => Right(())
          case Some(source) =>
            Left(ServiceError.Conflict(
              s"Cannot delete this DataType: it is the auto-inferred schema of data source '${source.name}'. " +
              s"Refresh the source to re-infer its schema, or delete the source first."
            ))
        }
    }
}

object DataTypeService {
  /** Result of `DataTypeService.validateExpression` — mirrors the wire shape
   *  of `ValidateExpressionResponse` so the route can pass it through
   *  unchanged. */

  /** Structured-category field names in `fields` beyond the first `limit`, in
   *  declared order (HEL-373 design.md D1 round-1/round-3 fix). Shared by
   *  both `WorkspaceContextService` (SQL-tier `excludeKeys` extension for
   *  `computeColumnStats`'s own fetch) and `DataTypeRoutes` (the `/rows`
   *  route's `maxStructuredColumns` param) — ONE implementation, no
   *  duplication, since both already depend on `DataTypeService`.
   *
   *  A field whose `dataType` doesn't parse via `DataFieldType.fromString` is
   *  conservatively excluded from the Structured set entirely — never counted
   *  toward the first `limit`, never in the overflow set either — mirroring
   *  `WorkspaceContextService.fieldCategory`'s existing convention. */
  def overflowStructuredFieldNames(fields: Vector[DataField], limit: Int): Set[String] =
    fields
      .filter(f => DataFieldType.fromString(f.dataType).map(DataFieldType.category).contains(FieldTypeCategory.Structured))
      .drop(limit)
      .map(_.name)
      .toSet
}

final case class ExpressionValidationResult(valid: Boolean, message: Option[String])
