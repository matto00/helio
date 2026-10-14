package com.helio.services.dashboards

import com.helio.domain.model.{AuthenticatedUser, DashboardFolder, DashboardFolderAssignment}
import com.helio.infrastructure.persistence.dashboards.DashboardFolderRepository
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Per-user dashboard folders (HEL-1574). Folders are private to their creator; filing a dashboard needs only that
 *  the caller can access it (owner, editor or viewer) and never changes the dashboard or any grant. */
final class DashboardFolderService(repo: DashboardFolderRepository, accessChecker: AccessChecker)(implicit
    ec: ExecutionContext
) {

  private val NotFoundFolder = ServiceError.NotFound("Folder not found")

  private def parseId(raw: String): Option[String] = Try(UUID.fromString(raw).toString).toOption

  private def normalizeName(raw: String): Either[ServiceError, String] = {
    val trimmed = raw.trim
    if (trimmed.isEmpty || trimmed.length > DashboardFolderService.MaxNameLength)
      Left(ServiceError.BadRequest(s"Folder name must be 1..${DashboardFolderService.MaxNameLength} characters"))
    else Right(trimmed)
  }

  private val duplicate = ServiceError.Conflict("A folder with that name already exists")

  def list(user: AuthenticatedUser): Future[(Vector[DashboardFolder], Vector[DashboardFolderAssignment])] =
    repo.list(user.id)

  def create(rawName: String, user: AuthenticatedUser): Future[Either[ServiceError, DashboardFolder]] =
    normalizeName(rawName) match {
      case Left(err)   => Future.successful(Left(err))
      case Right(name) => repo.create(user.id, name).map(_.left.map(_ => duplicate))
    }

  def update(
      rawId: String,
      rawName: Option[String],
      collapsed: Option[Boolean],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, DashboardFolder]] =
    parseId(rawId) match {
      case None => Future.successful(Left(NotFoundFolder))
      case Some(id) =>
        val name: Either[ServiceError, Option[String]] = rawName match {
          case None    => Right(None)
          case Some(n) => normalizeName(n).map(Some(_))
        }
        if (rawName.isEmpty && collapsed.isEmpty)
          Future.successful(Left(ServiceError.BadRequest("Nothing to update: supply name and/or collapsed")))
        else
          name match {
            case Left(err) => Future.successful(Left(err))
            case Right(n) =>
              repo.update(user.id, id, n, collapsed).map {
                case Left(_)              => Left(duplicate)
                case Right(None)          => Left(NotFoundFolder)
                case Right(Some(folder))  => Right(folder)
              }
          }
    }

  def delete(rawId: String, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    parseId(rawId) match {
      case None => Future.successful(Left(NotFoundFolder))
      case Some(id) =>
        repo.delete(user.id, id).map(removed => if (removed) Right(()) else Left(NotFoundFolder))
    }

  /** `folderId = None` unfiles. 404 when the dashboard is not accessible to the caller or the folder is not theirs. */
  def move(
      dashboardId: String,
      folderId: Option[String],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    accessChecker.requireAccess("dashboard", dashboardId, Some(user), "Dashboard not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        folderId match {
          case None => repo.assign(user.id, dashboardId, None).map(_ => Right(()))
          case Some(raw) =>
            parseId(raw) match {
              case None => Future.successful(Left(NotFoundFolder))
              case Some(id) =>
                repo.exists(user.id, id).flatMap {
                  case false => Future.successful(Left(NotFoundFolder))
                  case true  => repo.assign(user.id, dashboardId, Some(id)).map(_ => Right(()))
                }
            }
        }
    }
}

object DashboardFolderService {
  val MaxNameLength: Int = 80
}
