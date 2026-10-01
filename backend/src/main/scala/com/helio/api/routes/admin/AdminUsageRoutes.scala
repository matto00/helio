package com.helio.api.routes.admin

import com.helio.api._
import com.helio.api.routes.{ServiceResponse, TierErrorCompletion}
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.auth.AdminAccessService
import com.helio.services.telemetry.AdminUsageService
import org.apache.pekko.http.scaladsl.server.{Directives, Route}

/** Thin HTTP shell for `GET /api/admin/usage?days=N` (HEL-1211). Owner-only: the gate runs on the
 *  server from the stored tier BEFORE `days` is even parsed or any aggregate is read, so a denied
 *  caller learns nothing (not even whether their `days` was valid). */
final class AdminUsageRoutes(
    access: AdminAccessService,
    service: AdminUsageService,
    user: AuthenticatedUser
) extends Directives
    with JsonProtocols {

  val routes: Route =
    pathPrefix("admin") {
      path("usage") {
        get {
          parameter("days".optional) { rawDays =>
            onSuccess(access.guardOwner(user)) {
              case Left(err) => TierErrorCompletion.completeTierError(err)
              case Right(()) => ServiceResponse.run(service.usage(rawDays))(identity)
            }
          }
        }
      }
    }
}
