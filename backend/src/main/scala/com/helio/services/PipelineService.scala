package com.helio.services

import com.helio.api.protocols.{
  AnalyzeStepResponse,
  CreatePipelineRequest,
  CreatePipelineStepRequest,
  PipelineAnalyzeResponse,
  PipelineStepResponse,
  PipelineSummaryResponse,
  SchemaFieldResponse,
  UpdatePipelineRequest,
  UpdatePipelineStepRequest
}
import com.helio.domain.{AuthenticatedUser, PipelineAnalyzeService, PipelineId, SchemaField}
import com.helio.infrastructure.{DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.PipelineRepository.PipelineSummary
import org.postgresql.util.PSQLException

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/pipelines` and `/api/pipeline-steps`.
 *
 *  Excludes run lifecycle (`PipelineRunRoutes`) — that's CS2c when the engine
 *  is also being decomposed. */
final class PipelineService(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataTypeRepo:     DataTypeRepository
)(implicit ec: ExecutionContext) {

  // ── Pipeline CRUD ─────────────────────────────────────────────────────────

  def listSummaries(): Future[Vector[PipelineSummaryResponse]] =
    pipelineRepo.listSummaries().map(_.map(toSummaryResponse))

  def findSummaryById(pipelineId: PipelineId): Future[Either[ServiceError, PipelineSummaryResponse]] =
    pipelineRepo.findSummaryById(pipelineId.value).map {
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
      pipelineRepo.create(req.name.trim, req.sourceDataSourceId.trim, req.outputDataTypeName.trim, user.id).map {
        case Right(summary)                       => Right(toSummaryResponse(summary))
        case Left(msg) if msg.contains("not found") => Left(ServiceError.NotFound(msg))
        case Left(msg)                              => Left(ServiceError.BadRequest(msg))
      }
  }

  def updateName(pipelineId: PipelineId, req: UpdatePipelineRequest): Future[Either[ServiceError, PipelineSummaryResponse]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name must not be empty")))
    else
      pipelineRepo.updateName(pipelineId.value, req.name.trim).map {
        case Some(summary) => Right(toSummaryResponse(summary))
        case None          => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
      }

  def delete(pipelineId: PipelineId): Future[Either[ServiceError, Unit]] =
    pipelineRepo.delete(pipelineId.value).map {
      case true  => Right(())
      case false => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
    }

  // ── Analyze ───────────────────────────────────────────────────────────────

  def analyze(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeResponse]] = {
    val summaryF  = pipelineRepo.findSummaryById(pipelineId.value)
    val pipelineF = pipelineRepo.findById(pipelineId.value)
    val stepsF    = pipelineStepRepo.listByPipeline(pipelineId.value)

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

          val stepInputs = steps.map(s =>
            PipelineAnalyzeService.PipelineStepInput(s.id, s.position, s.op, s.config)
          )
          val analyzed = PipelineAnalyzeService.analyze(stepInputs, sourceSchema)

          Right(PipelineAnalyzeResponse(
            id                   = summary.id,
            name                 = summary.name,
            sourceDataSourceName = summary.sourceDataSourceName,
            outputDataTypeName   = summary.outputDataTypeName,
            outputDataTypeId     = summary.outputDataTypeId,
            sourceSchema         = sourceSchema.map(toFieldResponse),
            steps                = analyzed.map { s =>
              AnalyzeStepResponse(
                id              = s.id,
                position        = s.position,
                op              = s.op,
                config          = s.config,
                inputSchema     = s.inputSchema.map(toFieldResponse),
                outputSchema    = s.outputSchema.map(toFieldResponse),
                validationError = s.validationError
              )
            }
          ))
        }
      case _ =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
    }
  }

  // ── Pipeline step CRUD ────────────────────────────────────────────────────

  def listSteps(pipelineId: PipelineId): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    pipelineRepo.exists(pipelineId.value).flatMap {
      case false => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case true  =>
        pipelineStepRepo.listByPipeline(pipelineId.value).map(rows => Right(rows.map(PipelineStepResponse.fromRow)))
    }

  def addStep(pipelineId: PipelineId, req: CreatePipelineStepRequest): Future[Either[ServiceError, PipelineStepResponse]] =
    if (!PipelineService.AllowedOps.contains(req.op))
      Future.successful(Left(ServiceError.BadRequest(
        s"Invalid op '${req.op}'. Allowed values: ${PipelineService.AllowedOps.mkString(", ")}"
      )))
    else
      pipelineRepo.exists(pipelineId.value).flatMap {
        case false => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case true  =>
          pipelineStepRepo.insert(pipelineId.value, req.op, req.config)
            .map(row => Right(PipelineStepResponse.fromRow(row)))
            .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
      }

  def updateStep(stepId: String, req: UpdatePipelineStepRequest): Future[Either[ServiceError, PipelineStepResponse]] =
    req.op match {
      case Some(op) if !PipelineService.AllowedOps.contains(op) =>
        Future.successful(Left(ServiceError.BadRequest(
          s"Invalid op '$op'. Allowed values: ${PipelineService.AllowedOps.mkString(", ")}"
        )))
      case _ =>
        pipelineStepRepo.update(stepId, req.op, req.config, req.position)
          .map {
            case Some(row) => Right(PipelineStepResponse.fromRow(row))
            case None      => Left(ServiceError.NotFound(s"Pipeline step not found: $stepId"))
          }
          .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
    }

  def deleteStep(stepId: String): Future[Either[ServiceError, Unit]] =
    pipelineStepRepo.delete(stepId).map {
      case true  => Right(())
      case false => Left(ServiceError.NotFound(s"Pipeline step not found: $stepId"))
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

  val AllowedOps: Set[String] =
    Set("rename", "filter", "join", "compute", "groupby", "cast", "select", "limit", "sort")

  /** Classify a DB exception into the appropriate ServiceError variant.
   *  Mirrors `PipelineStepRoutes.classifyDbError` exactly. */
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
