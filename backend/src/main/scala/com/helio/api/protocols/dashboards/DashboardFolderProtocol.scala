package com.helio.api.protocols.dashboards

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.{DashboardFolder, DashboardFolderAssignment}
import spray.json._

final case class DashboardFolderResponse(id: String, name: String, collapsed: Boolean, createdAt: String)
final case class DashboardFolderAssignmentResponse(dashboardId: String, folderId: String)
final case class DashboardFolderListResponse(
    folders: Vector[DashboardFolderResponse],
    assignments: Vector[DashboardFolderAssignmentResponse]
)
final case class CreateDashboardFolderRequest(name: String)
final case class UpdateDashboardFolderRequest(name: Option[String], collapsed: Option[Boolean])

object DashboardFolderResponse {
  def fromDomain(f: DashboardFolder): DashboardFolderResponse =
    DashboardFolderResponse(f.id, f.name, f.collapsed, f.createdAt.toString)
}

object DashboardFolderListResponse {
  def fromDomain(
      folders: Vector[DashboardFolder],
      assignments: Vector[DashboardFolderAssignment]
  ): DashboardFolderListResponse =
    DashboardFolderListResponse(
      folders.map(DashboardFolderResponse.fromDomain),
      assignments.map(a => DashboardFolderAssignmentResponse(a.dashboardId, a.folderId))
    )
}

trait DashboardFolderProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val dashboardFolderResponseFormat: RootJsonFormat[DashboardFolderResponse] =
    jsonFormat4(DashboardFolderResponse.apply)
  implicit val dashboardFolderAssignmentResponseFormat: RootJsonFormat[DashboardFolderAssignmentResponse] =
    jsonFormat2(DashboardFolderAssignmentResponse.apply)
  implicit val dashboardFolderListResponseFormat: RootJsonFormat[DashboardFolderListResponse] =
    jsonFormat2(DashboardFolderListResponse.apply)
  implicit val createDashboardFolderRequestFormat: RootJsonFormat[CreateDashboardFolderRequest] =
    jsonFormat1(CreateDashboardFolderRequest.apply)
  implicit val updateDashboardFolderRequestFormat: RootJsonFormat[UpdateDashboardFolderRequest] =
    jsonFormat2(UpdateDashboardFolderRequest.apply)
}
