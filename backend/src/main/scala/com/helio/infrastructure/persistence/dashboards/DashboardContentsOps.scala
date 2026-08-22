package com.helio.infrastructure.persistence.dashboards

import com.helio.infrastructure.persistence.panels.{PanelRepository, PanelRowMapper}
import com.helio.domain.model._
import slick.jdbc.PostgresProfile.api._
// The `r.layout`/`r.lastUpdated` partial-column update below defines a NEW
// ad-hoc projection (distinct from DashboardTable's whole-row `*` shape), so
// it needs these column-type implicits in scope here too — they're defined
// once on DashboardRepository's companion object and reused across every
// file in this package that needs them (mirrors DashboardRepository.update's
// own `(r.name, r.lastUpdated, r.appearance, r.layout)` partial update).
import DashboardRepository.{dashboardLayoutColumnType, instantColumnType}

import java.time.Instant
import scala.concurrent.Future

/** Atomic dashboard-contents replace (HEL-363), extracted alongside
 *  [[DashboardSnapshotOps]] (mixin, mirrors its self-type pattern) so
 *  [[DashboardRepository]] stays under the 250-line budget. Mixed in via
 *  self-type so all protected members of [[DashboardRepository]] remain
 *  accessible.
 *
 *  design.md D1: the target dashboard already EXISTS (unlike
 *  `importSnapshot`/`duplicate`, which mint a brand-new dashboard row), so
 *  "rollback on failure" must be a REAL Postgres transaction rather than the
 *  service-composed delete-the-whole-thing-on-failure pattern
 *  `DashboardProposalService` uses — destroying an existing user's dashboard
 *  on a mid-rebuild failure is unacceptable. `DashboardContentsService`
 *  (services layer) validates every panel BEFORE calling this method, with
 *  zero DB writes, so a bad payload never reaches here at all. */
trait DashboardContentsOps { self: DashboardRepository =>

  /** Replace ALL panels belonging to `dashboardId` with `newPanels` — one
   *  `.transactionally` DBIO: delete the old panel rows, insert the new ones,
   *  and overwrite the dashboard's layout, via `ctx.withSystemContext` (the
   *  caller has already ACL-checked, same privilege pattern as
   *  `importSnapshot`/`duplicate`). Returns `None` if `dashboardId` doesn't
   *  exist — defensive; the service layer's prior ACL/existence check makes
   *  this the rare/race case, not the common path.
   *
   *  design.md D4 (named, not engineered around): two overlapping calls for
   *  the SAME dashboard serialize on Postgres's row lock for the panel
   *  DELETE; the later commit's panel set wins and silently supersedes the
   *  earlier one (both still return 200 from their own caller's
   *  perspective) — accepted last-writer-wins behavior for v1. */
  def replaceContents(
      dashboardId: DashboardId,
      newPanels: Vector[Panel],
      layout: Option[DashboardLayout]
  ): Future[Option[(Dashboard, Vector[Panel])]] = {
    val panelTable = TableQuery[PanelRepository.PanelTable]
    val newPanelRows: Seq[PanelRepository.PanelRow] = newPanels.map(PanelRowMapper.domainToRow)
    val now = Instant.now()

    val action = table.filter(_.id === dashboardId.value).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some(existingRow) =>
        val existingDash = rowToDomain(existingRow)
        val newLayout    = layout.getOrElse(existingDash.layout)
        val updatedDash  = existingDash.copy(layout = newLayout, meta = existingDash.meta.copy(lastUpdated = now))

        val deleteAction = panelTable.filter(_.dashboardId === dashboardId.value).delete
        val insertAction = DBIO.sequence(newPanelRows.map(pr => panelTable += pr))
        val dashboardUpdateAction =
          table
            .filter(_.id === dashboardId.value)
            .map(r => (r.layout, r.lastUpdated))
            .update((newLayout, now))

        (deleteAction andThen insertAction andThen dashboardUpdateAction)
          .map(_ => Some((updatedDash, newPanels)))
    }.transactionally

    ctx.withSystemContext(action)
  }
}
