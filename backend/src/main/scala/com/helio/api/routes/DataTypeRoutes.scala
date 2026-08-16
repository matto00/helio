package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataTypeIdSegment
import com.helio.domain._
import com.helio.services.{DataTypeService, PanelCapabilityService, PipelineRunService}

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/types`. CRUD logic in [[DataTypeService]];
 *  `/panel-capabilities` logic in [[PanelCapabilityService]] (design.md D6 —
 *  folded into this router rather than a new file, mirroring `/rows` and
 *  `/validate-expression`). `/assertion-status` logic in [[PipelineRunService]]
 *  (HEL-576, design.md Decision 7 — same folding rationale). */
final class DataTypeRoutes(
    dataTypeService: DataTypeService,
    panelCapabilityService: PanelCapabilityService,
    pipelineRunService: PipelineRunService,
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
            parameters(
              "limit".as[Int].optional,
              "excludeContentFields".as[Boolean].withDefault(false),
              "maxStructuredColumns".as[Int].optional
            ) { (limitOpt, excludeContentFields, maxStructuredColumns) =>
              if (limitOpt.exists(_ <= 0))
                complete(StatusCodes.BadRequest, ErrorResponse("limit must be greater than 0"))
              else if (!excludeContentFields && maxStructuredColumns.isEmpty)
                ServiceResponse.run(dataTypeService.listRows(id, user, limitOpt)) { rows =>
                  DataTypeRowsResponse(rows = rows, rowCount = rows.size)
                }
              else
                // excludeContentFields and/or maxStructuredColumns need the DataType's
                // own fields to compute excludeKeys (HEL-372 design.md D1, HEL-373
                // design.md D1 round-2 fix) — a second owner-scoped lookup rather than
                // threading it through listRows itself, matching the round-2 skeptic's
                // "two-lookup approach is cleaner" allowance. Each param independently,
                // optionally widens excludeKeys — omitting both preserves today's exact
                // unbounded-listRows behavior (the branch above).
                ServiceResponse.runWith(dataTypeService.findById(id, user)) { dt =>
                  val contentExcludeKeys =
                    if (excludeContentFields)
                      dt.fields
                        .filter(f => DataFieldType.fromString(f.dataType).exists(t => DataFieldType.category(t) == FieldTypeCategory.Content))
                        .map(_.name)
                        .toSet
                    else Set.empty[String]
                  val overflowExcludeKeys =
                    maxStructuredColumns.map(n => DataTypeService.overflowStructuredFieldNames(dt.fields, n)).getOrElse(Set.empty[String])
                  val excludeKeys = contentExcludeKeys ++ overflowExcludeKeys
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
        // HEL-576: ACL-gated via the same dataTypeService.findById(id, user)
        // check `/rows` already uses (design.md Decision 7) before delegating
        // to the privileged PipelineRunService.assertionStatusForDataType.
        path(DataTypeIdSegment / "assertion-status") { id =>
          get {
            ServiceResponse.runWith(dataTypeService.findById(id, user)) { _ =>
              onSuccess(pipelineRunService.assertionStatusForDataType(id)) { status =>
                complete(status)
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
