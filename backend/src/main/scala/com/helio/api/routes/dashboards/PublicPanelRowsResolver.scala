package com.helio.api.routes.dashboards

import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}
import com.helio.services.ServiceError
import com.helio.services.panels.PublicOutputControlScope
import com.helio.services.pipelines.{OutputFilterCapability, OutputRowsQuery}
import spray.json.JsValue

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1291: the public row-query surfaces (`rows`, `filter-capabilities`, `distinct-values`),
 *  scoped by `PublicOutputControlScope`. Split out of `PublicDashboardRoutes`, which keeps the
 *  directive tree and every ACL call. */
final class PublicPanelRowsResolver(
    panelRepo: PanelRepository,
    userOpt: Option[AuthenticatedUser],
    outputRepo: OutputRepository,
    nodeSnapshotRepoOpt: Option[NodeSnapshotRepository],
    panelOutput: PublicPanelOutputResolver
)(implicit executionContext: ExecutionContext) {

  /** HEL-910 task 1.1: `GET /dashboards/:dashboardId/panels/:panelId/rows`. Resolves
   *  `panelId -> outputId -> node_snapshot` for the public/optional-auth path. Reuses
   *  `panelRepo.findAllByDashboardId` (the same lookup the panel-list route in `PublicDashboardRoutes` already
   *  uses) rather than `PanelRepository.findByIdInternal`, so the panel is proven to actually
   *  belong to THIS dashboard before its rows are read -- the dashboard-level
   *  `authorizeResourceWithSharing` gate in `PublicDashboardRoutes` is only a valid authority for panels that are
   *  really on the dashboard it was checked against. A panel of a non-`OutputPanel` kind, a
   *  panel with no bound `outputId`, or an unresolvable Output/snapshot degrades to an empty
   *  page rather than a 500 -- mirrors `resolveDataAsOf`'s own degrade-gracefully convention
   *  in `PublicPanelListResolver.resolveDataAsOf`.
   *
   *  HEL-590 evaluation-2.md CR-A: always called from inside the directive's authorized block, so
   *  `accessAlreadyGranted = true` is passed straight through to `findAllByDashboardId` -- see that
   *  method's own doc for why this is required (a share-token-authorized caller matches none of
   *  the repository's own owner/grantee/public-viewer-grant predicates). */
  /** HEL-1190 design.md D6 (task 1.2/1.3) — `sort`/`filter` are `None` for every pre-existing
   *  caller (the panel-list route's own zero-arg usage doesn't apply here; every call site below
   *  passes them explicitly), resolved via the SAME `OutputRowsQuery.resolveSort/resolveFilter`
   *  `OutputService.rows` already relies on (D6's "contract and rows endpoint can't drift"
   *  guarantee). `filter`'s named columns are additionally gated to this panel's OWN configured
   *  `output_controls` columns (D5/D6, owner ruling C11) BEFORE `resolveFilter` ever runs -- a
   *  column that is otherwise Output-eligible but not one of this panel's controls is rejected as
   *  `400`, never silently narrowed or served. */
  def resolveRows(
      dashboardId: String,
      panelId: String,
      page: Page,
      sort: Option[OutputRowsQuery.SortParam],
      filter: Option[OutputRowsQuery.FilterParam]
  ): Future[Either[ServiceError, PagedResult[JsValue]]] =
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(offset = 0, limit = Page.MaxLimit), accessAlreadyGranted = true).flatMap { paged =>
      paged.items.find(_.id.value == panelId) match {
        case None => Future.successful(Left(ServiceError.NotFound("Panel not found")))
        case Some(op: OutputPanel) =>
          (op.outputId, nodeSnapshotRepoOpt) match {
            case (Some(outputId), Some(nodeSnapshotRepo)) =>
              outputRepo.findByIdInternal(outputId).flatMap {
                case None => Future.successful(Right(PagedResult(Vector.empty[JsValue], 0, page.offset, page.limit)))
                case Some(output) =>
                  PublicOutputControlScope
                    .validateFilterColumns(op.config.controls, filter)
                    .flatMap(_ => PublicOutputControlScope.validateSortColumn(op.config.controls, sort)) match {
                    case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
                    case Right(()) =>
                      OutputRowsQuery.resolveSort(output.schema, sort) match {
                        case Left(err) => Future.successful(Left(err))
                        case Right(resolvedSort) =>
                          OutputRowsQuery.resolveFilter(output, filter, nodeSnapshotRepo).flatMap {
                            case Left(err) => Future.successful(Left(err))
                            case Right(resolvedFilter) =>
                              nodeSnapshotRepo
                                // HEL-913 R12/5.8b-iv-a: scope a root-bound read (`stepId = None`) to
                                // THIS Output's own root -- `output.node.rootId` is exactly that,
                                // already resolved at write time.
                                .listRowsPaged(
                                  output.node.pipelineId.value,
                                  output.node.stepId.map(_.value),
                                  page,
                                  explicitRootId = output.node.rootId.map(_.value),
                                  sort = resolvedSort,
                                  filter = resolvedFilter
                                )
                                .map(paged => Right(paged.copy(items = paged.items.map(identity[JsValue]))))
                          }
                      }
                  }
              }
            case _ => Future.successful(Right(PagedResult(Vector.empty[JsValue], 0, page.offset, page.limit)))
          }
        case Some(_) => Future.successful(Right(PagedResult(Vector.empty[JsValue], 0, page.offset, page.limit)))
      }
    }

  /** HEL-1190 design.md D5 (task 2.1) — the full-schema contract (same `OutputFilterCapability
   *  .buildContract` the authenticated `filter-capabilities` route delegates to, computed
   *  identically), then narrowed to only the columns this panel's OWN configured controls name
   *  (`PublicOutputControlScope`) -- this route has no per-request `column` param to gate (mirrors
   *  the authenticated route's own full-sweep shape), so every column NOT a control on this panel
   *  is simply absent from the response, never returned as a contract entry. */
  def resolveFilterCapabilities(dashboardId: String, panelId: String): Future[Either[ServiceError, OutputFilterCapability.FilterCapabilityContract]] =
    panelOutput.resolvePanelOutput(dashboardId, panelId).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((panel, output)) =>
        nodeSnapshotRepoOpt match {
          case None => Future.successful(Right(OutputFilterCapability.FilterCapabilityContract(Vector.empty)))
          case Some(nodeSnapshotRepo) =>
            OutputFilterCapability.buildContract(output, nodeSnapshotRepo).map { contract =>
              val allowed = PublicOutputControlScope.allowedColumns(panel.config.controls)
              Right(contract.copy(columns = contract.columns.filter(c => allowed.contains(c.column))))
            }
        }
    }

  /** HEL-1190 design.md D5 (task 2.2) — same panel-scoped gate as `resolveFilterCapabilities`,
   *  but per-request (`column` IS a param here, mirroring the authenticated
   *  `distinct-values` route): rejected `400` before `OutputFilterCapability.eqInEligibleColumn`
   *  ever runs when `column` isn't one of THIS panel's own configured control columns, even when
   *  it would otherwise be eq/in-eligible on the Output. */
  def resolveDistinctValues(dashboardId: String, panelId: String, column: String): Future[Either[ServiceError, Vector[(String, Int)]]] =
    panelOutput.resolvePanelOutput(dashboardId, panelId).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((panel, output)) =>
        if (!PublicOutputControlScope.isAllowed(panel.config.controls, column))
          Future.successful(Left(ServiceError.BadRequest(s"column not permitted for this panel: '$column'")))
        else
          nodeSnapshotRepoOpt match {
            case None => Future.successful(Left(ServiceError.BadRequest(s"column not eq/in-eligible: '$column'")))
            case Some(nodeSnapshotRepo) =>
              OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, column).flatMap {
                case Left(err) => Future.successful(Left(err))
                case Right(()) =>
                  nodeSnapshotRepo
                    .topDistinctValues(
                      output.node.pipelineId.value,
                      output.node.stepId.map(_.value),
                      output.node.rootId.map(_.value),
                      column,
                      OutputFilterCapability.MaxDropdownCardinality
                    )
                    .map(Right(_))
              }
          }
    }
}
