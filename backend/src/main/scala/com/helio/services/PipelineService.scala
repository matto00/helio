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
 *  the sealed-trait subclasses are the single source of truth. */
final class PipelineService(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo:   DataSourceRepository,
    dataTypeRepo:     DataTypeRepository
)(implicit ec: ExecutionContext) {

  // ── Pipeline CRUD ─────────────────────────────────────────────────────────

  def listSummaries(user: AuthenticatedUser): Future[Vector[PipelineSummaryResponse]] =
    pipelineRepo.listSummaries(user).map(_.map(toSummaryResponse))

  def findSummaryById(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] =
    pipelineRepo.findSummaryById(pipelineId, user).map {
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

  def updateName(pipelineId: PipelineId, req: UpdatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name must not be empty")))
    else
      pipelineRepo.updateName(pipelineId, req.name.trim, user).map {
        case Some(summary) => Right(toSummaryResponse(summary))
        case None          => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
      }

  def delete(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    pipelineRepo.delete(pipelineId, user).map {
      case true  => Right(())
      case false => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
    }

  // ── Analyze ───────────────────────────────────────────────────────────────

  def analyze(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeResponse]] = {
    val summaryF  = pipelineRepo.findSummaryById(pipelineId, user)
    val pipelineF = pipelineRepo.findById(pipelineId, user)
    val stepsF    = pipelineStepRepo.listByPipeline(pipelineId, user)

    val combined = for {
      summary  <- summaryF
      pipeline <- pipelineF
      steps    <- stepsF
    } yield (summary, pipeline, steps)

    combined.flatMap {
      case (Some(summary), Some(pipeline), steps) =>
        dataTypeRepo.findBySourceId(pipeline.sourceDataSourceId, user.id).map { sourceDataTypes =>
          val sourceSchema: Vector[SchemaField] =
            sourceDataTypes.headOption.toVector.flatMap(_.fields).map(f => SchemaField(f.name, f.dataType))

          // Re-encode the typed config to a JSON string for the (still
          // stringly-typed) PipelineAnalyzeService inference engine. The
          // analyze layer is a downstream consumer that we deliberately keep
          // untouched in CS2c-3a — its operators read raw JSON fields, so
          // round-tripping through the codec preserves behavior.
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
        // Surface the error in the step's validationError; preserve the input
        // schema as the output schema (matches the analyze fallback contract).
        throw new IllegalStateException(
          s"PipelineService.toAnalyzeStepResponse: failed to decode persisted config for analyze step ${s.id}: ${ex.getMessage}",
          ex
        )
    }
  }

  // ── Pipeline step CRUD ────────────────────────────────────────────────────

  def listSteps(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    pipelineRepo.exists(pipelineId, user).flatMap {
      case false => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case true  =>
        pipelineStepRepo.listByPipeline(pipelineId, user).map(steps => Right(steps.map(PipelineStepResponse.fromDomain)))
    }

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
          // Existence-not-leaked semantics: 404 for missing or not-owned source.
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
              pipelineRepo.exists(pipelineId, user).flatMap {
                case false => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
                case true  =>
                  pipelineStepRepo.insert(pipelineId, req.`type`, typedConfig)
                    .map(step => Right(PipelineStepResponse.fromDomain(step)))
                    .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
              }
          }
      }
  }

  def updateStep(stepId: PipelineStepId, req: UpdatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] = {
    // Cross-type PATCH lock: matches CS2c-2 DataSource policy. If a `type`
    // discriminator is supplied and disagrees with the persisted row's kind,
    // we reject with 400. The UI never offers cross-type conversion; this
    // keeps the ADT honest against accidental client misuse.
    pipelineStepRepo.findById(stepId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
      case Some(existing) =>
        req.`type` match {
          case Some(t) if t != existing.kind =>
            Future.successful(Left(ServiceError.BadRequest(
              s"Cannot change step type from '${existing.kind}' to '$t'. " +
                "Delete the step and create a new one instead."
            )))
          case _ =>
            req.config match {
              case None =>
                pipelineStepRepo.update(stepId, config = None, position = req.position, user)
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
                    // Pre-flight ACL: JoinStep right-source must be caller-owned (HEL-278).
                    // Existence-not-leaked semantics: 404 for missing or not-owned source.
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
                        pipelineStepRepo.update(stepId, config = Some(typedConfig), position = req.position, user)
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

  def deleteStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    pipelineStepRepo.delete(stepId, user).map {
      case true  => Right(())
      case false => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
    }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private def toSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      sourceDataSourceName = s.sourceDataSourceName,
      outputDataTypeName   = s.outputDataTypeName,
      outputDataTypeId     = s.outputDataTypeId,
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount
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
