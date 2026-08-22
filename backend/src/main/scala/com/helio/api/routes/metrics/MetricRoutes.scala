package com.helio.api.routes.metrics

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.MetricIdSegment
import com.helio.domain.model._
import com.helio.services.metrics.MetricService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/metrics` (HEL-493). All logic in
 *  [[MetricService]] — mirrors `DataTypeRoutes`'s paginated-list shape and
 *  `AlertRuleRoutes`'s CRUD shell. */
final class MetricRoutes(
    metricService: MetricService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("metrics") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              parameters(
                "offset".as[Int].withDefault(Page.Default.offset),
                "limit".as[Int].withDefault(Page.Default.limit)
              ) { (offsetRaw, limitRaw) =>
                if (offsetRaw < 0)
                  complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
                else {
                  val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                  onSuccess(metricService.findAll(user, page)) { result =>
                    complete(PagedResult(result.items.map(MetricResponse.fromDomain), result.total, result.offset, result.limit))
                  }
                }
              }
            },
            post {
              entity(as[CreateMetricRequest]) { request =>
                ServiceResponse.run(metricService.create(request, user)) { metric =>
                  StatusCodes.Created -> MetricResponse.fromDomain(metric)
                }
              }
            }
          )
        },
        path(MetricIdSegment / "usage") { id =>
          get {
            ServiceResponse.run(metricService.usage(id, user))(MetricUsageResponse.fromDomain)
          }
        },
        path(MetricIdSegment) { id =>
          concat(
            get {
              ServiceResponse.run(metricService.findById(id, user))(MetricResponse.fromDomain)
            },
            patch {
              entity(as[UpdateMetricRequest]) { request =>
                ServiceResponse.run(metricService.update(id, request, user))(MetricResponse.fromDomain)
              }
            },
            delete {
              // HEL-560: the count of panels unbound by this delete (via
              // ON DELETE SET NULL, HEL-500) travels in an additive response
              // header rather than a body — see design.md D2.
              ServiceResponse.runNoContentWithHeader(metricService.delete(id, user)) { count =>
                RawHeader("X-Unbound-Panel-Count", count.toString)
              }
            }
          )
        }
      )
    }
}
