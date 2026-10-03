package com.helio.api.routes.dashboards

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.api.http._
import com.helio.api.protocols.pipelines.{OutputSchemaFieldResponse, ProvenanceResponses, PublicOutputMetaResponse, PublicOutputProvenanceResponse}
import com.helio.api.routes.ServiceResponse
import com.helio.api.routes.pipelines.OutputRowsQueryParsing
import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import com.helio.services.ServiceError
import com.helio.services.panels.{OutputControlsValidator, PublicOutputControlScope}
import com.helio.services.pipelines.{OutputFilterCapability, OutputRowsQuery, ProvenanceService}
import spray.json.{JsObject, JsValue}

import scala.concurrent.{ExecutionContextExecutor, Future}

/** Public (unauthenticated-friendly) read access to a dashboard's panels.
 *  Sharing-aware ACL is enforced via `AclDirective.authorizeResourceWithSharing`.
 *
 *  HEL-904 task 4.1 removed the OLD `dataTypeId`-keyed binding-resolution + `dataAsOf` lookup
 *  (`PanelService.resolveBindingsForRead` / the retired `findLastRunAtByOutputDataTypeId`)
 *  outright, since no panel carries a `dataTypeId` binding anymore — but that also dropped the
 *  `dataAsOf` FEATURE itself (every response fell back to `None`), not just its old plumbing.
 *
 *  HEL-906 cycle 6 (evaluation-5.md CR6): rewires `dataAsOf` back onto the NEW `panel → output →
 *  pipeline.lastRunAt` path — the only panel kind with a direct output binding today is
 *  `OutputPanel` (`config.outputId`); every other panel kind has no output binding at all and
 *  keeps `dataAsOf = None`, exactly as it does today. `outputRepo`/`pipelineRepo` are both
 *  already unauthenticated-safe `*Internal` lookups (no ACL check needed here — the ACL gate for
 *  this whole route is the dashboard-level `authorizeResourceWithSharing` above; an Output's
 *  `lastRunAt` is not itself sensitive once its OWNING dashboard is already known to be visible
 *  to this caller). A missing/unresolvable Output or pipeline (deleted between the panel read and
 *  this lookup, or a pipeline with no successful run yet) degrades to `dataAsOf = None` rather
 *  than failing the whole page. */
