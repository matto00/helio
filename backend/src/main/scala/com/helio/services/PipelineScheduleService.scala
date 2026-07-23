package com.helio.services

import com.helio.api.protocols.PutPipelineScheduleRequest
import com.helio.domain._
import com.helio.infrastructure.{PipelineRepository, PipelineScheduleRepository}

import java.time.{DateTimeException, Instant, ZoneId}
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.matching.Regex

/** Business logic for `/api/pipelines/:id/schedule` (mirrors
 *  `AlertRuleService`'s shape). Storage-only (HEL-414) — no firing/polling
 *  happens here (HEL-415). Every method ACL-gates against
 *  `pipelineRepo.findByIdOwned` first, mirroring `AlertRuleService.create`'s
 *  target-ownership check. */
final class PipelineScheduleService(
    scheduleRepo: PipelineScheduleRepository,
    pipelineRepo: PipelineRepository
)(implicit ec: ExecutionContext) {

  // ── Read ──────────────────────────────────────────────────────────────────

  def find(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSchedule]] =
    pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Pipeline not found")))
      case Some(_) =>
        scheduleRepo.findByPipelineId(pipelineId, user).map {
          case Some(schedule) => Right(schedule)
          case None           => Left(ServiceError.NotFound("Pipeline schedule not found"))
        }
    }

  // ── Create-or-replace ─────────────────────────────────────────────────────

  def put(
      pipelineId: PipelineId,
      req: PutPipelineScheduleRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PipelineSchedule]] =
    pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Pipeline not found")))
      case Some(_) =>
        validate(req) match {
          case Left(err) => Future.successful(Left(err))
          case Right((kind, timezone)) =>
            // PUT is upsert (create-or-replace): reuse an existing schedule's
            // id/createdAt/nextRunAt/lastRunAt so the repository's insertOrUpdate
            // resolves to an UPDATE on the same PK row rather than colliding
            // with the pipeline_id UNIQUE constraint via a fresh id.
            scheduleRepo.findByPipelineId(pipelineId, user).flatMap { existingOpt =>
              val now = Instant.now()
              val schedule = PipelineSchedule(
                id         = existingOpt.map(_.id).getOrElse(PipelineScheduleId(UUID.randomUUID().toString)),
                pipelineId = pipelineId,
                kind       = kind,
                expression = req.expression.trim,
                // spray-json omits `None` on the wire — `enabled` defaults to
                // `true` when absent (AC: "Absent optional fields normalize
                // at the boundary").
                enabled    = req.enabled.getOrElse(true),
                timezone   = timezone,
                nextRunAt  = existingOpt.flatMap(_.nextRunAt),
                lastRunAt  = existingOpt.flatMap(_.lastRunAt),
                createdAt  = existingOpt.map(_.createdAt).getOrElse(now),
                updatedAt  = now
              )
              scheduleRepo.upsert(schedule, user).map(Right(_))
            }
        }
    }

  // ── Delete ────────────────────────────────────────────────────────────────

  def delete(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Pipeline not found")))
      case Some(_) =>
        scheduleRepo.delete(pipelineId, user).map {
          case true  => Right(())
          case false => Left(ServiceError.NotFound("Pipeline schedule not found"))
        }
    }

  // ── Validation (structural, hand-rolled — no new dependency; design.md Decision 5) ──

  private def validate(req: PutPipelineScheduleRequest): Either[ServiceError, (ScheduleKind, String)] =
    for {
      kind     <- ScheduleKind.fromString(req.kind).left.map(ServiceError.BadRequest(_))
      _        <- validateExpression(kind, req.expression)
      timezone <- validateTimezone(req.timezone)
    } yield (kind, timezone)

  private def validateExpression(kind: ScheduleKind, expression: String): Either[ServiceError, Unit] =
    kind match {
      case ScheduleKind.Cron     => validateCron(expression)
      case ScheduleKind.Interval => validateInterval(expression)
    }

  /** Per-field (minute hour day-of-month month day-of-week) bounds for a
   *  standard 5-field cron expression. */
  private val cronFieldBounds: Vector[(Int, Int)] =
    Vector(0 -> 59, 0 -> 23, 1 -> 31, 1 -> 12, 0 -> 6)

  private def validateCron(expression: String): Either[ServiceError, Unit] = {
    val fields = expression.trim.split("\\s+")
    if (fields.length != 5)
      Left(ServiceError.BadRequest(
        s"Invalid cron expression '$expression': expected 5 space-separated fields (minute hour day-of-month month day-of-week), got ${fields.length}"
      ))
    else
      fields.zip(cronFieldBounds).zipWithIndex.collectFirst {
        case ((field, bounds), idx) if !isValidCronField(field, bounds) =>
          Left(ServiceError.BadRequest(s"Invalid cron expression '$expression': field $idx ('$field') is malformed"))
      }.getOrElse(Right(()))
  }

  /** A cron field is valid if every comma-separated token is `*`, a bare
   *  in-range number, an in-range `lo-hi` range, or a `base/step` (base is
   *  `*` or an in-range number; step is a positive integer). */
  private def isValidCronField(field: String, bounds: (Int, Int)): Boolean = {
    val (min, max) = bounds
    def inRange(n: Int): Boolean          = n >= min && n <= max
    def isSimpleValue(t: String): Boolean = t.toIntOption.exists(inRange)

    def isValidToken(token: String): Boolean = token match {
      case "*" => true
      case t if t.contains("/") =>
        t.split("/", 2) match {
          case Array(base, step) =>
            (base == "*" || isSimpleValue(base)) && step.toIntOption.exists(_ > 0)
          case _ => false
        }
      case t if t.contains("-") =>
        t.split("-", 2) match {
          case Array(lo, hi) =>
            lo.toIntOption.exists(inRange) && hi.toIntOption.exists(inRange) && lo.toInt <= hi.toInt
          case _ => false
        }
      case t => isSimpleValue(t)
    }

    field.nonEmpty && field.split(",").forall(isValidToken)
  }

  private val intervalPattern: Regex = "^(\\d+)(s|m|h|d)$".r

  private def validateInterval(expression: String): Either[ServiceError, Unit] =
    expression.trim match {
      case intervalPattern(n, _) if n.toLongOption.exists(_ > 0) => Right(())
      case _ =>
        Left(ServiceError.BadRequest(
          s"Invalid interval expression '$expression': expected '<n><unit>' with n > 0 and unit one of s/m/h/d"
        ))
    }

  private def validateTimezone(timezone: String): Either[ServiceError, String] =
    try {
      ZoneId.of(timezone)
      Right(timezone)
    } catch {
      case _: DateTimeException =>
        Left(ServiceError.BadRequest(s"Invalid timezone '$timezone': not a valid IANA zone id"))
    }
}
