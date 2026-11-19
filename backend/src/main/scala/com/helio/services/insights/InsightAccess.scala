package com.helio.services.insights

import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, OutputKind, ResourceAccess}
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1743 D8/D9: resolves an insight Output AND the caller's role on its pipeline. The sharing-aware `findById`
 *  decides visibility, so an unknown id, a no-access id and an Output that is not an `insight` are all the same
 *  `NotFound`; the pipeline role is then read from the access checker (owner, editor or viewer). */
final class InsightAccess(outputRepo: OutputRepository, accessChecker: AccessChecker)(implicit ec: ExecutionContext) {

  def resolve(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, (Output, ResourceAccess)]] =
    outputRepo.findById(id, user).flatMap {
      case Some(o) if o.kind == OutputKind.Insight =>
        accessChecker.requireAccess("pipeline", o.node.pipelineId.value, Some(user), "Output not found").map {
          case Right(access) => Right(o -> access)
          case Left(_)       => Left(ServiceError.NotFound("Output not found"))
        }
      case _ => Future.successful(Left(ServiceError.NotFound("Output not found")))
    }
}

object InsightAccess {

  /** Owner and editor see cost fields and the real attempt status and may refresh; a viewer gets the reduced shape. */
  def isPrivileged(access: ResourceAccess): Boolean = access != ResourceAccess.Viewer
}
