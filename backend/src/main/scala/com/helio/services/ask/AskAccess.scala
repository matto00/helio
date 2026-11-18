package com.helio.services.ask

import com.helio.domain.model.{AuthenticatedUser, DashboardId, Output, OutputId, Page}
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.pipelines.{OutputReadAccess, PipelineService}

import scala.collection.immutable.VectorMap
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1745 D2/D4: the access decisions of an ask, all explicit SQL (row-level security never runs in dev or CI, so no
 *  decision rests on it alone).
 *
 *  Dashboard: the owner or a user holding a grant row on it (`AccessChecker.requireAccess` with a signed-in caller never
 *  consults a public grant, and no share token is read). Output: only when `OutputReadAccess.readablePipelineId` admits
 *  the caller. The same functions run again inside every tool call. */
class AskAccess(
    val accessChecker: AccessChecker,
    outputRepo: OutputRepository,
    pipelineService: PipelineService,
    panelRepo: PanelRepository
)(implicit ec: ExecutionContext) {

  private def unknownDashboard = ServiceError.NotFound("Dashboard not found")
  private def unknownOutput    = ServiceError.NotFound("Output not found")

  /** The cheap access decision for the scope itself (the route's gate). */
  def gate(scope: AskScope, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] = scope match {
    case AskScope.DashboardScope(id) =>
      accessChecker.requireAccess("dashboard", id, Some(user), unknownDashboard.message).map(_.map(_ => ()))
    case AskScope.OutputScope(id) =>
      pipelineGrant(id, user).map(granted => if (granted) Right(()) else Left(unknownOutput))
  }

  /** The gate plus the in-scope Outputs, read fresh. */
  def resolve(scope: AskScope, user: AuthenticatedUser): Future[Either[ServiceError, ScopeSnapshot]] =
    gate(scope, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(()) =>
        scope match {
          case AskScope.OutputScope(id) => Future.successful(Right(ScopeSnapshot(Vector(ScopedOutput(id, Vector.empty)))))
          case AskScope.DashboardScope(id) =>
            // The dashboard gate above is the authority, hence `accessAlreadyGranted`.
            panelRepo.findAllByDashboardId(DashboardId(id), Some(user), Page(offset = 0, limit = Page.MaxLimit), accessAlreadyGranted = true).map { paged =>
              val bound = paged.items.collect { case p: OutputPanel if p.outputId.isDefined => p.outputId.get.value -> p }
              val grouped = bound.foldLeft(VectorMap.empty[String, Vector[OutputPanel]]) { case (acc, (oid, p)) =>
                acc.updated(oid, acc.getOrElse(oid, Vector.empty) :+ p)
              }
              Right(ScopeSnapshot(grouped.map { case (oid, ps) => ScopedOutput(oid, ps) }.toVector))
            }
        }
    }

  /** Whether the caller holds a pipeline grant on the Output's pipeline (the explicit-SQL check). */
  def pipelineGrant(outputId: String, user: AuthenticatedUser): Future[Boolean] =
    OutputReadAccess.readablePipelineId(outputRepo, pipelineService, OutputId(outputId), user).map(_.isDefined)

  /** The Output row; call only after the scope check admitted `outputId`. */
  def loadOutput(outputId: String): Future[Option[Output]] = outputRepo.findByIdInternal(OutputId(outputId))
}
