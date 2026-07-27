package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataTypeIdSegment
import com.helio.domain._
import com.helio.services.{DataTypeService, PanelCapabilityService}

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/types`. CRUD logic in [[DataTypeService]];
 *  `/panel-capabilities` logic in [[PanelCapabilityService]] (design.md D6 —
 *  folded into this router rather than a new file, mirroring `/rows` and
 *  `/validate-expression`). */
final class DataTypeRoutes(
    dataTypeService: DataTypeService,
    panelCapabilityService: PanelCapabilityService,
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
            parameters(
              "offset".as[Int].withDefault(Page.Default.offset),
              "limit".as[Int].withDefault(Page.Default.limit),
              "tag".optional
            ) { (offsetRaw, limitRaw, tag) =>
              if (offsetRaw < 0)
                complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
              else {
                val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                onSuccess(dataTypeService.findAll(user, page, tag)) { result =>
                  complete(PagedResult(result.items.map(DataTypeResponse.fromDomain), result.total, result.offset, result.limit))
                }
              }
            }
          }
        },
        path(DataTypeIdSegment / "rows") { id =>
          get {
            parameters("limit".as[Int].optional, "excludeContentFields".as[Boolean].withDefault(false)) {
              (limitOpt, excludeContentFields) =>
                if (limitOpt.exists(_ <= 0))
                  complete(StatusCodes.BadRequest, ErrorResponse("limit must be greater than 0"))
                else if (!excludeContentFields)
                  ServiceResponse.run(dataTypeService.listRows(id, user, limitOpt)) { rows =>
                    DataTypeRowsResponse(rows = rows, rowCount = rows.size)
                  }
                else
                  // excludeContentFields needs the DataType's own fields to compute
                  // excludeKeys (HEL-372 design.md D1) — a second owner-scoped lookup
                  // rather than threading it through listRows itself, matching the
                  // round-2 skeptic's "two-lookup approach is cleaner" allowance.
                  ServiceResponse.runWith(dataTypeService.findById(id, user)) { dt =>
                    val excludeKeys = dt.fields
                      .filter(f => DataFieldType.fromString(f.dataType).exists(t => DataFieldType.category(t) == FieldTypeCategory.Content))
                      .map(_.name)
                      .toSet
                    ServiceResponse.run(dataTypeService.listRows(id, user, limitOpt, excludeKeys)) { rows =>
                      DataTypeRowsResponse(rows = rows, rowCount = rows.size)
                    }
                  }
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
        path(DataTypeIdSegment / "panel-capabilities") { id =>
          get {
            ServiceResponse.run(panelCapabilityService.getCapabilities(id, user))(identity)
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
