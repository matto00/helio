package com.helio.domain

import com.helio.services.ServiceError

import java.time.Instant

/** Single source of truth for `AlertEvent` lifecycle transitions (HEL-455).
 *
 *  Every mutation of an `AlertEvent`'s persisted fields — user-driven
 *  (`Acknowledge`/`Snooze`/`Resolve` via `AlertEventService`) or
 *  engine-driven (`ReFire` via `AlertEventRepository.upsertFiringInternal`)
 *  — goes through [[transition]]. No caller mutates an `AlertEvent`'s fields
 *  by any other path; this keeps illegal-transition rejection from diverging
 *  between the two callers (design.md's "State machine as one function"
 *  decision).
 *
 *  Legal edges:
 *  {{{
 *  firing       -> resolved      (Resolve)
 *  firing       -> acknowledged  (Acknowledge)
 *  firing       -> snoozed       (Snooze)
 *  acknowledged -> resolved      (Resolve)
 *  firing        -> firing        (ReFire, refreshes value/severity/lastEvaluatedAt)
 *  acknowledged  -> acknowledged  (ReFire, refreshes value/severity/lastEvaluatedAt)
 *  snoozed       -> snoozed       (ReFire, snoozedUntil still in the future)
 *  snoozed       -> firing        (ReFire, snoozedUntil has passed; clears snoozedUntil)
 *  }}}
 *  Every other edge — including every transition out of `resolved`, which is
 *  terminal — is rejected with `ServiceError.Conflict`.
 */
object AlertEventStateMachine {

  def transition(event: AlertEvent, action: AlertEventAction): Either[ServiceError, AlertEvent] =
    (event.state, action) match {

      // ── User-driven transitions out of an active state ──────────────────
      case (AlertEventState.Firing, AlertEventAction.Acknowledge) =>
        Right(event.copy(state = AlertEventState.Acknowledged, acknowledgedAt = Some(Instant.now())))

      case (AlertEventState.Firing, AlertEventAction.Snooze(until)) =>
        Right(event.copy(state = AlertEventState.Snoozed, snoozedUntil = Some(until)))

      case (AlertEventState.Firing, AlertEventAction.Resolve) =>
        Right(event.copy(state = AlertEventState.Resolved, resolvedAt = Some(Instant.now())))

      case (AlertEventState.Acknowledged, AlertEventAction.Resolve) =>
        Right(event.copy(state = AlertEventState.Resolved, resolvedAt = Some(Instant.now())))

      // ── ReFire: legal from every active state, never from resolved ──────
      // firstFiredAt is never touched here — only the initial insert sets it.
      case (AlertEventState.Firing, AlertEventAction.ReFire(value, severity, pipelineRunId)) =>
        Right(event.copy(
          value           = value,
          severity        = severity,
          pipelineRunId   = pipelineRunId,
          lastEvaluatedAt = Instant.now()
        ))

      case (AlertEventState.Acknowledged, AlertEventAction.ReFire(value, severity, pipelineRunId)) =>
        Right(event.copy(
          value           = value,
          severity        = severity,
          pipelineRunId   = pipelineRunId,
          lastEvaluatedAt = Instant.now()
        ))

      case (AlertEventState.Snoozed, AlertEventAction.ReFire(value, severity, pipelineRunId)) =>
        val now = Instant.now()
        if (event.snoozedUntil.exists(now.isAfter))
          // Expiry check lives here (in the single source of truth), not
          // pre-branched by the caller — see design.md's "snooze-expiry
          // exclusion at read, not a sweep" decision.
          Right(event.copy(
            state           = AlertEventState.Firing,
            snoozedUntil    = None,
            value           = value,
            severity        = severity,
            pipelineRunId   = pipelineRunId,
            lastEvaluatedAt = now
          ))
        else
          Right(event.copy(
            value           = value,
            severity        = severity,
            pipelineRunId   = pipelineRunId,
            lastEvaluatedAt = now
          ))

      // ── Everything else is illegal ───────────────────────────────────────
      // Includes: any action on a resolved event (terminal — a re-breach
      // opens a new event via the repository's insert branch, never a
      // transition on the resolved row), acknowledge/resolve a snoozed
      // event, snooze an acknowledged event, resolve/acknowledge/snooze
      // twice, etc.
      case (state, _) =>
        Left(ServiceError.Conflict(s"Illegal alert event transition: ${AlertEventState.asString(state)} -> $action"))
    }
}
