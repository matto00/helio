package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.AuthenticatedUser
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.ExecutionContext

/** What a user may do to a pipeline's definition RIGHT NOW, read inside a write's own transaction. */
sealed trait WriteAccess {
  def mayWrite: Boolean = this == WriteAccess.Owner || this == WriteAccess.Editor
}
object WriteAccess {
  case object Owner        extends WriteAccess
  case object Editor       extends WriteAccess
  case object Viewer       extends WriteAccess
  case object NoAccess     extends WriteAccess
  case object PipelineGone extends WriteAccess
}

/** HEL-1707: a privileged (RLS-bypassing) write found, inside its transaction, that the acting user is no longer the pipeline
 *  owner or an editor. The transaction rolls back (nothing is written); the service maps it to the answer its own pre-check
 *  would have given had the revoke landed first (`Viewer` -> 403, anything else -> the route's not-found). */
final case class PipelineWriteAccessRevoked(access: WriteAccess) extends RuntimeException(s"pipeline write access revoked: $access")

/** HEL-1707: the in-transaction owner-or-editor re-check for editor-reachable privileged pipeline writes. The same rule as
 *  the run-admission check (`PipelineRunRepository.submitterMayRunAction`: owner, or a `resource_permissions` row with role
 *  `editor`), with explicit predicates (never RLS or the user GUC: it runs on the privileged connection). Placed right after the
 *  write's pipeline-row lock, a plain read; a revoke committing after it still lets that one write land (no `FOR SHARE`). */
object PipelineWriteAccess {

  private val pipelinesTable = TableQuery[PipelineRepository.PipelineTable]
  private val permTable      = TableQuery[ResourcePermissionRepository.ResourcePermissionTable]

  def currentAction(pipelineId: String, userId: String)(implicit ec: ExecutionContext): DBIO[WriteAccess] = {
    val user = UUID.fromString(userId)
    pipelinesTable.filter(_.id === pipelineId).map(_.ownerId).result.headOption.flatMap {
      case None                       => DBIO.successful(WriteAccess.PipelineGone)
      case Some(owner) if owner == user => DBIO.successful(WriteAccess.Owner)
      case Some(_) =>
        permTable
          .filter(p => p.resourceType === "pipeline" && p.resourceId === pipelineId && p.granteeId === user)
          .map(_.role).result.headOption.map {
            case Some("editor") => WriteAccess.Editor
            case Some(_)        => WriteAccess.Viewer
            case None           => WriteAccess.NoAccess
          }
    }
  }

  /** Fails the transaction with [[PipelineWriteAccessRevoked]] unless `actor` may still write `pipelineId`. */
  def requireAction(pipelineId: String, actor: AuthenticatedUser)(implicit ec: ExecutionContext): DBIO[Unit] =
    currentAction(pipelineId, actor.id.value).flatMap(a => if (a.mayWrite) DBIO.successful(()) else DBIO.failed(PipelineWriteAccessRevoked(a)))
}
