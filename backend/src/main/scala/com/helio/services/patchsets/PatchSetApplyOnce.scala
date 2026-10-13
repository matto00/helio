package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.PatchSetApplyResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.services.ServiceError

import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Apply-once for a server-minted `proposalId` (HEL-1522). A patch set with a `proposalId` claims it for the caller
 *  after the stale check and before the first write, so a second apply of the same proposal is refused (the claim
 *  table's primary key makes concurrent applies race-safe). The claim is released ONLY when no write survived: a
 *  failure before any write, or an apply whose every edit rolled back cleanly. A failed Future (rollback may have been
 *  skipped), a journaling failure or any `recreated`/`unrecoverable` outcome keeps it -- failing toward "never apply
 *  twice". A patch set without a `proposalId` is applied exactly as before. */
private[services] object PatchSetApplyOnce {

  private val AlreadyAppliedMessage =
    "This proposal was already applied. Nothing was changed; ask for a new proposal to make further changes."

  private val log = LoggerFactory.getLogger(getClass)

  /** The claim bookkeeping that follows the apply must never change the apply's own outcome: a failure here is logged
   *  and swallowed. Worst case the claim stays (a retry reads "already applied", the safe direction) or loses its
   *  application id. */
  private def bookkeeping(what: String, proposalId: String)(action: => Future[Unit])(implicit ec: ExecutionContext): Future[Unit] =
    action.recover { case NonFatal(e) => log.warn(s"Could not $what proposal $proposalId after the apply finished; keeping the apply's result", e) }

  def run(repo: PatchSetApplicationRepository, proposalId: Option[String], user: AuthenticatedUser)(
      apply: => Future[Either[ServiceError, PatchSetApplyResponse]]
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, PatchSetApplyResponse]] =
    proposalId match {
      case None => apply
      case Some(id) =>
        repo.claimProposal(user, id).flatMap {
          case false => Future.successful(Left(ServiceError.PatchSetAlreadyApplied(AlreadyAppliedMessage)))
          case true =>
            apply.flatMap {
              case result @ Right(response) =>
                response.applicationId match {
                  case Some(applicationId) => bookkeeping(s"attach application $applicationId to", id)(repo.attachApplication(user, id, applicationId)).map(_ => result)
                  case None if response.edits.forall(_.status == "rolledBack") => bookkeeping("release", id)(repo.releaseProposal(user, id)).map(_ => result)
                  case None => Future.successful(result)
                }
              case left => bookkeeping("release", id)(repo.releaseProposal(user, id)).map(_ => left)
            }
        }
    }
}
