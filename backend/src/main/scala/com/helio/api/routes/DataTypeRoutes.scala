package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.DataTypeRepository

import java.time.Instant
import scala.concurrent.ExecutionContextExecutor

final class DataTypeRoutes(
    dataTypeRepo: DataTypeRepository
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("types") {
      concat(
        pathEndOrSingleSlash {
          get {
            onSuccess(dataTypeRepo.findAll()) { types =>
              complete(DataTypesResponse(items = types.map(DataTypeResponse.fromDomain)))
            }
          }
        },
        path(Segment) { typeId =>
          val id = DataTypeId(typeId)
          concat(
            get {
              onSuccess(dataTypeRepo.findById(id)) {
                case Some(dt) => complete(DataTypeResponse.fromDomain(dt))
                case None     => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
              }
            },
            patch {
              entity(as[UpdateDataTypeRequest]) { request =>
                onSuccess(dataTypeRepo.findById(id)) {
                  case None => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                  case Some(existing) =>
                    val now     = Instant.now()
                    val updated = existing.copy(
                      name      = request.name.getOrElse(existing.name),
                      fields    = request.fields
                        .map(_.map(p => DataField(p.name, p.displayName, p.dataType, p.nullable)))
                        .getOrElse(existing.fields),
                      updatedAt = now
                    )
                    onSuccess(dataTypeRepo.update(updated)) {
                      case Some(dt) => complete(DataTypeResponse.fromDomain(dt))
                      case None     => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                    }
                }
              }
            },
            delete {
              onSuccess(dataTypeRepo.findById(id)) {
                case None => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                case Some(_) =>
                  onSuccess(dataTypeRepo.isBoundToAnyPanel(id)) {
                    case true =>
                      complete(
                        StatusCodes.Conflict,
                        ErrorResponse("Cannot delete DataType: one or more panels are bound to it")
                      )
                    case false =>
                      onSuccess(dataTypeRepo.delete(id)) { _ =>
                        complete(StatusCodes.NoContent)
                      }
                  }
              }
            }
          )
        }
      )
    }
}