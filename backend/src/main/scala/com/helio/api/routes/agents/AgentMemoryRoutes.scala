package com.helio.api.routes.agents

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.AgentMemoryIdSegment
import com.helio.api.protocols.agents.{AgentMemoryEntryResponse, CreateAgentMemoryRequest}
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.agents.AgentMemoryService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `GET`/`POST /api/agent/memory`, `DELETE /api/agent/memory/:id`, and
 *  `DELETE /api/agent/memory` (clear all -- HEL-478 / 420-B). All logic lives in
 *  [[AgentMemoryService]]; follows `ApiTokenRoutes.scala`'s structure -- the closest structural
 *  analogue (multi-row-per-owner create/list/delete CRUD, design.md Context). */
final class AgentMemoryRoutes(
    agentMemoryService: AgentMemoryService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("agent" / "memory") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              ServiceResponse.run(agentMemoryService.list(user)) { entries =>
                entries.map(AgentMemoryEntryResponse.fromDomain)
              }
            },
            post {
              entity(as[CreateAgentMemoryRequest]) { request =>
                ServiceResponse.run(agentMemoryService.add(request, user)) { entry =>
                  StatusCodes.Created -> AgentMemoryEntryResponse.fromDomain(entry)
                }
              }
            },
            delete {
              ServiceResponse.runNoContent(agentMemoryService.clear(user))
            }
          )
        },
        path(AgentMemoryIdSegment) { id =>
          delete {
            ServiceResponse.runNoContent(agentMemoryService.delete(id, user))
          }
        }
      )
    }
}
