package com.helio.app

import akka.actor.typed.ActorRef
import akka.actor.typed.Behavior
import akka.actor.typed.scaladsl.Behaviors
import com.helio.domain.DashboardId
import com.helio.domain.Panel
import com.helio.domain.PanelAppearance
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
  final case class GetPanel(panelId: PanelId, replyTo: ActorRef[PanelLookup]) extends Command
  final case class UpdatePanelAppearance(
      panelId: PanelId,
      appearance: PanelAppearance,
      replyTo: ActorRef[PanelLookup]
  ) extends Command

  final case class Panels(items: Vector[Panel])
  final case class PanelLookup(item: Option[Panel])

  def apply(initialPanels: Vector[Panel] = Vector.empty): Behavior[Command] =
    behavior(initialPanels)

  private def behavior(panels: Vector[Panel]): Behavior[Command] =
    Behaviors.receiveMessage {
      case RegisterPanel(dashboardId, title, replyTo) =>
        val now = Instant.now()
        val created = Panel(
          PanelId(java.util.UUID.randomUUID().toString),
          dashboardId,
          title,
          ResourceMeta(createdBy = SystemUser, createdAt = now, lastUpdated = now),
          PanelAppearance.Default
        )
        replyTo ! created
        behavior(panels :+ created)
      case GetPanelsForDashboard(dashboardId, replyTo) =>
        replyTo ! Panels(panels.filter(_.dashboardId == dashboardId).sortBy(_.meta.lastUpdated).reverse)
        Behaviors.same
      case GetPanel(panelId, replyTo) =>
        replyTo ! PanelLookup(panels.find(_.id == panelId))
        Behaviors.same
      case UpdatePanelAppearance(panelId, appearance, replyTo) =>
        val existingPanel = panels.find(_.id == panelId)
        val updatedPanels = existingPanel match {
          case Some(panel) =>
            val updatedPanel = panel.copy(
              appearance = appearance,
              meta = panel.meta.copy(lastUpdated = Instant.now())
            )
            panels.map(currentPanel => if (currentPanel.id == panelId) updatedPanel else currentPanel)
          case None =>
            panels
        }

        replyTo ! PanelLookup(updatedPanels.find(_.id == panelId))
        behavior(updatedPanels)
    }
}
