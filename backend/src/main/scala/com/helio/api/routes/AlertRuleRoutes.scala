package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.AlertRuleIdSegment
import com.helio.domain._
import com.helio.services.AlertRuleService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/alert-rules`. All logic in [[AlertRuleService]]. */
final class AlertRuleRoutes(
    alertRuleService: AlertRuleService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("alert-rules") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onSuccess(alertRuleService.findAll(user)) { rules =>
                complete(AlertRulesResponse(rules.map(AlertRuleResponse.fromDomain)))
              }
            },
            post {
              entity(as[CreateAlertRuleRequest]) { request =>
                ServiceResponse.run(alertRuleService.create(request, user)) { rule =>
                  StatusCodes.Created -> AlertRuleResponse.fromDomain(rule)
                }
              }
            }
          )
        },
        path(AlertRuleIdSegment) { id =>
          concat(
            get {
              ServiceResponse.run(alertRuleService.findById(id, user))(AlertRuleResponse.fromDomain)
            },
            patch {
              entity(as[UpdateAlertRuleRequest]) { request =>
                ServiceResponse.run(alertRuleService.update(id, request, user))(AlertRuleResponse.fromDomain)
              }
            },
            delete {
              ServiceResponse.runNoContent(alertRuleService.delete(id, user))
            }
          )
        }
      )
    }
}
