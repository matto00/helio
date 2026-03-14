package com.helio.app

import akka.actor.typed.ActorRef
import akka.actor.typed.Behavior
import akka.actor.typed.scaladsl.Behaviors
import com.helio.domain.Dashboard
import com.helio.domain.DashboardId

object DashboardRegistryActor {
  sealed trait Command
  final case class RegisterDashboard(name: String, replyTo: ActorRef[Dashboard]) extends Command
  final case class GetDashboards(replyTo: ActorRef[Dashboards]) extends Command

  final case class Dashboards(items: Vector[Dashboard])

  def apply(): Behavior[Command] =
    behavior(Vector.empty)

  private def behavior(dashboards: Vector[Dashboard]): Behavior[Command] =
    Behaviors.receiveMessage {
      case RegisterDashboard(name, replyTo) =>
        val created = Dashboard(DashboardId(java.util.UUID.randomUUID().toString), name)
        replyTo ! created
        behavior(dashboards :+ created)
      case GetDashboards(replyTo) =>
        replyTo ! Dashboards(dashboards)
        Behaviors.same
    }
}
