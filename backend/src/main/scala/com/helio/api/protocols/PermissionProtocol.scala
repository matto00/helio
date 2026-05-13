package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Permission API types ─────────────────────────────────────────────────────

final case class GrantPermissionRequest(granteeId: Option[String], role: String)
final case class PermissionResponse(granteeId: Option[String], role: String, createdAt: String)
final case class PermissionsResponse(items: Vector[PermissionResponse])

object PermissionResponse {
  def fromDomain(permission: ResourcePermission): PermissionResponse =
    PermissionResponse(
      granteeId = permission.granteeId.map(_.value),
      role      = Role.asString(permission.role),
      createdAt = permission.createdAt.toString
    )
}

trait PermissionProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val grantPermissionRequestFormat: RootJsonFormat[GrantPermissionRequest] = jsonFormat2(GrantPermissionRequest.apply)
  implicit val permissionResponseFormat: RootJsonFormat[PermissionResponse]         = jsonFormat3(PermissionResponse.apply)
  implicit val permissionsResponseFormat: RootJsonFormat[PermissionsResponse]       = jsonFormat1(PermissionsResponse.apply)
}
