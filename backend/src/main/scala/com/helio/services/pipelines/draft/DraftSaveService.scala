package com.helio.services.pipelines.draft

import com.helio.api.protocols.pipelines.{DraftRunNotStarted, DraftRunOutcomeResponse, DraftRunStarted, DraftSaveRequest, DraftSaveResponse, DraftSavedDefinitionResponse, DraftSavedResponse, PipelineSummaryResponse}
import com.helio.domain.model.{AuthenticatedUser, Pipeline, PipelineId}
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineDefinitionLocks, PipelineDraftWrites, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.services.patchsets.{PatchSetApplyContext, PatchSetPipelineDefinition, PatchSetTargetFingerprint, PipelineDefinitionGone}
import com.helio.services.pipelines.{PipelineRunService, PipelineService, PipelineServiceSupport, StepReferenceChecks}
import org.slf4j.LoggerFactory
import slick.dbio.DBIO

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** `POST /api/pipelines/:id/draft/save` (HEL-1629, `docs/live-draft-preview.md` section 8): saves a whole client-side draft
 *  (create, update, delete, re-parent, reorder, Output edits) in ONE database transaction, refuses a stale base with no
 *  overwrite path, and optionally starts a run afterwards through the unchanged HEL-505 guard.
 *
 *  The transaction runs on the privileged pool after the service-level ACL check (owner or editor): its locks must reach
 *  rows RLS hides from an editor (other users' panels, alert rules), and created rows are owned by the pipeline OWNER. The
 *  verified lock protocol is on [[PipelineDefinitionLocks]]; the single transaction is [[DraftSaveTransaction]].
 *
 *  `hooks` and `locks` are the seams the specs use to hold the transaction open or fail it, and to remove one lock to
 *  prove the spec watching it can fail; production passes the defaults. */
final class DraftSaveService(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    outputRepo: OutputRepository,
    panelRepo: PanelRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRootRepo: PipelineRootRepository,
    applicationRepo: PatchSetApplicationRepository,
    auditRepo: AuditEventRepository,
    runService: PipelineRunService = null,
    locks: PipelineDefinitionLocks = PipelineDefinitionLocks.Enforced,
    hooks: DraftSaveHooks = DraftSaveHooks.None
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val writes = new PipelineDraftWrites(locks, pipelineRootRepo, pipelineStepRepo, outputRepo)
  private val reads  = new DraftDefinitionReads(pipelineStepRepo, outputRepo)
  // Only the repositories `ofAction` reads are used; the rest of the patch-set context is not touched by a definition read.
  private val definitionCtx = PatchSetApplyContext.build(panelRepo, null, dataSourceRepo, pipelineRepo, pipelineStepRepo, null, outputRepo)
  private val transaction = new DraftSaveTransaction(
    writes, pipelineStepRepo, outputRepo, panelRepo, applicationRepo, auditRepo, definitionCtx, reads, hooks
  )
  private val support = new PipelineServiceSupport(pipelineStepRepo, dataSourceRepo, null)

  /** The pipeline when `user` may edit it: owner or editor grantee. Invisible is 404, a viewer 403 (never the reverse). */
  private[services] def editable(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Pipeline]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(p) if p.ownerId.value == user.id.value => Future.successful(Right(p))
      case Some(p) =>
        pipelineRepo.findGrantRole(pipelineId, user).map {
          case Some("editor") => Right(p)
          case _              => Left(ServiceError.Forbidden())
        }
    }

  def save(pipelineId: PipelineId, req: DraftSaveRequest, user: AuthenticatedUser): Future[Either[ServiceError, DraftSaveResponse]] =
    req.runAfterSave match {
      case Some(other) if other != "run" && other != "dryRun" =>
        Future.successful(Left(ServiceError.BadRequest("runAfterSave must be \"run\", \"dryRun\" or null")))
      case _ =>
        saveCore(pipelineId, req, user, DraftSaveMode.Public).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(saved) =>
            runAfter(pipelineId, req.runAfterSave, user).map { run =>
              Right(DraftSaveResponse(
                DraftSavedResponse(saved.fingerprint, DraftSavedDefinitionResponse(saved.steps, saved.outputs), saved.applicationId),
                run
              ))
            }
        }
    }

  /** The save without the run: the public endpoint and the undo restore both come through here. */
  private[services] def saveCore(
      pipelineId: PipelineId,
      req: DraftSaveRequest,
      user: AuthenticatedUser,
      mode: DraftSaveMode
  ): Future[Either[ServiceError, DraftSaved]] =
    if (req.baseFingerprint.trim.isEmpty) Future.successful(Left(ServiceError.BadRequest("baseFingerprint is required")))
    else
      editable(pipelineId, user).flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(pipeline) =>
          pipelineRepo.runPrivileged(writes.readRows(pipelineId.value)).flatMap {
            case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
            case Some(rows) =>
              DraftDiff.plan(rows, req, mode.restoring, () => UUID.randomUUID().toString) match {
                case Left(err)   => staleBeforeInvalid(pipelineId, req, err)
                case Right(plan) =>
                  checkReferences(plan, pipeline, user).flatMap {
                    case Left(err) => staleBeforeInvalid(pipelineId, req, err)
                    case Right(()) =>
                      pipelineRepo
                        .runPrivileged(transaction.run(pipelineId.value, pipeline.name, pipeline.ownerId, user, req, plan, mode))
                        .map(saved => Right(saved): Either[ServiceError, DraftSaved])
                        .recover {
                          case DraftSaveAbort(err) => Left(err)
                          case ex =>
                            hooks.failed(ex)
                            Left(PipelineService.classifyDbError(ex))
                        }
                  }
              }
          }
      }

  /** A draft that cannot be planned or checked against the CURRENT definition is, when the base is stale, a stale draft first:
   *  a step another writer deleted makes the client's draft name an id that is gone, and the answer the client needs is
   *  "reload" (409 with the current fingerprint), not a 400 about an id. Only a draft whose base still matches is reported
   *  as the error it is. */
  private def staleBeforeInvalid(pipelineId: PipelineId, req: DraftSaveRequest, err: ServiceError): Future[Either[ServiceError, DraftSaved]] =
    pipelineRepo.runPrivilegedSnapshot(PatchSetPipelineDefinition.ofAction(pipelineId, definitionCtx)).map { state =>
      val current = PatchSetTargetFingerprint.of("pipeline", state)
      if (current != req.baseFingerprint) Left(transaction.staleError(pipelineId.value, current)): Either[ServiceError, DraftSaved]
      else Left(err)
    }.recover { case _: PipelineDefinitionGone => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")) }

  /** The reference checks that read other tables and so cannot share the transaction's snapshot (inherited from create):
   *  a secondary source must be owned by the CALLER, an `upsertsource` target by the pipeline OWNER. Run before the
   *  transaction; the transaction re-plans on the locked state and refuses to write a step these did not cover. */
  private def checkReferences(plan: DraftPlan, pipeline: Pipeline, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    plan.checkedConfigs.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, c) =>
      accF.flatMap {
        case left @ Left(_) => Future.successful(left)
        case Right(())      =>
          StepReferenceChecks.secondarySourceOwnershipF(dataSourceRepo, c.typedConfig, user).flatMap {
            case Left(id) => Future.successful(Left(ServiceError.NotFound(s"Data source not found: $id")))
            case Right(_) => support.upsertOwnershipCheckF(c.typedConfig, pipeline.ownerId, user)
          }
      }
    }

  /** The run requested with the save. The save has already committed: a rejection (the HEL-505 guard, or access) never
   *  rolls it back, it is reported beside the saved definition. */
  private def runAfter(pipelineId: PipelineId, requested: Option[String], user: AuthenticatedUser): Future[Option[DraftRunOutcomeResponse]] =
    requested match {
      case None => Future.successful(None)
      case Some(mode) if runService == null =>
        Future.successful(Some(DraftRunNotStarted(503, None, s"Runs are unavailable ($mode requested)")))
      case Some(mode) =>
        runService.submit(pipelineId, isDry = mode == "dryRun", user).map {
          case Right(result) => Some(DraftRunStarted(result.runId, if (result.blocked) "blocked" else "succeeded"))
          case Left(ServiceError.TooManyRequests(seconds, reason)) => Some(DraftRunNotStarted(429, Some(seconds), reason))
          case Left(err) => Some(DraftRunNotStarted(statusOf(err), None, err.message))
        }.recover {
          case ex =>
            log.warn(s"runAfterSave: the run for ${pipelineId.value} failed after its save committed", ex)
            Some(DraftRunNotStarted(500, None, "The run could not be started"))
        }
    }

  private def statusOf(err: ServiceError): Int = err match {
    case _: ServiceError.BadRequest | _: ServiceError.StepConfigInvalid => 400
    case _: ServiceError.Forbidden                                       => 403
    case _: ServiceError.NotFound                                        => 404
    case _: ServiceError.Conflict | _: ServiceError.PatchSetStale        => 409
    case _: ServiceError.UnprocessableEntity                             => 422
    case _                                                               => 500
  }

  /** `GET /api/pipelines/:id` with the fingerprint (and, with `includeDefinition`, the steps and Outputs it was computed
   *  from). The fingerprint covers other users' panels and alert rules, so it is computed on the privileged pool, and in ONE
   *  read-only REPEATABLE READ snapshot: separate READ COMMITTED reads could straddle a writer's commit and pair a
   *  fingerprint with a definition it was not computed from (content ABA). */
  def read(pipelineId: PipelineId, user: AuthenticatedUser, includeDefinition: Boolean): Future[Either[ServiceError, PipelineSummaryResponse]] =
    pipelineRepo.findSummaryByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(summary) =>
        pipelineRepo.runPrivilegedSnapshot(
          for {
            state <- PatchSetPipelineDefinition.ofAction(pipelineId, definitionCtx)
            defn  <- if (includeDefinition) reads.definition(pipelineId).map(Some(_)) else DBIO.successful(None)
          } yield (PatchSetTargetFingerprint.of("pipeline", state), defn)
        ).map { case (fingerprint, defn) =>
          Right(support.toSummaryResponse(summary).copy(fingerprint = Some(fingerprint), definition = defn.map { case (s, o) => reads.json(s, o) }))
        }.recover {
          case _: PipelineDefinitionGone => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
        }
    }
}
