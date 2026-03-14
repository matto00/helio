package com.helio.app

import akka.actor.typed.ActorRef
import akka.actor.typed.Behavior
import akka.actor.typed.scaladsl.Behaviors
import com.helio.domain.Dashboard
import com.helio.domain.DashboardAppearance
import com.helio.domain.DashboardId
import com.helio.domain.ResourceMeta

import java.time.Instant

object DashboardRegistryActor {
  private val SystemUser = "system"

  sealed trait Command
  final case class RegisterDashboard(name: String, replyTo: ActorRef[Dashboard]) extends Command
  final case class GetDashboards(replyTo: ActorRef[Dashboards]) extends Command
  final case class GetDashboard(dashboardId: DashboardId, replyTo: ActorRef[DashboardLookup]) extends Command
  final case class UpdateDashboardAppearance(
      dashboardId: DashboardId,
      appearance: DashboardAppearance,
      replyTo: ActorRef[DashboardLookup]
  ) extends Command

  final case class Dashboards(items: Vector[Dashboard])
  final case class DashboardLookup(item: Option[Dashboard])

  def apply(initialDashboards: Vector[Dashboard] = Vector.empty): Behavior[Command] =
    behavior(initialDashboards)

  private def behavior(dashboards: Vector[Dashboard]): Behavior[Command] =
    Behaviors.receiveMessage {
      case RegisterDashboard(name, replyTo) =>
        val now = Instant.now()
        val created = Dashboard(
          DashboardId(java.util.UUID.randomUUID().toString),
          name,
          ResourceMeta(createdBy = SystemUser, createdAt = now, lastUpdated = now),
          DashboardAppearance.Default
        )
        replyTo ! created
        behavior(dashboards :+ created)
      case GetDashboards(replyTo) =>
        replyTo ! Dashboards(dashboards)
        Behaviors.same
      case GetDashboard(dashboardId, replyTo) =>
        replyTo ! DashboardLookup(dashboards.find(_.id == dashboardId))
        Behaviors.same
      case UpdateDashboardAppearance(dashboardId, appearance, replyTo) =>
        val existingDashboard = dashboards.find(_.id == dashboardId)
        val updatedDashboards = existingDashboard match {
          case Some(dashboard) =>
            val updatedDashboard = dashboard.copy(
              appearance = appearance,
              meta = dashboard.meta.copy(lastUpdated = Instant.now())
            )
            dashboards.map(currentDashboard =>
              if (currentDashboard.id == dashboardId) updatedDashboard else currentDashboard
            )
          case None =>
            dashboards
        }

        replyTo ! DashboardLookup(updatedDashboards.find(_.id == dashboardId))
        behavior(updatedDashboards)
    }
}
