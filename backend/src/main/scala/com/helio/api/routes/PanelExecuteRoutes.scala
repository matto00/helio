package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PanelRepository}
import spray.json._

import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.util.{Failure, Success}

final class PanelExecuteRoutes(
    panelRepo: PanelRepository,
    dataTypeRepo: DataTypeRepository,
    dataSourceRepo: DataSourceRepository,
    aclDirective: AclDirective,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("panels") {
      path(Segment / "execute") { panelId =>
        get {
          parameters("page".as[Int].withDefault(0), "pageSize".as[Int].withDefault(50)) {
            (page, pageSize) =>
              // Task 1.4 — validate page and pageSize
              if (page < 0) {
                complete(StatusCodes.BadRequest, ErrorResponse("page must be >= 0"))
              } else if (pageSize < 1 || pageSize > 500) {
                complete(
                  StatusCodes.BadRequest,
                  ErrorResponse("pageSize must be between 1 and 500")
                )
              } else {
                onSuccess(panelRepo.findById(PanelId(panelId))) {
                  case None =>
                    complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                  case Some(panel) =>
                    aclDirective.authorizeResourceWithSharing(
                      "dashboard",
                      panel.dashboardId.value,
                      Some(user),
                      "Dashboard not found"
                    ) { _ =>
                      val resultFuture = panel.typeId match {
                        case None =>
                          Future.successful(Left("Panel is not bound to a data type"))
                        case Some(typeId) =>
                          dataTypeRepo.findById(typeId).flatMap {
                            case None =>
                              Future.successful(Left("Data type not found"))
                            case Some(dataType) =>
                              dataType.sourceId match {
                                case None =>
                                  Future.successful(Left("Data type has no data source"))
                                case Some(sourceId) =>
                                  dataSourceRepo.findById(sourceId).flatMap {
                                    case None =>
                                      Future.successful(Left("Data source not found"))
                                    case Some(dataSource) =>
                                      executePaginated(dataSource, page, pageSize)
                                  }
                              }
                          }
                      }
                      onComplete(resultFuture) {
                        case Failure(ex) =>
                          complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                        case Success(Left(msg)) =>
                          if (
                            msg.contains("not found") ||
                            msg.contains("not bound") ||
                            msg.contains("has no data source")
                          ) {
                            complete(StatusCodes.NotFound, ErrorResponse(msg))
                          } else {
                            complete(StatusCodes.InternalServerError, ErrorResponse(msg))
                          }
                        case Success(Right(result)) =>
                          complete(StatusCodes.OK, result)
                      }
                    }
                }
              }
            }
          }
      }
    }

  /** Execute the panel query against the data source with offset-based pagination.
   *  Uses `LIMIT pageSize+1` to detect whether more rows exist beyond the current page. */
  private def executePaginated(
      dataSource: DataSource,
      page: Int,
      pageSize: Int
  ): Future[Either[String, PaginatedQueryResult]] = {
    dataSource.sourceType match {
      case SourceType.Sql =>
        parseSqlConfig(dataSource.config) match {
          case Left(err) =>
            Future.successful(Left(s"Invalid data source config: $err"))
          case Right(config) =>
            val offset         = page * pageSize
            val limit          = pageSize + 1
            val paginatedQuery = s"SELECT * FROM (${config.query}) AS _paged LIMIT $limit OFFSET $offset"
            val paginatedConfig = config.copy(query = paginatedQuery)

            SqlConnector.execute(paginatedConfig, limit).map {
              case Left(err) =>
                Left(err)
              case Right(rows) =>
                val hasMore      = rows.length > pageSize
                val pageRows     = if (hasMore) rows.dropRight(1) else rows
                val columns      = pageRows.headOption
                  .map(_.keys.toVector.sorted)
                  .getOrElse(Vector.empty)
                val jsRows       = SqlConnector.toRows(pageRows)
                Right(
                  PaginatedQueryResult(
                    rows     = jsRows,
                    columns  = columns,
                    page     = page,
                    pageSize = pageSize,
                    hasMore  = hasMore
                  )
                )
            }
        }

      case other =>
        Future.successful(
          Left(
            s"Pagination is only supported for SQL data sources, got: ${SourceType.asString(other)}"
          )
        )
    }
  }

  private def parseSqlConfig(config: JsValue): Either[String, SqlSourceConfig] =
    try {
      val payload = config.convertTo[SqlSourceConfigPayload]
      Right(SqlSourceConfigPayload.toDomain(payload))
    } catch {
      case ex: Exception => Left(ex.getMessage)
    }
}
