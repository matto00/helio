package com.helio.infrastructure.persistence.dashboards

import com.helio.domain.model.{DashboardFolder, DashboardFolderAssignment, UserId}
import com.helio.infrastructure.persistence.DbContext
import org.postgresql.util.PSQLException
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Per-user folders and filings (`dashboard_folders` / `dashboard_folder_assignments`, V134). Every statement runs in
 *  the caller's user context (`withUserContext`) so the FORCE-RLS owner policies apply, and also filters on
 *  `owner_id` explicitly (defense in depth). Dashboards are joined under the same RLS context, so a filing whose
 *  dashboard the caller can no longer see (a revoked grant) simply stops being returned. */
class DashboardFolderRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import DashboardFolderRepository._

  private type FolderRow = (String, String, Boolean, Timestamp)

  private def toFolder(row: FolderRow): DashboardFolder =
    DashboardFolder(row._1, row._2, row._3, row._4.toInstant)

  private def uuid(userId: UserId): String = userId.value

  def list(userId: UserId): Future[(Vector[DashboardFolder], Vector[DashboardFolderAssignment])] = {
    val owner = uuid(userId)
    val folders =
      sql"""SELECT id::text, name, collapsed, created_at FROM dashboard_folders
            WHERE owner_id = $owner::uuid ORDER BY created_at, id""".as[FolderRow]
    val assignments =
      sql"""SELECT a.dashboard_id, a.folder_id::text
            FROM dashboard_folder_assignments a JOIN dashboards d ON d.id = a.dashboard_id
            WHERE a.owner_id = $owner::uuid ORDER BY a.dashboard_id""".as[(String, String)]
    ctx.withUserContext(userId.value)(folders.zip(assignments)).map { case (fs, as) =>
      (fs.map(toFolder), as.map { case (d, f) => DashboardFolderAssignment(d, f) })
    }
  }

  def create(userId: UserId, name: String): Future[Either[DuplicateName.type, DashboardFolder]] = {
    val owner = uuid(userId)
    val id    = UUID.randomUUID().toString
    ctx.withUserContext(userId.value)(
      sql"""INSERT INTO dashboard_folders (id, owner_id, name) VALUES ($id::uuid, $owner::uuid, $name)
            RETURNING id::text, name, collapsed, created_at""".as[FolderRow].head
    ).map(row => Right(toFolder(row)): Either[DuplicateName.type, DashboardFolder])
      .recover { case e: PSQLException if e.getSQLState == UniqueViolation => Left(DuplicateName) }
  }

  /** `Right(None)` when the caller has no such folder. */
  def update(
      userId: UserId,
      folderId: String,
      name: Option[String],
      collapsed: Option[Boolean]
  ): Future[Either[DuplicateName.type, Option[DashboardFolder]]] = {
    val owner = uuid(userId)
    ctx.withUserContext(userId.value)(
      sql"""UPDATE dashboard_folders
            SET name = COALESCE(${name}, name), collapsed = COALESCE(${collapsed}, collapsed), updated_at = NOW()
            WHERE id = $folderId::uuid AND owner_id = $owner::uuid
            RETURNING id::text, name, collapsed, created_at""".as[FolderRow].headOption
    ).map(row => Right(row.map(toFolder)): Either[DuplicateName.type, Option[DashboardFolder]])
      .recover { case e: PSQLException if e.getSQLState == UniqueViolation => Left(DuplicateName) }
  }

  def delete(userId: UserId, folderId: String): Future[Boolean] =
    ctx.withUserContext(userId.value)(
      sqlu"DELETE FROM dashboard_folders WHERE id = $folderId::uuid AND owner_id = ${uuid(userId)}::uuid"
    ).map(_ > 0)

  def exists(userId: UserId, folderId: String): Future[Boolean] =
    ctx.withUserContext(userId.value)(
      sql"SELECT 1 FROM dashboard_folders WHERE id = $folderId::uuid AND owner_id = ${uuid(userId)}::uuid".as[Int].headOption
    ).map(_.isDefined)

  /** File the dashboard in `folderId` (replacing any previous filing by this user), or unfile it on `None`. */
  def assign(userId: UserId, dashboardId: String, folderId: Option[String]): Future[Unit] = {
    val owner = uuid(userId)
    val action = folderId match {
      case Some(folder) =>
        sqlu"""INSERT INTO dashboard_folder_assignments (owner_id, dashboard_id, folder_id)
               VALUES ($owner::uuid, $dashboardId, $folder::uuid)
               ON CONFLICT (owner_id, dashboard_id) DO UPDATE SET folder_id = EXCLUDED.folder_id"""
      case None =>
        sqlu"DELETE FROM dashboard_folder_assignments WHERE owner_id = $owner::uuid AND dashboard_id = $dashboardId"
    }
    ctx.withUserContext(userId.value)(action).map(_ => ())
  }
}

object DashboardFolderRepository {
  private val UniqueViolation = "23505"

  /** The caller already has a folder with this name (case-insensitively). */
  case object DuplicateName
}
