package com.helio.services

import com.helio.api.protocols.{
  AggregateAnalyzeStepResponse,
  AnalyzeStepResponse,
  CastAnalyzeStepResponse,
  ComputeAnalyzeStepResponse,
  CreatePipelineRequest,
  CreatePipelineStepRequest,
  FilterAnalyzeStepResponse,
  GroupByAnalyzeStepResponse,
  JoinAnalyzeStepResponse,
  LimitAnalyzeStepResponse,
  PipelineAnalyzeResponse,
  PipelineStepConfigCodec,
  PipelineStepResponse,
  PipelineSummaryResponse,
  RenameAnalyzeStepResponse,
  SchemaFieldResponse,
  SelectAnalyzeStepResponse,
  SortAnalyzeStepResponse,
  UpdatePipelineRequest,
  UpdatePipelineStepRequest
}
import com.helio.domain.{
  AggregateConfig,
  AuthenticatedUser,
  CastConfig,
  ComputeConfig,
  DataSourceId,
  FilterConfig,
  GroupByConfig,
  JoinConfig,
  LimitConfig,
  PipelineAnalyzeService,
  PipelineId,
  PipelineStepId,
  PipelineStepKind,
  RenameConfig,
  SchemaField,
  SelectConfig,
  SortConfig
}
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.PipelineRepository.PipelineSummary
import org.postgresql.util.PSQLException

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Business logic for `/api/pipelines` and `/api/pipeline-steps`.
 *
 *  Run lifecycle lives in [[PipelineRunService]] (split out in CS2c-3a). The
 *  allow-list of step kinds is sourced from [[PipelineStepKind.All]] —
 *  the sealed-trait subclasses are the single source of truth.
 *
 *  HEL-279: sharing-aware ACL threading.
 *  - Read paths (findSummaryById, listSteps, analyze) use findByIdShared —
 *    owner and grantees (editor + viewer) can read.
 *  - Owner-only mutation paths (delete, updateName) use findByIdOwned —
 *    grantees and cross-user callers receive 404 (no existence leak).
 *  - Step mutations (addStep, updateStep, deleteStep) require Editor or Owner;
 *    viewer grantees receive 403. Internal step repo methods (no owner-JOIN) are
 *    used after access is confirmed so editor grantees are not blocked by the
 *    V35 pipeline_steps RLS policy. */
