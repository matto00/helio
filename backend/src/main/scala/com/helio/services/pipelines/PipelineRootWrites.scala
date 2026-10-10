package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.api.protocols.pipelines.{CreatePipelineRootRequest, PipelineRootSummaryResponse, PipelineStepConfigCodec, RemovePipelineRootResponse}
import com.helio.api.protocols.sources.{CreateSourceRequest, SqlCreateSourceRequest, StaticDataSourceRequest}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind, PipelineId, PipelineRootId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineCycleGuard, PipelineRepository, PipelineRootRepository, PipelineStepRepository}

import scala.concurrent.{ExecutionContext, Future}

/** Root add/remove (`addRoot`/`removeRoot`) and the shared root-source resolution `create` also uses. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineRootWrites(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    outputRepo: OutputRepository,
    pipelineRootRepo: PipelineRootRepository,
    sourceService: SourceService,
    dataSourceService: DataSourceService,
    support: PipelineServiceSupport,
    requireEditorAccess: (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]]
)(implicit ec: ExecutionContext) {

  import support.audit

  /** HEL-913 task 7.1a (R6 "one shape, not two"): resolves ONE `CreatePipelineRootRequest` --
   *  either branch -- down to a `DataSourceId` the caller now owns. Shared by the transactional
   *  create path (`resolveRootDataSources`), the simple create path (`create`), and `addRoot`,
   *  so `roots[]` and `add_root` can never diverge in what they accept (the exact hazard R6
   *  names). Mirrors `PipelineProposalService.resolveSource`'s D1-style mutual-exclusivity
   *  check and its per-kind dispatch, but returns just the id (not a `ResolvedSource`) since
   *  the caller tracks the id: `create` deletes the inline sources it made if the rest of the
   *  request later fails ([[compensatingInlineSources]], HEL-1469); `addRoot` does not. */
  private[pipelines] def resolveOneRootSourceId(req: CreatePipelineRootRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataSourceId]] =
    (req.sourceId.map(_.trim), req.`type`) match {
      case (Some(sid), None) if sid.nonEmpty =>
        Future.successful(Right(DataSourceId(sid)))
      case (Some(_), None) =>
        // HEL-913 R8: the HEL-950 empty-seed-id guard does not extend to roots -- a blank
        // sourceId is a hard 400, no ownership lookup performed.
        Future.successful(Left(ServiceError.BadRequest("roots: sourceId is required and must not be blank")))
      case (None, Some(kind)) =>
        resolveInlineRootSourceId(kind, req, user)
      case (Some(_), Some(_)) =>
        Future.successful(Left(ServiceError.BadRequest("roots: specify either sourceId or an inline type, not both")))
      case (None, None) =>
        Future.successful(Left(ServiceError.BadRequest("roots: sourceId or inline type is required")))
    }

  /** The inline-source branch of [[resolveOneRootSourceId]]. `sql`/`rest_api`/`static` create
   *  a brand-new caller-owned DataSource via `sourceService`/`dataSourceService` (the SAME
   *  services `POST /api/sources`/`POST /api/data-sources` use); `csv` is deliberately NOT
   *  supported here, mirroring `PipelineProposalService.resolveSource`'s own documented gap --
   *  no bytes channel exists in a JSON body for `DataSourceService.createCsv`'s upload path. */
  private def resolveInlineRootSourceId(kind: String, req: CreatePipelineRootRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataSourceId]] =
    if (sourceService == null || dataSourceService == null)
      Future.successful(Left(ServiceError.InternalError("Inline root sources are unavailable (no SourceService/DataSourceService configured)")))
    else
      req.name.map(_.trim).filter(_.nonEmpty) match {
        case None => Future.successful(Left(ServiceError.BadRequest("roots: name is required for an inline source")))
        case Some(name) =>
          // HEL-1073 design.md Decision 2: canonicalize before matching so a "static" inline
          // type (legacy caller) resolves the same branch as "dataset".
          DataSourceKind.canonicalize(kind) match {
            case DataSourceKind.Csv =>
              Future.successful(Left(ServiceError.UnprocessableEntity(
                "inline csv sources are not supported for pipeline roots; create the CSV source separately and reference it via sourceId"
              )))
            case DataSourceKind.Sql =>
              req.sqlConfig match {
                case None      => Future.successful(Left(ServiceError.BadRequest("roots: config is required for an inline source")))
                case Some(cfg) =>
                  sourceService.createSql(SqlCreateSourceRequest(name, DataSourceKind.Sql, cfg), user).map {
                    case Left(err)  => Left(err)
                    case Right(csr) => Right(DataSourceId(csr.source.id))
                  }
              }
            case DataSourceKind.RestApi =>
              req.restConfig match {
                case None      => Future.successful(Left(ServiceError.BadRequest("roots: config is required for an inline source")))
                case Some(cfg) =>
                  sourceService.createRest(CreateSourceRequest(name, DataSourceKind.RestApi, cfg, fieldOverrides = None), user).map {
                    case Left(err)  => Left(err)
                    case Right(csr) => Right(DataSourceId(csr.source.id))
                  }
              }
            case DataSourceKind.Dataset =>
              req.staticConfig match {
                case None      => Future.successful(Left(ServiceError.BadRequest("roots: config is required for an inline source")))
                case Some(cfg) =>
                  dataSourceService.createStatic(StaticDataSourceRequest(name, DataSourceKind.Dataset, cfg.columns, cfg.rows), user).map {
                    case Left(err) => Left(err)
                    case Right(ds) => Right(ds.id)
                  }
              }
            case other =>
              Future.successful(Left(ServiceError.BadRequest(s"roots: unrecognized inline type '$other'")))
          }
      }

  /** `POST /api/pipelines/:id/roots` (HEL-913 task 7.4/7.1a, R6) — appends a new root at the
   *  next available position. Requires Editor or Owner. `req` is `CreatePipelineRootRequest`,
   *  the SAME element shape `POST /api/pipelines`' `roots[]` uses -- resolved via the shared
   *  [[resolveOneRootSourceId]] (existing `sourceId` OR an inline source spec). R8: a blank
   *  `sourceId` is a 400 with NO ownership lookup; an unresolvable/unowned one is a 404. */
  def addRoot(pipelineId: PipelineId, req: CreatePipelineRootRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineRootSummaryResponse]] =
    if (pipelineRootRepo == null)
      Future.successful(Left(ServiceError.InternalError("Root creation is unavailable (no PipelineRootRepository configured)")))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case Some(pipeline) =>
          val editorCheckF: Future[Either[ServiceError, Unit]] =
            if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
            else requireEditorAccess(pipelineId, user)
          editorCheckF.flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_) =>
              resolveOneRootSourceId(req, user).flatMap {
                case Left(err) => Future.successful(Left(err))
                case Right(dsId) =>
                  dataSourceRepo.findByIdOwned(dsId, user).flatMap {
                    case None => Future.successful(Left(ServiceError.NotFound(s"Data source not found: ${dsId.value}")))
                    case Some(ds) =>
                      pipelineRootRepo.add(pipelineId, dsId, user).map { root =>
                        audit("pipeline.root.add", "pipeline", Some(pipelineId.value), user)
                        Right(PipelineRootSummaryResponse(root.id.value, ds.id.value, ds.name))
                      }.recover {
                        case PipelineCycleGuard.PipelineCycleRejected(msg) => Left(ServiceError.BadRequest(msg))
                      }
                  }
              }
          }
      }

  /** `DELETE /api/pipelines/:id/roots/:rootId` (HEL-913 task 7.4/7.5, R7) — requires Editor or
   *  Owner. **Phase 1 (refuse before touching anything):** the target root must belong to THIS
   *  pipeline (404 if not); removing the LAST root is refused (400, R1); a SURVIVING step's
   *  `lane`-kind secondary input referencing a step that would be deleted is refused (400,
   *  naming the referencing step -- engine-contract item 6a's same-pipeline-membership security
   *  boundary would otherwise be left pointing at a deleted node). **Phase 2 (one transaction):**
   *  every step descending from this root (its root-level step AND its full subtree, not just
   *  the trunk) is deleted -- `outputs`/`binary_refs` referencing those steps cascade
   *  automatically via their own FK (`ON DELETE CASCADE`); `node_snapshots` does NOT cascade
   *  (deliberately FK-free, V98's header) and is deleted EXPLICITLY
   *  (`PipelineStepRepository.removeRootCascadeAction`) -- then the root row itself, then the
   *  remaining roots' positions are compacted to `0..n-2` (R3: nothing addresses a root by
   *  position, so compaction is safe). */
  def removeRoot(pipelineId: PipelineId, rootId: PipelineRootId, user: AuthenticatedUser): Future[Either[ServiceError, RemovePipelineRootResponse]] =
    if (pipelineRootRepo == null)
      Future.successful(Left(ServiceError.InternalError("Root removal is unavailable (no PipelineRootRepository configured)")))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case Some(pipeline) =>
          val editorCheckF: Future[Either[ServiceError, Unit]] =
            if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
            else requireEditorAccess(pipelineId, user)
          editorCheckF.flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_) =>
              for {
                roots        <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
                rootIdOfStep <- pipelineStepRepo.rootIdsOf(pipelineId)
                steps        <- pipelineStepRepo.listByPipelineInternal(pipelineId)
                result       <- {
                  if (!roots.exists(_._1 == rootId))
                    Future.successful(Left(ServiceError.NotFound(s"Root not found: ${rootId.value}")))
                  else if (roots.size == 1)
                    // R1/R7 phase 1 check 1: refuse to remove the last root -- named, never a
                    // silent no-op or a 500.
                    Future.successful(Left(ServiceError.BadRequest("Cannot remove the last root of a pipeline")))
                  else {
                    val rootLevelIds = rootIdOfStep.collect { case (sid, rid) if rid == rootId => sid.value }.toSet
                    val doomedIds    = PipelineService.descendantStepIds(rootLevelIds, steps)
                    // R7 phase 1 check 2: a SURVIVING step's lane secondary input referencing a
                    // step about to be deleted is refused, naming the referencing step -- a
                    // dangling lane reference is a security-boundary violation (engine-contract
                    // item 6a), not merely untidy.
                    val survivingLaneViolations = steps.filterNot(s => doomedIds.contains(s.id.value)).flatMap { s =>
                      PipelineStepConfigCodec.secondaryLaneStepId(s.configValue).filter(doomedIds.contains).map(laneId => (s, laneId))
                    }
                    survivingLaneViolations.headOption match {
                      case Some((step, laneId)) =>
                        Future.successful(Left(ServiceError.BadRequest(
                          s"Step '${step.id.value}' has a lane secondaryInput referencing '$laneId', which would be deleted with this root -- remove or repoint that reference first"
                        )))
                      case None =>
                        // Phase 2: report the placement count, then delete, atomically (R7 phase
                        // 2 steps 3-5). Outputs about to be deleted are read BEFORE the
                        // transactional delete -- a DB-level cascade would remove them without
                        // ever producing this report (design.md R7's own callout).
                        val removedOutputsF: Future[Int] =
                          outputRepo.listByPipelineInternal(pipelineId).map(_.count { o =>
                            o.node.stepId.exists(sid => doomedIds.contains(sid.value)) || o.node.rootId.contains(rootId)
                          })
                        removedOutputsF.flatMap { removedOutputCount =>
                          val action = for {
                            removedStepIds <- pipelineStepRepo.removeRootCascadeAction(pipelineId, rootId)
                            _              <- pipelineRootRepo.removeAction(rootId)
                            _              <- pipelineRootRepo.compactPositions(pipelineId)
                          } yield removedStepIds
                          pipelineRepo.runTransactionally(user.id.value)(action).map { removedStepIds =>
                            audit("pipeline.root.remove", "pipeline", Some(pipelineId.value), user)
                            Right(RemovePipelineRootResponse(removedStepIds.size, removedOutputCount))
                          }.recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                        }
                    }
                  }
                }
              } yield result
          }
      }
}
