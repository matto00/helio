package com.helio.app

import org.apache.pekko.actor.typed.Behavior
import org.apache.pekko.actor.typed.scaladsl.{Behaviors, TimerScheduler}
import com.helio.services.PipelineSchedulerService

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration
import scala.util.{Failure, Success, Try}

/** Thin timer wrapper around [[PipelineSchedulerService.tick]] (HEL-415).
 *  All business logic — due-schedule selection, overlap guard, submit,
 *  bookkeeping — lives in the service (unit-tested directly, with an
 *  injected fake `Clock`, never exercising Pekko's real timer). This actor
 *  owns only the self-rescheduling timer: the first tick runs immediately at
 *  startup (so a fresh deploy's boot recomputes every unset `next_run_at`
 *  without firing a storm — design.md Decision 2), and each subsequent tick
 *  is armed only after the previous tick's `Future` completes, so ticks
 *  never overlap even if a tick's async work outlasts `tickInterval`
 *  (design.md Decision 6). */
object PipelineSchedulerActor {

  sealed trait Command
  private case object Tick                            extends Command
  private case class TickCompleted(result: Try[Unit]) extends Command

  def apply(scheduler: PipelineSchedulerService, tickInterval: FiniteDuration): Behavior[Command] =
    Behaviors.withTimers { timers =>
      Behaviors.setup { context =>
        context.self ! Tick
        active(scheduler, timers, tickInterval)
      }
    }

  private def active(
      scheduler: PipelineSchedulerService,
      timers: TimerScheduler[Command],
      tickInterval: FiniteDuration
  ): Behavior[Command] =
    Behaviors.receive { (context, message) =>
      message match {
        case Tick =>
          implicit val ec: ExecutionContext = context.executionContext
          // pipeToSelf (not a plain onComplete) so TickCompleted is handled
          // back on the actor's own thread — timers.startSingleTimer is not
          // safe to call from an arbitrary dispatcher-pool thread.
          context.pipeToSelf(scheduler.tick())(TickCompleted)
          Behaviors.same

        case TickCompleted(result) =>
          result match {
            case Success(_) => ()
            case Failure(ex) => context.log.error("PipelineSchedulerService.tick() failed", ex)
          }
          timers.startSingleTimer(Tick, tickInterval)
          Behaviors.same
      }
    }
}