final class PipelineService(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo:   DataSourceRepository,
    dataTypeRepo:     DataTypeRepository
)(implicit ec: ExecutionContext) {

  // ── Pipeline CRUD ─────────────────────────────────────────────────────────

  def listSummaries(user: AuthenticatedUser): Future[Vector[PipelineSummaryResponse]] =
    pipelineRepo.listSummaries(user).map(_.map(toSummaryResponse))

  /** Sharing-aware read. Owner, editor, and viewer grantees can read. */
  def findSummaryById(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] =
    pipelineRepo.findSummaryByIdShared(pipelineId, Some(user)).map {
      case Some(summary) => Right(toSummaryResponse(summary))
      case None          => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
    }

  def create(req: CreatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] = {
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (req.sourceDataSourceId.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("sourceDataSourceId is required")))
    else if (req.outputDataTypeName.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("outputDataTypeName is required")))
    else
      pipelineRepo.create(req.name.trim, DataSourceId(req.sourceDataSourceId.trim), req.outputDataTypeName.trim, user).map {
        case Right(summary)                       => Right(toSummaryResponse(summary))
        case Left(msg) if msg.contains("not found") => Left(ServiceError.NotFound(msg))
        case Left(msg)                              => Left(ServiceError.BadRequest(msg))
      }
  }

  /** Owner-only rename. Grantees (editor or viewer) receive 403 because
   *  findByIdOwned returns None for non-owners, surfaced as NotFound (no existence leak). */
  def updateName(pipelineId: PipelineId, req: UpdatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name must not be empty")))
    else
      pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
        case None =>
          Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case Some(_) =>
          pipelineRepo.updateName(pipelineId, req.name.trim, user).map {
            case Some(summary) => Right(toSummaryResponse(summary))
            case None          => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
          }
      }

  /** Owner-only delete. Grantees (editor or viewer) receive 403 because
   *  findByIdOwned returns None for non-owners, surfaced as NotFound (no existence leak). */
  def delete(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        pipelineRepo.delete(pipelineId, user).map {
          case true  => Right(())
          case false => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
        }
    }

  // ── Analyze ───────────────────────────────────────────────────────────────

  /** Sharing-aware analyze. Owner, editor, and viewer can analyze. */
  def analyze(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeResponse]] = {
    val summaryF  = pipelineRepo.findSummaryByIdShared(pipelineId, Some(user))
    val pipelineF = pipelineRepo.findByIdShared(pipelineId, Some(user))

    val combined = for {
      summary  <- summaryF
      pipeline <- pipelineF
    } yield (summary, pipeline)

    combined.flatMap {
      case (Some(summary), Some(pipeline)) =>
        // Safe: access confirmed by findByIdShared above.
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { steps =>
          dataTypeRepo.findBySourceId(pipeline.sourceDataSourceId, user.id).map { sourceDataTypes =>
            val sourceSchema: Vector[SchemaField] =
              sourceDataTypes.headOption.toVector.flatMap(_.fields).map(f => SchemaField(f.name, f.dataType))

            val stepInputs = steps.map(s =>
              PipelineAnalyzeService.PipelineStepInput(
                id       = s.id.value,
                position = s.position,
                op       = s.kind,
                config   = PipelineStepConfigCodec.encode(s)
              )
            )
            val analyzed = PipelineAnalyzeService.analyze(stepInputs, sourceSchema)

            Right(PipelineAnalyzeResponse(
              id                   = summary.id,
              name                 = summary.name,
              sourceDataSourceName = summary.sourceDataSourceName,
              outputDataTypeName   = summary.outputDataTypeName,
              outputDataTypeId     = summary.outputDataTypeId,
              sourceSchema         = sourceSchema.map(toFieldResponse),
              steps                = analyzed.map(toAnalyzeStepResponse)
            ))
          }
        }
      case _ =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
    }
  }

  /** Map the analyze service's stringly-typed step output back into the
   *  discriminated-union wire shape by re-decoding the config blob into its
   *  typed `*Config` and constructing the appropriate per-subtype response. */
  private def toAnalyzeStepResponse(s: PipelineAnalyzeService.AnalyzedStep): AnalyzeStepResponse = {
    val inSchema  = s.inputSchema.map(toFieldResponse)
    val outSchema = s.outputSchema.map(toFieldResponse)
    PipelineStepConfigCodec.decode(s.op, s.config) match {
      case Success(cfg: RenameConfig)    => RenameAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: FilterConfig)    => FilterAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: JoinConfig)      => JoinAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: ComputeConfig)   => ComputeAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: GroupByConfig)   => GroupByAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: CastConfig)      => CastAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: SelectConfig)    => SelectAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: LimitConfig)     => LimitAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: SortConfig)      => SortAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: AggregateConfig) => AggregateAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(other) =>
        throw new IllegalStateException(
          s"PipelineService.toAnalyzeStepResponse: codec returned unexpected config type ${other.getClass.getName} for op '${s.op}'"
        )
      case Failure(ex) =>
        throw new IllegalStateException(
          s"PipelineService.toAnalyzeStepResponse: failed to decode persisted config for analyze step ${s.id}: ${ex.getMessage}",
          ex
        )
    }
  }

  // ── Pipeline step CRUD ────────────────────────────────────────────────────

  /** Sharing-aware step list. Owner, editor, and viewer can list steps. */
  def listSteps(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        // Safe: access confirmed by findByIdShared above. Use internal variant
        // so editor/viewer grantees are not blocked by the V35 pipeline_steps
        // RLS owner-JOIN policy.
        pipelineStepRepo.listByPipelineInternal(pipelineId).map(steps => Right(steps.map(PipelineStepResponse.fromDomain)))
    }

  /** Step creation — requires Editor or Owner. Viewer grantees get 403. */
  def addStep(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] = {
    if (!PipelineStepKind.All.contains(req.`type`))
      Future.successful(Left(ServiceError.BadRequest(
        s"Invalid step type '${req.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      )))
    else
      PipelineStepConfigCodec.decode(req.`type`, req.config.compactPrint) match {
        case Failure(ex) =>
          Future.successful(Left(ServiceError.BadRequest(
            s"Invalid '${req.`type`}' config: ${ex.getMessage}"
          )))
        case Success(typedConfig) =>
          // Pre-flight ACL: JoinStep right-source must be caller-owned (HEL-278).
          val joinCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
            case jc: JoinConfig =>
              dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user).map {
                case None    => Left(ServiceError.NotFound(s"Data source not found: ${jc.rightDataSourceId}"))
                case Some(_) => Right(())
              }
            case _ => Future.successful(Right(()))
          }
          joinCheckF.flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_)  =>
              pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
                case None =>
                  Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
                case Some(pipeline) if pipeline.ownerId.value != user.id.value =>
                  // Grantee path — findByIdShared returned Some, so caller has viewer or editor access.
                  // Distinguish editor from viewer via requireEditorAccess before allowing mutation.
                  requireEditorAccess(pipelineId, user).flatMap {
                    case Left(err) => Future.successful(Left(err))
                    case Right(_) =>
                      // Safe: editor access confirmed. Use internal insert (no owner-JOIN).
                      pipelineStepRepo.insertInternal(pipelineId, req.`type`, typedConfig)
                        .map(step => Right(PipelineStepResponse.fromDomain(step)))
                        .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                  }
                case Some(_) =>
                  // Owner path — use internal insert (same as before, owner already confirmed)
                  pipelineStepRepo.insertInternal(pipelineId, req.`type`, typedConfig)
                    .map(step => Right(PipelineStepResponse.fromDomain(step)))
                    .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
              }
          }
      }
  }

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
                        pipelineStepRepo.updateInternal(stepId, config = None, position = req.position)
                          .map {
                            case Some(step) => Right(PipelineStepResponse.fromDomain(step))
                            case None       => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
                          }
                          .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                      case Some(cfgJson) =>
                        PipelineStepConfigCodec.decode(existing.kind, cfgJson.compactPrint) match {
                          case Failure(ex) =>
                            Future.successful(Left(ServiceError.BadRequest(
                              s"Invalid '${existing.kind}' config: ${ex.getMessage}"
                            )))
                          case Success(typedConfig) =>
                            val joinCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
                              case jc: JoinConfig =>
                                dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user).map {
                                  case None    => Left(ServiceError.NotFound(s"Data source not found: ${jc.rightDataSourceId}"))
                                  case Some(_) => Right(())
                                }
                              case _ => Future.successful(Right(()))
                            }
                            joinCheckF.flatMap {
                              case Left(err) => Future.successful(Left(err))
                              case Right(_)  =>
                                // Safe: editor/owner access confirmed. Use internal update.
                                pipelineStepRepo.updateInternal(stepId, config = Some(typedConfig), position = req.position)
                                  .map {
                                    case Some(step) => Right(PipelineStepResponse.fromDomain(step))
                                    case None       => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
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

  /** Step delete — requires Editor or Owner. Viewer grantees get 403. */
  def deleteStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
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
                pipelineStepRepo.deleteInternal(stepId).map {
                  case true  => Right(())
                  case false => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
                }
            }
        }
    }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Verifies that the caller has editor (not just viewer) access to the pipeline.
   *  Called only when the caller is NOT the owner (i.e. they have a grant).
   *  Returns Right(()) for editor grantees; Left(Forbidden) for viewer grantees. */
  private def requireEditorAccess(
      pipelineId: PipelineId,
      user:       AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    // We know caller != owner and findByIdShared returned Some, so they have a grant.
    // Query the grant role to distinguish editor from viewer.
    pipelineRepo.findGrantRole(pipelineId, user).map {
      case Some("editor") => Right(())
      case _              => Left(ServiceError.Forbidden("Forbidden"))
    }

  private def toSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      sourceDataSourceName = s.sourceDataSourceName,
      outputDataTypeName   = s.outputDataTypeName,
      outputDataTypeId     = s.outputDataTypeId,
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None
    )

  private def toFieldResponse(sf: SchemaField): SchemaFieldResponse =
    SchemaFieldResponse(sf.name, sf.`type`)
}

object PipelineService {

  /** Classify a DB exception into the appropriate ServiceError variant. */
  private[services] def classifyDbError(ex: Throwable): ServiceError = ex match {
    case e: PSQLException =>
      val msg = Option(e.getMessage).getOrElse(e.getClass.getName)
      if (msg.contains("violates foreign key constraint"))
        ServiceError.NotFound(msg)
      else if (msg.contains("violates check constraint"))
        ServiceError.BadRequest(msg)
      else
        ServiceError.InternalError(msg)
    case other =>
      ServiceError.InternalError(Option(other.getMessage).getOrElse(other.getClass.getName))
  }
}
