package com.helio.app

import akka.actor.typed.ActorRef
import akka.actor.typed.Behavior
import akka.actor.typed.scaladsl.Behaviors
import com.helio.domain.DashboardId
import com.helio.domain.Panel
import com.helio.domain.PanelId
import com.helio.domain.ResourceMeta

import java.time.Instant

object PanelRegistryActor {
  private val SystemUser = "system"

  sealed trait Command
  final case class RegisterPanel(
      dashboardId: DashboardId,
      title: String,
      replyTo: ActorRef[Panel]
  ) extends Command
  final case class GetPanelsForDashboard(
      dashboardId: DashboardId,
      replyTo: ActorRef[Panels]
  ) extends Command

  final case class Panels(items: Vector[Panel])

  def apply(): Behavior[Command] =
    behavior(Vector.empty)

  private def behavior(panels: Vector[Panel]): Behavior[Command] =
    Behaviors.receiveMessage {
      case RegisterPanel(dashboardId, title, replyTo) =>
        val now = Instant.now()
        val created = Panel(
          PanelId(java.util.UUID.randomUUID().toString),
          dashboardId,
          title,
          ResourceMeta(createdBy = SystemUser, createdAt = now, lastUpdated = now)
        )
        replyTo ! created
        behavior(panels :+ created)
      case GetPanelsForDashboard(dashboardId, replyTo) =>
        replyTo ! Panels(panels.filter(_.dashboardId == dashboardId))
        Behaviors.same
    }
}
