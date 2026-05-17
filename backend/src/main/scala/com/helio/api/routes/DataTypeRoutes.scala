package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataTypeIdSegment
import com.helio.domain._
import com.helio.services.DataTypeService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/types`. All logic in [[DataTypeService]]. */
final class DataTypeRoutes(
    dataTypeService: DataTypeService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("types") {
      concat(
        pathEndOrSingleSlash {
          get {
            onSuccess(dataTypeService.findAll(user)) { types =>
              complete(DataTypesResponse(items = types.map(DataTypeResponse.fromDomain)))
            }
          }
        },
        path(DataTypeIdSegment / "rows") { id =>
          get {
            ServiceResponse.run(dataTypeService.listRows(id, user)) { rows =>
              DataTypeRowsResponse(rows = rows, rowCount = rows.size)
            }
          }
        },
        path(DataTypeIdSegment / "validate-expression") { id =>
          get {
            parameter("expr") { expr =>
              ServiceResponse.run(dataTypeService.validateExpression(id, expr, user)) { result =>
                ValidateExpressionResponse(valid = result.valid, message = result.message)
              }
            }
          }
        },
        path(DataTypeIdSegment) { id =>
          concat(
            get {
              ServiceResponse.run(dataTypeService.findById(id, user))(DataTypeResponse.fromDomain)
            },
            patch {
              entity(as[UpdateDataTypeRequest]) { request =>
                ServiceResponse.run(dataTypeService.update(id, request, user))(DataTypeResponse.fromDomain)
              }
            },
            delete {
              ServiceResponse.runNoContent(dataTypeService.delete(id, user))
            }
          )
        }
      )
    }
}
