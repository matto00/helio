package com.helio.services

import com.helio.api.protocols.{CreateAlertRuleRequest, UpdateAlertRuleRequest}
import com.helio.domain._
import com.helio.infrastructure.{AlertRuleRepository, DataTypeRepository}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/alert-rules` (mirrors `DataTypeService`'s shape).
 *  Storage-only (HEL-447) — no evaluation of rules happens here (HEL-455). */
final class AlertRuleService(
    alertRuleRepo: AlertRuleRepository,
    dataTypeRepo:  DataTypeRepository
)(implicit ec: ExecutionContext) {

  // ── Read ──────────────────────────────────────────────────────────────────

  def findAll(user: AuthenticatedUser): Future[Vector[AlertRule]] =
    alertRuleRepo.findAll(user.id)

  def findById(id: AlertRuleId, user: AuthenticatedUser): Future[Either[ServiceError, AlertRule]] =
    alertRuleRepo.findByIdOwned(id, user).map {
      case Some(rule) => Right(rule)
      case None       => Left(ServiceError.NotFound("Alert rule not found"))
    }

  // ── Create ────────────────────────────────────────────────────────────────

  def create(req: CreateAlertRuleRequest, user: AuthenticatedUser): Future[Either[ServiceError, AlertRule]] = {
    val name          = req.name.trim
    val metric        = req.metric.trim
    val targetIdInput = req.targetDataTypeId.trim

    if (name.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (metric.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("metric is required")))
    else if (targetIdInput.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("targetDataTypeId is required")))
    else {
      val validated = for {
        severity <- Severity.fromString(req.severity).left.map(ServiceError.BadRequest(_))
        _        <- validateCondition(req.condition)
      } yield severity

      validated match {
        case Left(err) => Future.successful(Left(err))
        case Right(severity) =>
          val targetDataTypeId = DataTypeId(targetIdInput)
          // Owner-scoped (not *Internal): a non-existent or non-owned target
          // is indistinguishable here, matching the ACL triad's
          // existence-not-leaked semantics (CONTRIBUTING.md).
          dataTypeRepo.findByIdOwned(targetDataTypeId, user).flatMap {
            case None =>
              Future.successful(Left(ServiceError.UnprocessableEntity(
                s"Target DataType not found or not owned by caller: $targetIdInput"
              )))
            case Some(_) =>
              val now = Instant.now()
              val rule = AlertRule(
                id               = AlertRuleId(UUID.randomUUID().toString),
                ownerId          = user.id,
                targetDataTypeId = targetDataTypeId,
                metric           = metric,
                // spray-json omits `None` on the wire — `enabled` defaults to
                // `true` when absent from the request body (AC: "Absent
                // optional fields normalize at the boundary").
                condition        = req.condition,
                name             = name,
                enabled          = req.enabled.getOrElse(true),
                severity         = severity,
                createdAt        = now,
                updatedAt        = now
              )
              alertRuleRepo.insert(rule, user).map(Right(_))
          }
      }
    }
  }

  // ── Update / delete (ACL-gated) ──────────────────────────────────────────

  def update(id: AlertRuleId, req: UpdateAlertRuleRequest, user: AuthenticatedUser): Future[Either[ServiceError, AlertRule]] =
    alertRuleRepo.findByIdOwned(id, user).flatMap {
      case None           => Future.successful(Left(ServiceError.NotFound("Alert rule not found")))
      case Some(existing) => applyUpdate(existing, req, user)
    }

  private def applyUpdate(existing: AlertRule, req: UpdateAlertRuleRequest, user: AuthenticatedUser): Future[Either[ServiceError, AlertRule]] = {
    val severityResult: Either[ServiceError, Severity] = req.severity match {
      case None    => Right(existing.severity)
      case Some(s) => Severity.fromString(s).left.map(ServiceError.BadRequest(_))
    }
    val conditionResult: Either[ServiceError, JsValue] = req.condition match {
      case None    => Right(existing.condition)
      case Some(c) => validateCondition(c).map(_ => c)
    }

    (severityResult, conditionResult) match {
      case (Left(err), _) => Future.successful(Left(err))
      case (_, Left(err)) => Future.successful(Left(err))
      case (Right(severity), Right(condition)) =>
        val updated = existing.copy(
          metric    = req.metric.map(_.trim).filter(_.nonEmpty).getOrElse(existing.metric),
          condition = condition,
          name      = req.name.map(_.trim).filter(_.nonEmpty).getOrElse(existing.name),
          enabled   = req.enabled.getOrElse(existing.enabled),
          severity  = severity,
          updatedAt = Instant.now()
        )
        alertRuleRepo.update(updated, user).map {
          case Some(rule) => Right(rule)
          case None       => Left(ServiceError.NotFound("Alert rule not found"))
        }
    }
  }

  def delete(id: AlertRuleId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    alertRuleRepo.findByIdOwned(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Alert rule not found")))
      case Some(_) =>
        alertRuleRepo.delete(id, user).map {
          case true  => Right(())
          case false => Left(ServiceError.NotFound("Alert rule not found"))
        }
    }

  // ── Validation ────────────────────────────────────────────────────────────

  /** Validates that `condition` is a JSON object carrying a well-formed
   *  `comparator` (one of `Comparator`'s wire values) and a numeric
   *  `threshold`. Everything else inside the blob — including unknown/extra
   *  keys future condition kinds add — passes through untouched; this method
   *  never destructures or rewrites `condition`. */
  private def validateCondition(condition: JsValue): Either[ServiceError, Unit] =
    condition match {
      case obj: JsObject =>
        val comparatorCheck: Either[ServiceError, Unit] = obj.fields.get("comparator") match {
          case Some(JsString(c)) => Comparator.fromString(c).map(_ => ()).left.map(ServiceError.BadRequest(_))
          case Some(_)           => Left(ServiceError.BadRequest("condition.comparator must be a string"))
          case None              => Left(ServiceError.BadRequest("condition.comparator is required"))
        }
        comparatorCheck.flatMap { _ =>
          obj.fields.get("threshold") match {
            case Some(_: JsNumber) => Right(())
            case Some(_)           => Left(ServiceError.BadRequest("condition.threshold must be a number"))
            case None              => Left(ServiceError.BadRequest("condition.threshold is required"))
          }
        }
      case _ =>
        Left(ServiceError.BadRequest("condition must be a JSON object"))
    }
}
