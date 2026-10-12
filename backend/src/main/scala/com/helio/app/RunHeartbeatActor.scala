package com.helio.app

import com.helio.domain.util.SystemClock
import com.helio.services.pipelines.RunHeartbeatService
import org.apache.pekko.actor.typed.Behavior
import org.apache.pekko.actor.typed.scaladsl.{Behaviors, TimerScheduler}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration
import scala.util.{Failure, Try}

/** Thin self-arming timer around [[RunHeartbeatService.stampOnce]] (HEL-1511, design.md D1), shaped like
 *  [[PipelineSchedulerActor]]: the next stamp is armed only after the previous one completes, and a failure is
 *  logged and retried on the next interval. Independent of the scheduler actor on purpose -- the tick awaits a
 *  scheduled run's whole `submit()`, so a heartbeat driven from it would stall during a long run. */
object RunHeartbeatActor {

  sealed trait Command
  private case object Stamp                       extends Command
  private case class Stamped(result: Try[Int])    extends Command

  def apply(service: RunHeartbeatService, interval: FiniteDuration): Behavior[Command] =
    Behaviors.withTimers { timers =>
      Behaviors.setup { context =>
        context.self ! Stamp
        active(service, timers, interval)
      }
    }

  private def active(service: RunHeartbeatService, timers: TimerScheduler[Command], interval: FiniteDuration): Behavior[Command] =
    Behaviors.receive { (context, message) =>
      message match {
        case Stamp =>
          implicit val ec: ExecutionContext = context.executionContext
          context.pipeToSelf(service.stampOnce(SystemClock.now()))(Stamped)
          Behaviors.same
        case Stamped(result) =>
          result match {
            case Failure(ex) => context.log.error("RunHeartbeatService.stampOnce() failed", ex)
            case _           => ()
          }
          timers.startSingleTimer(Stamp, interval)
          Behaviors.same
      }
    }
}
