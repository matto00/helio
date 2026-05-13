package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{ComputedFieldPayload, UpdateDataTypeRequest}
import com.helio.domain._
import com.helio.infrastructure.{DataTypeRepository, DataTypeRowRepository}
import spray.json.JsObject

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/types`. Light service — CRUD + expression
 *  validation. */
final class DataTypeService(
    dataTypeRepo:    DataTypeRepository,
    dataTypeRowRepo: DataTypeRowRepository,
    accessChecker:   AccessChecker
)(implicit ec: ExecutionContext) {

  // ── Read ──────────────────────────────────────────────────────────────────

  def findAll(user: AuthenticatedUser): Future[Vector[DataType]] =
    dataTypeRepo.findAll(user.id)

  def findById(id: DataTypeId): Future[Either[ServiceError, DataType]] =
    dataTypeRepo.findById(id).map {
      case Some(dt) => Right(dt)
      case None     => Left(ServiceError.NotFound("DataType not found"))
    }

  def listRows(id: DataTypeId): Future[Either[ServiceError, Vector[JsObject]]] =
    dataTypeRepo.findById(id).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("DataType not found")))
      case Some(_) =>
        if (dataTypeRowRepo == null)
          Future.successful(Right(Vector.empty))
        else
          dataTypeRowRepo.listRows(id.value).map(rows => Right(rows))
    }

  def validateExpression(id: DataTypeId, expr: String): Future[Either[ServiceError, ExpressionValidationResult]] =
    dataTypeRepo.findById(id).map {
      case None     => Left(ServiceError.NotFound("DataType not found"))
      case Some(dt) =>
        val fieldNames = dt.fields.map(_.name).toSet
        ExpressionEvaluator.validate(expr, fieldNames) match {
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
    accessChecker.requireOwnerOnly("data-type", id.value, user, "DataType not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        dataTypeRepo.findById(id).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("DataType not found")))
          case Some(existing) =>
            applyUpdate(existing, request)
        }
    }

  private def applyUpdate(existing: DataType, request: UpdateDataTypeRequest): Future[Either[ServiceError, DataType]] = {
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
            ExpressionEvaluator.validate(cf.expression, fieldNames) match {
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
            dataTypeRepo.update(updated).map {
              case Some(dt) => Right(dt)
              case None     => Left(ServiceError.NotFound("DataType not found"))
            }
        }
    }
  }

  def delete(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    accessChecker.requireOwnerOnly("data-type", id.value, user, "DataType not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        dataTypeRepo.findById(id).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("DataType not found")))
          case Some(_) =>
            dataTypeRepo.isBoundToAnyPanel(id).flatMap {
              case true =>
                Future.successful(Left(ServiceError.Conflict("Cannot delete DataType: one or more panels are bound to it")))
              case false =>
                dataTypeRepo.delete(id).map(_ => Right(()))
            }
        }
    }
}

object DataTypeService {
  /** Result of `DataTypeService.validateExpression` — mirrors the wire shape
   *  of `ValidateExpressionResponse` so the route can pass it through
   *  unchanged. */
}

final case class ExpressionValidationResult(valid: Boolean, message: Option[String])