final class PublicDashboardRoutes(
    panelRepo: PanelRepository,
    aclDirective: AclDirective,
    userOpt: Option[AuthenticatedUser],
    outputRepoOpt: Option[OutputRepository] = None,
    pipelineRepoOpt: Option[PipelineRepository] = None,
    nodeSnapshotRepoOpt: Option[NodeSnapshotRepository] = None,
    provenanceServiceOpt: Option[ProvenanceService] = None
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  // HEL-1189 design.md D5 — same nullable-optional `.orNull` convention `ApiRoutes.scala` uses to
  // wire `PanelService`'s own instance; reused here (rather than threading `PanelService` itself
  // into this route, a broader constructor change) so this, the app's one true panel-READ path
  // (`GET /api/dashboards/:id/panels` — see this class's own doc comment: authenticated dashboard
  // viewing and public/shared viewing both funnel through here), can compute live orphan status
  // per `output-panel-placement`'s Requirement 3 ("reported as orphaned wherever the panel's
  // controls are read") using the SAME decision `OutputControlsValidator.reject` (write-time)
  // makes — never a second, independently-maintained copy.
  private val outputControlsValidator = new OutputControlsValidator(outputRepoOpt.orNull, nodeSnapshotRepoOpt.orNull)

  /** `None` for any panel kind other than `OutputPanel`, or when either repo is unavailable
   *  (mirrors this codebase's existing `Option[Repository]`-degrades-gracefully convention, e.g.
   *  `outputRepoOpt` in `ApiRoutes.scala`), or when the Output/pipeline can no longer be
   *  resolved. */
  private def resolveDataAsOf(panel: Panel): Future[Option[String]] =
    (panel, outputRepoOpt, pipelineRepoOpt) match {
      case (op: OutputPanel, Some(outputRepo), Some(pipelineRepo)) =>
        op.outputId match {
          case Some(outputId) =>
            outputRepo.findByIdInternal(outputId).flatMap {
              case Some(output) =>
                pipelineRepo.findByIdInternal(output.node.pipelineId).map(_.flatMap(_.lastRunAt).map(_.toString))
              case None => Future.successful(None)
            }
          case None => Future.successful(None)
        }
      case _ => Future.successful(None)
    }

  /** HEL-1189 design.md D5 — the ids of `panel`'s controls currently orphaned (bound column
   *  absent from the Output's CURRENT declared schema, or present but no longer eligible for its
   *  kind), mirroring `resolveDataAsOf`'s own per-panel async-resolve pattern and degrade-
   *  gracefully convention. `Set.empty` for any non-`OutputPanel` kind, a panel with no controls,
   *  an unresolvable Output, or when `outputRepoOpt` is unavailable — never a failed page. */
  private def resolveOrphanedControlIds(panel: Panel): Future[Set[String]] =
    (panel, outputRepoOpt) match {
      case (op: OutputPanel, Some(outputRepo)) if op.config.controls.nonEmpty =>
        op.outputId match {
          case Some(outputId) =>
            outputRepo.findByIdInternal(outputId).flatMap {
              case None => Future.successful(Set.empty[String])
              case Some(output) =>
                Future
                  .traverse(op.config.controls) { control =>
                    outputControlsValidator.isOrphaned(output, control).map(orphaned => if (orphaned) Some(control.id) else None)
                  }
                  .map(_.flatten.toSet)
            }
          case None => Future.successful(Set.empty[String])
        }
      case _ => Future.successful(Set.empty[String])
    }

  /** HEL-910 task 1.1: `GET /dashboards/:dashboardId/panels/:panelId/rows`. Resolves
   *  `panelId -> outputId -> node_snapshot` for the public/optional-auth path. Reuses
   *  `panelRepo.findAllByDashboardId` (the same lookup the panel-list route above already
   *  uses) rather than `PanelRepository.findByIdInternal`, so the panel is proven to actually
   *  belong to THIS dashboard before its rows are read -- the dashboard-level
   *  `authorizeResourceWithSharing` gate below is only a valid authority for panels that are
   *  really on the dashboard it was checked against. A panel of a non-`OutputPanel` kind, a
   *  panel with no bound `outputId`, or an unresolvable Output/snapshot degrades to an empty
   *  page rather than a 500 -- mirrors `resolveDataAsOf`'s own degrade-gracefully convention
   *  above.
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
  private def resolveRows(
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
          (op.outputId, outputRepoOpt, nodeSnapshotRepoOpt) match {
            case (Some(outputId), Some(outputRepo), Some(nodeSnapshotRepo)) =>
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

  /** HEL-1190 design.md D5/D8 (tasks 2.1/2.2/2.4) — resolves `dashboardId + panelId ->
   *  (OutputPanel, Output)` server-side, shared by the three new panel-scoped public routes below
   *  (`filter-capabilities`/`distinct-values`/`output-meta`) so none of them ever accepts a
   *  caller-supplied `outputId` (C11). Reuses `resolveRows`'s SAME `findAllByDashboardId` lookup --
   *  the panel is proven to actually belong to THIS dashboard before anything about its bound
   *  Output is resolved. Deliberately `ServiceError.NotFound` for every "can't resolve" case
   *  (missing panel, wrong kind, no bound Output, unresolvable Output, or a fixture missing
   *  `outputRepoOpt`) -- unlike `resolveRows`'s degrade-gracefully-to-empty-page contract, these
   *  three routes have no "page" to degrade to, so a 404 is the correct, existence-not-leaked
   *  response (the caller already passed the dashboard-level ACL gate to reach here). */
  private def resolvePanelOutput(dashboardId: String, panelId: String): Future[Either[ServiceError, (OutputPanel, Output)]] =
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(offset = 0, limit = Page.MaxLimit), accessAlreadyGranted = true).flatMap { paged =>
      paged.items.find(_.id.value == panelId) match {
        case Some(op: OutputPanel) =>
          (op.outputId, outputRepoOpt) match {
            case (Some(outputId), Some(outputRepo)) =>
              outputRepo.findByIdInternal(outputId).map {
                case Some(output) => Right((op, output))
                case None         => Left(ServiceError.NotFound("Output not found"))
              }
            case _ => Future.successful(Left(ServiceError.NotFound("Output not found")))
          }
        case _ => Future.successful(Left(ServiceError.NotFound("Panel not found")))
      }
    }

  /** HEL-1190 design.md D5 (task 2.1) — the full-schema contract (same `OutputFilterCapability
   *  .buildContract` the authenticated `filter-capabilities` route delegates to, computed
   *  identically), then narrowed to only the columns this panel's OWN configured controls name
   *  (`PublicOutputControlScope`) -- this route has no per-request `column` param to gate (mirrors
   *  the authenticated route's own full-sweep shape), so every column NOT a control on this panel
   *  is simply absent from the response, never returned as a contract entry. */
  private def resolveFilterCapabilities(dashboardId: String, panelId: String): Future[Either[ServiceError, OutputFilterCapability.FilterCapabilityContract]] =
    resolvePanelOutput(dashboardId, panelId).flatMap {
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

  /** HEL-1190 design.md D5 (task 2.2) — same panel-scoped gate as `resolveFilterCapabilities`
   *  above, but per-request (`column` IS a param here, mirroring the authenticated
   *  `distinct-values` route): rejected `400` before `OutputFilterCapability.eqInEligibleColumn`
   *  ever runs when `column` isn't one of THIS panel's own configured control columns, even when
   *  it would otherwise be eq/in-eligible on the Output. */
  private def resolveDistinctValues(dashboardId: String, panelId: String, column: String): Future[Either[ServiceError, Vector[(String, Int)]]] =
    resolvePanelOutput(dashboardId, panelId).flatMap {
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

  /** HEL-1190 design.md D8 (task 2.4) — `kind`/`config`/`schema` only (HEL-1197 dropped `ownerId`), never row data;
   *  the ONE new metadata source `usePublicPanelData` needs to pick/configure a renderer, since
   *  `PanelResponse.config` (the panel-list route above) is only the PANEL's own placement config,
   *  never the bound Output's. `config` needs its own repository call (`Output` itself carries no
   *  `config` field -- see `OutputRepository`'s own doc comment) — reuses the SAME
   *  `findConfigsByIdsInternal` batch method `OutputService`'s own authenticated callers use,
   *  singleton-Vector'd for this one Output. */
  private def resolveOutputMeta(dashboardId: String, panelId: String): Future[Either[ServiceError, PublicOutputMetaResponse]] =
    resolvePanelOutput(dashboardId, panelId).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((_, output)) =>
        outputRepoOpt match {
          case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
          case Some(outputRepo) =>
            outputRepo.findConfigsByIdsInternal(Vector(output.id.value)).map { configs =>
              Right(
                PublicOutputMetaResponse(
                  kind = OutputKind.asString(output.kind),
                  config = configs.getOrElse(output.id.value, JsObject.empty),
                  schema = output.schema.flatMap(sf => DataFieldType.fromString(sf.`type`).map(t => OutputSchemaFieldResponse(sf.name, DataFieldType.asString(t))))
                )
              )
            }
        }
    }

  /** HEL-1206 design.md D7 -- public provenance: same `resolvePanelOutput` gate (panel proven to
   *  belong to THIS dashboard, OutputPanel with a bound Output; every failure `404`) as
   *  `output-meta`; the chain is then built by `ProvenanceService` (`*Internal` reads, cleared by
   *  the dashboard gate in the route) and projected through the allowlist-only public type. */
  private def resolveProvenance(dashboardId: String, panelId: String): Future[Either[ServiceError, PublicOutputProvenanceResponse]] =
    resolvePanelOutput(dashboardId, panelId).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((_, output)) =>
        provenanceServiceOpt match {
          case None      => Future.successful(Left(ServiceError.NotFound("Output not found")))
          case Some(svc) => svc.forOutput(output).map(chain => Right(ProvenanceResponses.public(chain)))
        }
    }

  val routes: Route =
    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
      pathPrefix(Segment / "rows") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters(
              "offset".as[Int].withDefault(Page.Default.offset),
              "limit".as[Int].withDefault(Page.Default.limit),
              // HEL-1190 design.md D6 (task 1.2) — same `sort`/`filter` shape/parsing as the
              // authenticated `GET /api/outputs/:id/rows` (`OutputRowsQueryParsing`, shared
              // verbatim); `filter`'s named columns are additionally gated to this panel's own
              // configured control columns inside `resolveRows` (D5/D6, owner ruling C11).
              "sort".optional,
              "filter".optional,
              // HEL-590: `?token=<share token>` -- the share URL itself must carry the credential
              // (design.md D1); part of the published contract per the sibling spec.md.
              "token".optional
            ) { (offsetRaw, limitRaw, sortRaw, filterRaw, token) =>
              if (offsetRaw < 0)
                complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
              else
                (OutputRowsQueryParsing.parseSortParam(sortRaw), OutputRowsQueryParsing.parseFilterParam(filterRaw)) match {
                  case (Left(err), _) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                  case (_, Left(err)) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                  case (Right(sortParam), Right(filterParam)) =>
                    val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                    aclDirective.authorizeResourceWithSharing(
                      "dashboard",
                      dashboardId,
                      userOpt,
                      "Dashboard not found",
                      token
                    ) { _ =>
                      ServiceResponse.run(resolveRows(dashboardId, panelId, page, sortParam, filterParam))(identity)
                    }
                }
            }
          }
        }
      } ~
      pathPrefix(Segment / "filter-capabilities") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("token".optional) { token =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(resolveFilterCapabilities(dashboardId, panelId))(outputFilterCapabilitiesResponseFrom)
              }
            }
          }
        }
      } ~
      pathPrefix(Segment / "distinct-values") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("column", "token".optional) { (column, token) =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(resolveDistinctValues(dashboardId, panelId, column))(values =>
                  outputDistinctValuesResponseFrom(column, values)
                )
              }
            }
          }
        }
      } ~
      pathPrefix(Segment / "output-meta") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("token".optional) { token =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(resolveOutputMeta(dashboardId, panelId))(identity)
              }
            }
          }
        }
      } ~
      pathPrefix(Segment / "provenance") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("token".optional) { token =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(resolveProvenance(dashboardId, panelId))(identity)
              }
            }
          }
        }
      } ~
      pathEndOrSingleSlash {
        get {
          parameters(
            "offset".as[Int].withDefault(Page.Default.offset),
            "limit".as[Int].withDefault(Page.Default.limit),
            "token".optional
          ) { (offsetRaw, limitRaw, token) =>
            if (offsetRaw < 0)
              complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
            else {
              val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { access =>
                // HEL-590 evaluation-2.md CR-A: `access` here is the directive's resolved `ResourceAccess`
                // (Owner/Editor/Viewer, however it was granted -- including via a share token, which
                // matches none of `findAllByDashboardId`'s own owner/grantee/public-grant predicates).
                // Reaching this block at all means the caller is authorized; `accessAlreadyGranted =
                // true` threads that decision through instead of letting the repository re-derive
                // (and fail to re-derive) it from `userOpt` alone.
                val resultF = panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, page, accessAlreadyGranted = true)
                  .flatMap { paged =>
                    // HEL-1189 design.md D5: `orphanedControlIds` resolved alongside `dataAsOf` per
                    // panel, same async-resolve-then-merge shape — this is the app's one true
                    // panel-READ path, so it's where Requirement 3's "reported as orphaned wherever
                    // the panel's controls are read" is actually enforced.
                    Future.sequence(paged.items.map(panel =>
                      for {
                        dataAsOf    <- resolveDataAsOf(panel)
                        orphanedIds <- resolveOrphanedControlIds(panel)
                      } yield (panel, dataAsOf, orphanedIds)
                    ))
                      .map { rows =>
                        val responses = rows.map { case (panel, dataAsOf, orphanedIds) =>
                          // HEL-1197/HEL-1216: `ownerId` and `meta.createdBy` (the creator's id) go only
                          // to the dashboard's owner or that panel's own creator -- never to an
                          // anonymous, share-token-only, or authenticated non-owner grantee/stranger.
                          val ownerView = access == ResourceAccess.Owner || userOpt.exists(_.id.value == panel.ownerId.value)
                          PanelResponse.fromDomain(panel, dataAsOf, orphanedControlIds = Some(orphanedIds), includeOwnerId = ownerView)
                        }
                        PagedResult(responses, paged.total, paged.offset, paged.limit)
                      }
                  }
                onSuccess(resultF) { result =>
                  complete(result)
                }
              }
            }
          }
        }
      }
    }
}
