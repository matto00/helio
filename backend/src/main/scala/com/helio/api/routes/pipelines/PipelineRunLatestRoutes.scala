package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.pipelines.PipelineRunService

import scala.concurrent.ExecutionContext

/** `GET /api/pipelines/:id/runs/latest` — the pipeline's single most recent run's durable
 *  summary (HEL-1174, design.md Decision 2). This closes the SSE reconnect-gap bug: a subscriber
 *  crossing a reconnect (or connecting after a run already finished) calls this endpoint to learn
 *  the actual latest outcome from `pipeline_runs`, instead of relying solely on the ephemeral
 *  `run-events` push channel.
 *
 *  Sharing-aware (`PipelineRunService.latestRun` → `pipelineRepo.findByIdShared` — the SAME ACL
 *  pattern `run-events`/`run-history` already use: owner/editor/viewer grantee → 200, no grant or
 *  unknown pipeline → 404). Deliberately NOT modeled on `PipelineRunStatusRoutes`'s `runs/:runId`
 *  handler, which performs a bare in-memory cache lookup with NO ownership/sharing check at all —
 *  safe only because it is keyed by an opaque, unguessable run id. Copying that (lack of) access
 *  control for THIS pipeline-id-keyed endpoint would leak any pipeline's latest run status/error
 *  detail to any authenticated user who guesses or enumerates pipeline ids (design-gate round 1,
 *  change request 1).
 *
 *  MOUNT-ORDER HAZARD: this route's literal `"latest"` path segment MUST be tried before
 *  `PipelineRunStatusRoutes`'s `path("runs" / Segment)` wildcard in whichever `concat(...)`
 *  ultimately serves both (`ApiRoutes.scala` — see the mount-order comment at this route's own
 *  mount point there, and `PipelineRunRoutesSpec`'s `makeRoutes` test helper). Pekko HTTP tries a
 *  `concat`'s branches in declaration order; `Segment` matches the literal string `"latest"` just
 *  as readily as a real run id, so if `runs/:runId` is composed first, a GET to `runs/latest`
 *  binds `runId = "latest"`, falls into `runService.status("latest")` → `None` → a *different*
 *  `404`, and this route becomes permanently unreachable — compiles fine, never fires (design-gate
 *  round 1, change request 2). */
final class PipelineRunLatestRoutes(runService: PipelineRunService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines" / PipelineIdSegment / "runs" / "latest") { pipelineId =>
      pathEndOrSingleSlash {
        get {
          ServiceResponse.run(runService.latestRun(pipelineId, user))(identity)
        }
      }
    }
}
