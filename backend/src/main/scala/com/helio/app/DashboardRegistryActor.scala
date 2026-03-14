package com.helio.app

import akka.actor.typed.ActorRef
import akka.actor.typed.Behavior
import akka.actor.typed.scaladsl.Behaviors
import com.helio.domain.Dashboard
import com.helio.domain.DashboardId
import com.helio.domain.ResourceMeta

import java.time.Instant

object DashboardRegistryActor {
  private val SystemUser = "system"

  sealed trait Command
  final case class RegisterDashboard(name: String, replyTo: ActorRef[Dashboard]) extends Command
  final case class GetDashboards(replyTo: ActorRef[Dashboards]) extends Command
  final case class GetDashboard(dashboardId: DashboardId, replyTo: ActorRef[DashboardLookup]) extends Command

  final case class Dashboards(items: Vector[Dashboard])
  final case class DashboardLookup(item: Option[Dashboard])

  def apply(): Behavior[Command] =
    behavior(Vector.empty)

  private def behavior(dashboards: Vector[Dashboard]): Behavior[Command] =
    Behaviors.receiveMessage {
      case RegisterDashboard(name, replyTo) =>
        val now = Instant.now()
        val created = Dashboard(
          DashboardId(java.util.UUID.randomUUID().toString),
          name,
          ResourceMeta(createdBy = SystemUser, createdAt = now, lastUpdated = now)
        )
        replyTo ! created
        behavior(dashboards :+ created)
      case GetDashboards(replyTo) =>
        replyTo ! Dashboards(dashboards)
        Behaviors.same
      case GetDashboard(dashboardId, replyTo) =>
        replyTo ! DashboardLookup(dashboards.find(_.id == dashboardId))
        Behaviors.same
    }
}
