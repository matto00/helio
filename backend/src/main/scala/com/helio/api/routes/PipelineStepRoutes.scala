package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols, CreatePipelineStepRequest, UpdatePipelineStepRequest, PipelineStepResponse}
import com.helio.infrastructure.{PipelineRepository, PipelineStepRepository}

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

class PipelineStepRoutes(stepRepo: PipelineStepRepository, pipelineRepo: PipelineRepository)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  private val allowedOps: Set[String] = Set("rename", "filter", "join", "compute", "groupby", "cast")

  /** Classify a database exception into an appropriate HTTP status code + error message. */
  private def classifyDbError(ex: Throwable): (StatusCode, ErrorResponse) = ex match {
    case e: org.postgresql.util.PSQLException =>
      val msg = Option(e.getMessage).getOrElse(e.getClass.getName)
      if (msg.contains("violates foreign key constraint"))
        (StatusCodes.NotFound, ErrorResponse(msg))
      else if (msg.contains("violates check constraint"))
        (StatusCodes.BadRequest, ErrorResponse(msg))
      else
        (StatusCodes.InternalServerError, ErrorResponse(msg))
    case other =>
      (StatusCodes.InternalServerError, ErrorResponse(Option(other.getMessage).getOrElse(other.getClass.getName)))
  }

  val routes: Route = concat(
    pathPrefix("pipelines" / Segment / "steps") { pipelineId =>
      pathEndOrSingleSlash {
        concat(
          get {
            onComplete(pipelineRepo.exists(pipelineId)) {
              case Failure(ex) =>
                complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
              case Success(false) =>
                complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))
              case Success(true) =>
                onComplete(stepRepo.listByPipeline(pipelineId)) {
                  case Success(rows) =>
                    complete(StatusCodes.OK, rows.map(PipelineStepResponse.fromRow))
                  case Failure(ex) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                }
            }
          },
          post {
            entity(as[CreatePipelineStepRequest]) { req =>
              if (!allowedOps.contains(req.op))
                complete(
                  StatusCodes.BadRequest,
                  ErrorResponse(s"Invalid op '${req.op}'. Allowed values: ${allowedOps.mkString(", ")}")
                )
              else
                onComplete(pipelineRepo.exists(pipelineId)) {
                  case Failure(ex) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                  case Success(false) =>
                    complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline not found: $pipelineId"))
                  case Success(true) =>
                    onComplete(stepRepo.insert(pipelineId, req.op, req.config)) {
                      case Success(row) =>
                        complete(StatusCodes.Created, PipelineStepResponse.fromRow(row))
                      case Failure(ex) =>
                        val (code, err) = classifyDbError(ex)
                        complete(code, err)
                    }
                }
            }
          }
        )
      }
    },
    pathPrefix("pipeline-steps" / Segment) { stepId =>
      pathEndOrSingleSlash {
        concat(
          patch {
            entity(as[UpdatePipelineStepRequest]) { req =>
              req.op match {
                case Some(op) if !allowedOps.contains(op) =>
                  complete(
                    StatusCodes.BadRequest,
                    ErrorResponse(s"Invalid op '$op'. Allowed values: ${allowedOps.mkString(", ")}")
                  )
                case _ =>
                  onComplete(stepRepo.update(stepId, req.op, req.config, req.position)) {
                    case Success(Some(row)) =>
                      complete(StatusCodes.OK, PipelineStepResponse.fromRow(row))
                    case Success(None) =>
                      complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline step not found: $stepId"))
                    case Failure(ex) =>
                      val (code, err) = classifyDbError(ex)
                      complete(code, err)
                  }
              }
            }
          },
          delete {
            onComplete(stepRepo.delete(stepId)) {
              case Success(true)  => complete(StatusCodes.NoContent)
              case Success(false) => complete(StatusCodes.NotFound, ErrorResponse(s"Pipeline step not found: $stepId"))
              case Failure(ex)    => complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
            }
          }
        )
      }
    }
  )
}
