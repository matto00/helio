package com.helio.domain

import com.helio.services.ServiceError
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-455 — full transition matrix for `AlertEventStateMachine.transition`:
 *  every legal edge (including all four `ReFire` branches) and every illegal
 *  edge called out by the gate-approved design.md/spec.md scenarios. */
class AlertEventStateMachineSpec extends AnyWordSpec with Matchers {

  private def baseEvent(
      state: AlertEventState,
      snoozedUntil: Option[Instant] = None,
      acknowledgedAt: Option[Instant] = None,
      resolvedAt: Option[Instant] = None
  ): AlertEvent = {
    val firstFired = Instant.parse("2026-01-01T00:00:00Z")
    AlertEvent(
      id               = AlertEventId(UUID.randomUUID().toString),
      alertRuleId      = AlertRuleId(UUID.randomUUID().toString),
      ownerId          = UserId(UUID.randomUUID().toString),
      targetDataTypeId = DataTypeId(UUID.randomUUID().toString),
      value            = JsNumber(1),
      pipelineRunId    = Some("run-1"),
      severity         = Severity.Warning,
      state            = state,
      firstFiredAt     = firstFired,
      lastEvaluatedAt  = firstFired,
      resolvedAt       = resolvedAt,
      acknowledgedAt   = acknowledgedAt,
      snoozedUntil     = snoozedUntil
    )
  }

  private val newValue         = JsNumber(99)
  private val newSeverity      = Severity.Critical
  private val newPipelineRunId = Some("run-2")

  "AlertEventStateMachine.transition" should {

    // ── Legal user-driven transitions ──────────────────────────────────────

    "firing -> acknowledged" in {
      val event = baseEvent(AlertEventState.Firing)
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Acknowledge)
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Acknowledged
          updated.acknowledgedAt shouldBe defined
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "firing -> snoozed" in {
      val event = baseEvent(AlertEventState.Firing)
      val until = Instant.now().plusSeconds(3600)
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Snooze(until))
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Snoozed
          updated.snoozedUntil shouldBe Some(until)
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "firing -> resolved" in {
      val event = baseEvent(AlertEventState.Firing)
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Resolve)
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Resolved
          updated.resolvedAt shouldBe defined
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "acknowledged -> resolved" in {
      val event = baseEvent(AlertEventState.Acknowledged, acknowledgedAt = Some(Instant.now()))
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Resolve)
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Resolved
          updated.resolvedAt shouldBe defined
        case other => fail(s"Expected Right, got: $other")
      }
    }

    // ── ReFire: legal from every active state ────────────────────────────────

    "firing -> firing via ReFire updates in place" in {
      val event = baseEvent(AlertEventState.Firing)
      val result = AlertEventStateMachine.transition(
        event, AlertEventAction.ReFire(newValue, newSeverity, newPipelineRunId)
      )
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Firing
          updated.value shouldBe newValue
          updated.severity shouldBe newSeverity
          updated.lastEvaluatedAt should not be event.lastEvaluatedAt
          updated.firstFiredAt shouldBe event.firstFiredAt
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "acknowledged -> acknowledged via ReFire updates in place" in {
      val ackAt = Instant.parse("2026-01-01T01:00:00Z")
      val event = baseEvent(AlertEventState.Acknowledged, acknowledgedAt = Some(ackAt))
      val result = AlertEventStateMachine.transition(
        event, AlertEventAction.ReFire(newValue, newSeverity, newPipelineRunId)
      )
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Acknowledged
          updated.acknowledgedAt shouldBe Some(ackAt)
          updated.value shouldBe newValue
          updated.severity shouldBe newSeverity
          updated.firstFiredAt shouldBe event.firstFiredAt
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "snoozed (not expired) -> snoozed via ReFire updates in place" in {
      val until = Instant.now().plusSeconds(3600)
      val event = baseEvent(AlertEventState.Snoozed, snoozedUntil = Some(until))
      val result = AlertEventStateMachine.transition(
        event, AlertEventAction.ReFire(newValue, newSeverity, newPipelineRunId)
      )
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Snoozed
          updated.snoozedUntil shouldBe Some(until)
          updated.value shouldBe newValue
          updated.severity shouldBe newSeverity
          updated.firstFiredAt shouldBe event.firstFiredAt
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "snoozed (expired) -> firing via ReFire" in {
      val until = Instant.now().minusSeconds(3600)
      val event = baseEvent(AlertEventState.Snoozed, snoozedUntil = Some(until))
      val result = AlertEventStateMachine.transition(
        event, AlertEventAction.ReFire(newValue, newSeverity, newPipelineRunId)
      )
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Firing
          updated.snoozedUntil shouldBe None
          updated.value shouldBe newValue
          updated.severity shouldBe newSeverity
          updated.firstFiredAt shouldBe event.firstFiredAt
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "ReFire never touches firstFiredAt (any active state)" in {
      val states = Seq(
        baseEvent(AlertEventState.Firing),
        baseEvent(AlertEventState.Acknowledged, acknowledgedAt = Some(Instant.now())),
        baseEvent(AlertEventState.Snoozed, snoozedUntil = Some(Instant.now().plusSeconds(60)))
      )
      states.foreach { event =>
        val result = AlertEventStateMachine.transition(
          event, AlertEventAction.ReFire(newValue, newSeverity, newPipelineRunId)
        )
        result match {
          case Right(updated) => updated.firstFiredAt shouldBe event.firstFiredAt
          case other           => fail(s"Expected Right, got: $other")
        }
      }
    }

    // ── Illegal transitions ──────────────────────────────────────────────────

    "reject resolve then acknowledge" in {
      val event = baseEvent(AlertEventState.Resolved, resolvedAt = Some(Instant.now()))
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Acknowledge)
      result match {
        case Left(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
      result.isLeft shouldBe true
    }

    "reject snooze a resolved event" in {
      val event = baseEvent(AlertEventState.Resolved, resolvedAt = Some(Instant.now()))
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Snooze(Instant.now().plusSeconds(60)))
      result match {
        case Left(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "reject acknowledge a snoozed event" in {
      val event = baseEvent(AlertEventState.Snoozed, snoozedUntil = Some(Instant.now().plusSeconds(60)))
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Acknowledge)
      result match {
        case Left(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "reject snooze an acknowledged event" in {
      val event = baseEvent(AlertEventState.Acknowledged, acknowledgedAt = Some(Instant.now()))
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Snooze(Instant.now().plusSeconds(60)))
      result match {
        case Left(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "reject resolve a resolved event" in {
      val event = baseEvent(AlertEventState.Resolved, resolvedAt = Some(Instant.now()))
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Resolve)
      result match {
        case Left(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "reject snoozed -> resolved (not a legal edge)" in {
      val event = baseEvent(AlertEventState.Snoozed, snoozedUntil = Some(Instant.now().plusSeconds(60)))
      val result = AlertEventStateMachine.transition(event, AlertEventAction.Resolve)
      result match {
        case Left(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "reject ReFire on a resolved event" in {
      val event = baseEvent(AlertEventState.Resolved, resolvedAt = Some(Instant.now()))
      val result = AlertEventStateMachine.transition(
        event, AlertEventAction.ReFire(newValue, newSeverity, newPipelineRunId)
      )
      result match {
        case Left(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }
  }
}
