package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{DeletePipelineStepResponse, PipelineStepConfigCodec, PipelineStepResponse, ReorderPipelineStepsRequest, UpdatePipelineStepRequest}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Step update/delete/reorder/duplicate. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineStepWrites(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    support: PipelineServiceSupport,
    requireEditorAccess: (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]]
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineService])

  import support.{audit, stepResponseWithRoot, upsertOwnershipCheckF}

  /** Step update — requires Editor or Owner. Viewer grantees get 403. */
  def updateStep(stepId: PipelineStepId, req: UpdatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] = {
    // Use internal findById (no owner-JOIN) since we only want to verify the step exists
    // and the type matches. The ACL check happens at the pipeline level below.
    pipelineStepRepo.findByIdInternal(stepId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
      case Some(existing) =>
        // Verify the caller has pipeline access (at least viewer) by finding the parent pipeline.
        pipelineRepo.findByIdShared(PipelineId(existing.pipelineId.value), Some(user)).flatMap {
          case None =>
            // Caller can't see the pipeline — step doesn't exist from their perspective.
            Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
          case Some(pipeline) =>
            // Check for editor/owner — viewers get 403.
            val editorCheckF: Future[Either[ServiceError, Unit]] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
              else requireEditorAccess(pipeline.id, user)

            editorCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  =>
                req.`type` match {
                  case Some(t) if t != existing.kind =>
                    Future.successful(Left(ServiceError.BadRequest(
                      s"Cannot change step type from '${existing.kind}' to '$t'. " +
                        "Delete the step and create a new one instead."
                    )))
                  case _ =>
                    req.config match {
                      case None =>
                        // Safe: editor/owner access confirmed. Use internal update.
                        pipelineStepRepo.updateInternal(stepId, config = None, position = req.position, enabled = req.enabled)
                          .flatMap {
                            case Some(step) =>
                              audit("pipeline.step.update", "pipeline_step", Some(step.id.value), user)
                              stepResponseWithRoot(existing.pipelineId, step).map(resp => Right(resp))
                            case None       => Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
                          }
                          .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                      case Some(cfgJson) =>
                        // HEL-860: strict write-path check runs before the tolerant
                        // decode below, mirroring addStep — see comment there.
                        val rawConfigError: Option[String] =
                          PipelineStep.rawConfigProblem(existing.kind, cfgJson.compactPrint)
                        if (rawConfigError.isDefined)
                          Future.successful(Left(ServiceError.UnprocessableEntity(rawConfigError.get)))
                        else
                        PipelineStepConfigCodec.decode(existing.kind, cfgJson.compactPrint) match {
                          case Failure(ex) =>
                            // HEL-311: keep the curated "Invalid '<type>' config" prefix,
                            // drop the raw decode-exception tail; log the detail server-side.
                            log.warn(s"updateStep: config decode failed for step type '${existing.kind}'", ex)
                            Future.successful(Left(ServiceError.BadRequest(
                              s"Invalid '${existing.kind}' config"
                            )))
                          case Success(typedConfig) =>
                            // Pre-flight ACL: the second, separately-owned DataSource a
                            // join/union/lookup config references must be caller-owned
                            // (HEL-278/HEL-384/HEL-386). An EMPTY second-source id is an
                            // incomplete draft, not a security violation — see the
                            // identical guard + rationale in addStep above (HEL-620,
                            // HEL-950: one shared extractor replacing three hand-copied
                            // per-op blocks).
                            val aclCheckF: Future[Either[ServiceError, Unit]] =
                              PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
                                case Some(id) =>
                                  dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
                                    case None    => Left(ServiceError.NotFound(s"Data source not found: $id"))
                                    case Some(_) => Right(())
                                  }
                                case None => Future.successful(Right(()))
                              }
                            // HEL-911 (design.md Engine contract items 6a/7, write-time arm):
                            // same check as `addStep`, but against the EXISTING step's actual
                            // parent chain and its own id (a step cannot reference itself).
                            val laneCheckF: Future[Either[ServiceError, Unit]] =
                              PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
                                case None => Future.successful(Right(()))
                                case Some(_) =>
                                  pipelineStepRepo.listByPipelineInternal(PipelineId(existing.pipelineId.value)).map { current =>
                                    val ancestors = PipelineService.ancestorChainOf(existing.parentStepId, current)
                                    PipelineService.validateLaneReference(typedConfig, current, ancestors, selfId = Some(existing.id.value))
                                  }
                              }
                            aclCheckF.flatMap {
                              case Left(err) => Future.successful(Left(err))
                              case Right(_)  =>
                                laneCheckF.flatMap {
                                  case Left(err) => Future.successful(Left(err))
                                  case Right(_)  =>
                                    upsertOwnershipCheckF(typedConfig, pipeline.ownerId, user).flatMap {
                                    case Left(err) => Future.successful(Left(err))
                                    case Right(_)  =>
                                    // Safe: editor/owner access confirmed. Use internal update.
                                    // HEL-1100 (design.md Decision 1): actingUserId is the PIPELINE
                                    // OWNER, not the caller -- see persistNewStep's matching doc.
                                    pipelineStepRepo.updateInternal(stepId, config = Some(typedConfig), position = req.position, enabled = req.enabled, actingUserId = pipeline.ownerId.value)
                                      .flatMap {
                                        case Some(step) =>
                                          audit("pipeline.step.update", "pipeline_step", Some(step.id.value), user)
                                          stepResponseWithRoot(existing.pipelineId, step).map(resp => Right(resp))
                                        case None       => Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
                                      }
                                      .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
  }

  /** Step delete — requires Editor or Owner. Viewer grantees get 403. */
  def deleteStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, DeletePipelineStepResponse]] =
    pipelineStepRepo.findByIdInternal(stepId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
      case Some(existing) =>
        pipelineRepo.findByIdShared(PipelineId(existing.pipelineId.value), Some(user)).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
          case Some(pipeline) =>
            val editorCheckF: Future[Either[ServiceError, Unit]] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
              else requireEditorAccess(pipeline.id, user)

            editorCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  =>
                // Safe: editor/owner access confirmed. Use internal delete.
                // HEL-904 task 1.6 / HEL-906 cycle 7 (task 3.2): deleteInternal returns
                // Option[Int] (Some(removedTailStepCount) on success, None if the step
                // didn't exist) -- now surfaced to the caller as a splice-on-delete report,
                // instead of being discarded.
                pipelineStepRepo.deleteInternal(stepId).map {
                  case Some(removedTailStepCount) =>
                    audit("pipeline.step.delete", "pipeline_step", Some(stepId.value), user)
                    Right(DeletePipelineStepResponse(removedTailStepCount))
                  case None => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
                }
            }
        }
    }

  /** Atomic whole-pipeline TRUNK reorder (HEL-407, request-shape contract revised HEL-908
   *  design.md decision 15; HEL-973 makes it root-aware) — requires Editor or Owner. Viewer
   *  grantees get 403. `req.stepIds` must be exactly a permutation of the UNION of every root's
   *  current trunk step ids (via `PipelineStepRepository.trunkOfRoot`), roots interleaved by
   *  position with no semantic weight given to that interleaving (HEL-973 owner ruling,
   *  design.md Decision 1) — no tail ids, no missing/duplicate trunk ids; otherwise 422 with a
   *  message naming the specific violation (`PipelineStepRepository.reorderTrunkInternal`'s own
   *  validation, re-derived from a fresh read rather than trusted from this pre-check, so a
   *  race cannot silently corrupt structure). Root membership is invariant under reorder by
   *  construction (design.md Decision 2): a step's owning root after the call always equals its
   *  owning root before it. Per the human's ruling on trunk-to-trunk reorder ("the tail follows
   *  its trunk step"), a moved trunk node's tail travels with it automatically — no tail row is
   *  touched by this operation. HEL-913's fail-closed 400 for a multi-root pipeline is removed:
   *  a multi-root reorder is now real, specified behaviour. */
  def reorderSteps(pipelineId: PipelineId, req: ReorderPipelineStepsRequest, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(pipeline) =>
        val editorCheckF: Future[Either[ServiceError, Unit]] =
          if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
          else requireEditorAccess(pipeline.id, user)

        editorCheckF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            // Safe: editor/owner access confirmed above. Use internal reorder — the union-of-
            // every-root's-trunk permutation contract is enforced inside reorderTrunkInternal
            // against a fresh read, not trusted from a pre-check here.
            pipelineStepRepo.reorderTrunkInternal(pipelineId, req.stepIds.map(PipelineStepId(_)))
              .flatMap {
                case Left(err) => Future.successful(Left(ServiceError.UnprocessableEntity(err)))
                case Right(steps) =>
                  // HEL-477 skeptic-final-1 round 1 (design.md Decision 7): ONE row per call,
                  // not one per step — metadata carries the resulting ordered step ids.
                  audit(
                    "pipeline.step.reorder",
                    "pipeline",
                    Some(pipelineId.value),
                    user,
                    JsObject("stepIds" -> JsArray(steps.map(s => JsString(s.id.value)).toVector))
                  )
                  // HEL-913 task 7.6a: `rootIdsOf` resolved once and threaded into every step's
                  // response, so the reordered response carries each step's real root id.
                  pipelineStepRepo.rootIdsOf(pipelineId).map { rootIdOfStep =>
                    Right(steps.map(s => PipelineStepResponse.fromDomain(s, rootIdOfStep.map { case (k, v) => k.value -> v.value })))
                  }
              }
              .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
        }
    }

  /** Duplicate a step (HEL-412) — requires Editor or Owner. Viewer grantees
   *  get 403; an unknown or invisible step masks as 404 (design.md
   *  Decision 4, the `updateStep` ACL pattern verbatim). Clones `kind`,
   *  `config`, and `enabled`, and inserts the clone directly after the
   *  original via `spliceInsertAtInternal` (HEL-904 cycle-7 fix: a real
   *  re-parenting splice, not a sibling-scoped renumber -- see that
   *  method's doc). */
  def duplicateStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] =
    pipelineStepRepo.findByIdInternal(stepId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
      case Some(existing) =>
        pipelineRepo.findByIdShared(PipelineId(existing.pipelineId.value), Some(user)).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
          case Some(pipeline) =>
            val editorCheckF: Future[Either[ServiceError, Unit]] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
              else requireEditorAccess(pipeline.id, user)

            editorCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  =>
                // design.md Decision 5: round-trip the persisted config through
                // the same typed encode/decode `addStep` uses — an unparseable
                // legacy row fails loudly (500-classified) rather than cloning
                // garbage.
                PipelineStepConfigCodec.decode(existing.kind, PipelineStepConfigCodec.encode(existing)) match {
                  case Failure(ex) =>
                    log.error(s"duplicateStep: config round-trip failed for step ${stepId.value} (kind='${existing.kind}')", ex)
                    Future.successful(Left(ServiceError.InternalError(s"Invalid '${existing.kind}' config")))
                  case Success(typedConfig) =>
                    // HEL-904 cycle-7 fix (round-4 skeptic Finding 1):
                    // `existing.id` IS the anchor -- the clone must become
                    // `existing`'s own trunk-continuation child so it lands
                    // directly after the original in executionOrder, with
                    // whatever `existing` used to continue to re-parented
                    // one hop further down by spliceInsertAtInternal.
                    // `insertAtInternal` (sibling-scoped renumber only) is
                    // NOT equivalent here: on a migrated (parent-chained)
                    // pipeline it silently appended the clone to the very
                    // end instead of splicing it in after the original --
                    // see spliceInsertAtInternal's doc for why.
                    // `Some(existing.id)` anchor makes `explicitRootId` irrelevant to the repo,
                    // same as every other parentStepId-anchored call site (task 7.3e).
                    pipelineStepRepo
                      .spliceInsertAtInternal(pipeline.id, existing.kind, typedConfig, Some(existing.id), existing.enabled, explicitRootId = None, actingUserId = pipeline.ownerId.value)
                      .flatMap { step =>
                        // HEL-477 skeptic-final-1 round 1: mirrors PanelService.duplicate's
                        // one-row-per-call convention; metadata carries the source stepId.
                        audit(
                          "pipeline.step.duplicate",
                          "pipeline_step",
                          Some(step.id.value),
                          user,
                          JsObject("sourceStepId" -> JsString(stepId.value))
                        )
                        stepResponseWithRoot(pipeline.id, step).map(resp => Right(resp))
                      }
                      .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                }
            }
        }
    }
}
