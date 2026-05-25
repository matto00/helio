package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Repository for `resource_permissions` — the sharing-grant table.
 *
 *  All methods use `withSystemContext` because grant lookups are inherently
 *  cross-user: a caller checks whether ANOTHER user (or anonymous) has a
 *  grant on a resource. Scoping by the caller's own user-id would be
 *  nonsensical. The ACL decision is enforced in the service / directive layer;
 *  this repo is the raw data source.
 *
 *  The `resource_permissions` table has FORCE RLS enabled (V36). All methods
 *  here use `withSystemContext` (helio_privileged BYPASSRLS), which correctly
 *  bypasses those policies. Direct app-pool queries on this table are
 *  fail-closed by the V36 SELECT policy (owner OR named grantee only).
 */
class ResourcePermissionRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import ResourcePermissionRepository._

  private val table = TableQuery[ResourcePermissionTable]

  private def rowToDomain(row: ResourcePermissionRow): ResourcePermission =
    ResourcePermission(
      resourceType = row.resourceType,
      resourceId   = row.resourceId,
      granteeId    = row.granteeId.map(id => UserId(id.toString)),
      role         = Role.fromString(row.role).getOrElse(Role.Viewer),
      createdAt    = row.createdAt
    )

  private def domainToRow(p: ResourcePermission): ResourcePermissionRow =
    ResourcePermissionRow(
      resourceType = p.resourceType,
      resourceId   = p.resourceId,
      granteeId    = p.granteeId.map(id => UUID.fromString(id.value)),
      role         = Role.asString(p.role),
      createdAt    = p.createdAt
    )

  def insert(permission: ResourcePermission): Future[ResourcePermission] =
    ctx.withSystemContext(table += domainToRow(permission))
      .map(_ => permission)

  def delete(resourceType: String, resourceId: String, granteeId: UserId): Future[Boolean] =
    ctx.withSystemContext(
      table
        .filter(r => r.resourceType === resourceType && r.resourceId === resourceId && r.granteeId === UUID.fromString(granteeId.value))
        .delete
    ).map(_ > 0)

  def findByResource(resourceType: String, resourceId: String): Future[Vector[ResourcePermission]] =
    ctx.withSystemContext(
      table
        .filter(r => r.resourceType === resourceType && r.resourceId === resourceId)
        .result
    ).map(_.map(rowToDomain).toVector)

  def findGrant(resourceType: String, resourceId: String, granteeId: UserId): Future[Option[ResourcePermission]] =
    ctx.withSystemContext(
      table
        .filter(r =>
          r.resourceType === resourceType &&
          r.resourceId === resourceId &&
          r.granteeId === UUID.fromString(granteeId.value)
        )
        .result
        .headOption
    ).map(_.map(rowToDomain))

  def hasPublicViewerGrant(resourceType: String, resourceId: String): Future[Boolean] =
    ctx.withSystemContext(
      table
        .filter(r =>
          r.resourceType === resourceType &&
          r.resourceId === resourceId &&
          r.granteeId.isEmpty &&
          r.role === "viewer"
        )
        .exists
        .result
    )
}

object ResourcePermissionRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  case class ResourcePermissionRow(
      resourceType: String,
      resourceId: String,
      granteeId: Option[UUID],
      role: String,
      createdAt: Instant
  )

  class ResourcePermissionTable(tag: Tag) extends Table[ResourcePermissionRow](tag, "resource_permissions") {
    def resourceType = column[String]("resource_type")
    def resourceId   = column[String]("resource_id")
    def granteeId    = column[Option[UUID]]("grantee_id")
    def role         = column[String]("role")
    def createdAt    = column[Instant]("created_at")

    def * = (resourceType, resourceId, granteeId, role, createdAt).mapTo[ResourcePermissionRow]
  }
}
