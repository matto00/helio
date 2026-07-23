package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.AlertEventRepository

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/alerts` (HEL-455, mirrors `AlertRuleService`'s
 *  shape). Every mutation delegates to `AlertEventRepository.applyTransition`,
 *  which performs the owner-scoped lookup, `AlertEventStateMachine.transition`
 *  call, and persist as a single `withUserContext` transaction — so this
 *  service never reads-then-writes across two transactions (which would race
 *  a concurrent caller) and never mutates an `AlertEvent`'s fields by any
 *  path other than `transition` (design.md's single-source-of-truth
 *  guarantee). Producing events from rule evaluation (HEL-466) and delivery
 *  (HEL-432) are out of scope here. */
final class AlertEventService(alertEventRepo: AlertEventRepository)(implicit ec: ExecutionContext) {

  // ── Read ──────────────────────────────────────────────────────────────────

  def findAll(user: AuthenticatedUser, stateFilter: Option[String]): Future[Either[ServiceError, Vector[AlertEvent]]] =
    stateFilter match {
      case None =>
        alertEventRepo.findAll(user.id, None).map(Right(_))
      case Some(raw) =>
        AlertEventState.fromString(raw) match {
          case Left(err)    => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(state) => alertEventRepo.findAll(user.id, Some(state)).map(Right(_))
        }
    }

  def findById(id: AlertEventId, user: AuthenticatedUser): Future[Either[ServiceError, AlertEvent]] =
    alertEventRepo.findByIdOwned(id, user).map {
      case Some(event) => Right(event)
      case None        => Left(ServiceError.NotFound("Alert event not found"))
    }

  // ── Transitions (ACL-gated via AlertEventRepository.applyTransition) ────────

  def acknowledge(id: AlertEventId, user: AuthenticatedUser): Future[Either[ServiceError, AlertEvent]] =
    alertEventRepo.applyTransition(id, AlertEventAction.Acknowledge, user)

  def snooze(id: AlertEventId, snoozedUntil: Instant, user: AuthenticatedUser): Future[Either[ServiceError, AlertEvent]] =
    alertEventRepo.applyTransition(id, AlertEventAction.Snooze(snoozedUntil), user)

  def resolve(id: AlertEventId, user: AuthenticatedUser): Future[Either[ServiceError, AlertEvent]] =
    alertEventRepo.applyTransition(id, AlertEventAction.Resolve, user)
}
