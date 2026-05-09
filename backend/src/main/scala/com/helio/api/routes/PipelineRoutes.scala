package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{
  AnalyzeStepResponse,
  CreatePipelineRequest,
  ErrorResponse,
  JsonProtocols,
  PipelineAnalyzeResponse,
  PipelineSummaryResponse,
  SchemaFieldResponse,
  UpdatePipelineRequest
}
import com.helio.domain.{AuthenticatedUser, DataSourceId, PipelineAnalyzeService, SchemaField}
import com.helio.infrastructure.{DataTypeRepository, PipelineRepository, PipelineStepRepository}

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

class PipelineRoutes(
    pipelineRepo:    PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataTypeRepo:    DataTypeRepository,
    user:            AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onComplete(pipelineRepo.listSummaries()) {
                case Success(summaries) =>
                  complete(
                    StatusCodes.OK,
                    summaries.map(s =>
                      PipelineSummaryResponse(
                        id                   = s.id,
                        name                 = s.name,
                        sourceDataSourceName = s.sourceDataSourceName,
                        outputDataTypeName   = s.outputDataTypeName,
                        outputDataTypeId     = s.outputDataTypeId,
                        lastRunStatus        = s.lastRunStatus,
                        lastRunAt            = s.lastRunAt
                      )
                    )
                  )
                case Failure(ex) =>
                  complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
              }
            },
            post {
              entity(as[CreatePipelineRequest]) { req =>
                if (req.name.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("name is required"))
                else if (req.sourceDataSourceId.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("sourceDataSourceId is required"))
                else if (req.outputDataTypeName.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("outputDataTypeName is required"))
                else {
                  onComplete(pipelineRepo.create(req.name.trim, req.sourceDataSourceId.trim, req.outputDataTypeName.trim, user.id)) {
                    case Success(Right(summary)) =>
                      complete(
                        StatusCodes.Created,
                        PipelineSummaryResponse(
                          id                   = summary.id,
                          name                 = summary.name,
                          sourceDataSourceName = summary.sourceDataSourceName,
                          outputDataTypeName   = summary.outputDataTypeName,
                          outputDataTypeId     = summary.outputDataTypeId,
                          lastRunStatus        = summary.lastRunStatus,
                          lastRunAt            = summary.lastRunAt
                        )
                      )
                    case Success(Left(msg)) if msg.contains("not found") =>
                      complete(StatusCodes.NotFound, ErrorResponse(msg))
                    case Success(Left(msg)) =>
                      complete(StatusCodes.BadRequest, ErrorResponse(msg))
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                  }
                }
              }
            }
          )
        },
        // ── GET /pipelines/:id/analyze ──────────────────────────────────────
        path(Segment / "analyze") { pipelineId =>
          get {
            val summaryF  = pipelineRepo.findSummaryById(pipelineId)
            val pipelineF = pipelineRepo.findById(pipelineId)
            val stepsF    = pipelineStepRepo.listByPipeline(pipelineId)

            onComplete(for {
              summary  <- summaryF
              pipeline <- pipelineF
              steps    <- stepsF
            } yield (summary, pipeline, steps)) {
              case Success((Some(summary), Some(pipeline), steps)) =>
                onComplete(dataTypeRepo.findBySourceId(pipeline.sourceDataSourceId, user.id)) {
                  case Success(sourceDataTypes) =>
                    val sourceSchema: Vector[SchemaField] =
                      sourceDataTypes.headOption.toVector
                        .flatMap(_.fields)
                        .map(f => SchemaField(f.name, f.dataType))

                    val stepInputs = steps.map(s =>
                      PipelineAnalyzeService.PipelineStepInput(s.id, s.position, s.op, s.config)
                    )

                    val analyzed = PipelineAnalyzeService.analyze(stepInputs, sourceSchema)

                    def toFieldResponse(sf: SchemaField): SchemaFieldResponse =
                      SchemaFieldResponse(sf.name, sf.`type`)

                    complete(
                      StatusCodes.OK,
                      PipelineAnalyzeResponse(
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
                      )
                    )
                  case Failure(ex) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                }

              case Success((None, _, _)) | Success((_, None, _)) =>
                complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))

              case Failure(ex) =>
                complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
            }
          }
        },
        // ── GET/PATCH /pipelines/:id ────────────────────────────────────────
        path(Segment) { pipelineId =>
          concat(
            get {
              onComplete(pipelineRepo.findSummaryById(pipelineId)) {
                case Success(Some(summary)) =>
                  complete(
                    StatusCodes.OK,
                    PipelineSummaryResponse(
                      id                   = summary.id,
                      name                 = summary.name,
                      sourceDataSourceName = summary.sourceDataSourceName,
                      outputDataTypeName   = summary.outputDataTypeName,
                      outputDataTypeId     = summary.outputDataTypeId,
                      lastRunStatus        = summary.lastRunStatus,
                      lastRunAt            = summary.lastRunAt
                    )
                  )
                case Success(None) =>
                  complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))
                case Failure(ex) =>
                  complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
              }
            },
            patch {
              entity(as[UpdatePipelineRequest]) { req =>
                if (req.name.trim.isEmpty)
                  complete(StatusCodes.BadRequest, ErrorResponse("name must not be empty"))
                else {
                  onComplete(pipelineRepo.updateName(pipelineId, req.name.trim)) {
                    case Success(Some(summary)) =>
                      complete(
                        StatusCodes.OK,
                        PipelineSummaryResponse(
                          id                   = summary.id,
                          name                 = summary.name,
                          sourceDataSourceName = summary.sourceDataSourceName,
                          outputDataTypeName   = summary.outputDataTypeName,
                          outputDataTypeId     = summary.outputDataTypeId,
                          lastRunStatus        = summary.lastRunStatus,
                          lastRunAt            = summary.lastRunAt
                        )
                      )
                    case Success(None) =>
                      complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))
                    case Failure(ex) =>
                      complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                  }
                }
              }
            }
          )
        }
      )
    }
}
