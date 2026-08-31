package com.helio.services.workspace

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.sources.DataSourceConfigCodec
import com.helio.api.protocols.workspace.{TeardownConflictResponse, TeardownRequest, TeardownResponse}
import com.helio.domain.model.{AuthenticatedUser, DataSourceKind}
import com.helio.infrastructure.storage.FileSystem
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository.{DeletedSource, TeardownOutcome}
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `POST /api/workspace/teardown` (HEL-366). Thin wrapper
 *  over `WorkspaceTeardownRepository.teardown`: normalizes the wire request
 *  (design.md Decision 8), maps the repository outcome to the response shape
 *  (design.md Decision 4), and runs the post-commit, best-effort file
 *  cleanup for any deleted file-backed DataSources (design.md Decision 3
 *  addendum, tasks.md 3.5) — explicitly OUTSIDE the DB transaction, matching
 *  `DataSourceService.delete`'s existing `.recover { case _ => () }` posture. */
final class WorkspaceTeardownService(
    teardownRepo: WorkspaceTeardownRepository,
    fileSystem: FileSystem,
    // HEL-838: nullable-optional wiring mirrors DashboardService's audit
    // pattern (design.md Decision 1-3) — `null` behaves as "audit disabled".
    auditService: AuditService = null
)(implicit ec: ExecutionContext) {

  /** Fire-and-forget audit call — a no-op when `auditService` is `null`. */
  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser, metadata: JsValue = JsObject.empty): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, "workspace", resourceId, metadata)

  def teardown(req: TeardownRequest, user: AuthenticatedUser): Future[Either[ServiceError, TeardownResponse]] = {
    // Design.md Decision 8: absent-from-JSON and explicit-null both mean
    // "not set" — spray-json's jsonFormat2 already collapses both to `None`
    // for an Option field, so no extra normalization is needed beyond the
    // usual `Option` handling below (tested with the field literally absent
    // per tasks.md 6.11, not just `null`).
    val dryRun = req.dryRun.getOrElse(false)
    req.tag.map(_.trim).filter(_.nonEmpty) match {
      case None =>
        Future.successful(Left(ServiceError.BadRequest("tag is required")))
      case Some(tag) =>
        RequestValidation.validateTag(Some(tag)) match {
          case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
          case Right(_) =>
            teardownRepo.teardown(tag, dryRun, user).flatMap { outcome =>
              // design.md Decision 1: gate strictly on `outcome.committed`,
              // never on nonzero counts — a committed all-zero-match
              // teardown still writes a row; dryRun/blocked never do.
              if (outcome.committed)
                audit(
                  "workspace.teardown",
                  Some(tag),
                  user,
                  JsObject(
                    "sourcesDeleted"   -> JsNumber(outcome.sourcesDeleted),
                    "pipelinesDeleted" -> JsNumber(outcome.pipelinesDeleted)
                  )
                )
              cleanupFiles(outcome).map(_ => Right(toResponse(tag, dryRun, outcome)))
            }
        }
    }
  }

  /** Best-effort, post-commit file cleanup — never fails the already-
   *  committed teardown. A no-op when the transaction didn't actually
   *  commit (blocked call or dry run: `outcome.deletedSources` is empty in
   *  both cases). */
  private def cleanupFiles(outcome: TeardownOutcome): Future[Unit] =
    Future.sequence(
      outcome.deletedSources.flatMap(filePathFor).map(path => fileSystem.delete(path).recover { case _ => () })
    ).map(_ => ())

  private def filePathFor(s: DeletedSource): Option[String] = {
    val path = s.sourceType match {
      case DataSourceKind.Csv   => DataSourceConfigCodec.decodeCsv(s.config).path
      case DataSourceKind.Text  => DataSourceConfigCodec.decodeText(s.config).path
      case DataSourceKind.Pdf   => DataSourceConfigCodec.decodePdf(s.config).path
      case DataSourceKind.Image => DataSourceConfigCodec.decodeImage(s.config).path
      case _                    => ""
    }
    if (path.isEmpty) None else Some(path)
  }

  private def toResponse(tag: String, dryRun: Boolean, outcome: TeardownOutcome): TeardownResponse =
    TeardownResponse(
      tag              = tag,
      dryRun           = dryRun,
      committed        = outcome.committed,
      blocked          = outcome.blocked,
      conflicts        = outcome.conflicts.map(c =>
        TeardownConflictResponse(c.resourceKind, c.resourceId, c.resourceName, c.reason)
      ),
      sourcesDeleted   = outcome.sourcesDeleted,
      pipelinesDeleted = outcome.pipelinesDeleted
    )
}
