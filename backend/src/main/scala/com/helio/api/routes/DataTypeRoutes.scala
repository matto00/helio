package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
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
            parameters("offset".as[Int].withDefault(Page.Default.offset), "limit".as[Int].withDefault(Page.Default.limit)) { (offsetRaw, limitRaw) =>
              if (offsetRaw < 0)
                complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
              else {
                val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                onSuccess(dataTypeService.findAll(user, page)) { result =>
                  complete(PagedResult(result.items.map(DataTypeResponse.fromDomain), result.total, result.offset, result.limit))
                }
              }
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
