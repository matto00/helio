package com.helio.infrastructure.persistence.panels

import com.helio.domain.model.{DashboardId, DashboardLayout, PanelId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.services.panels.{CreatePlacement, PlacedLayouts, PlacementSizes}
import slick.jdbc.PostgresProfile.api._
// After the wildcard on purpose: an explicit import only shadows the profile's own
// `instantColumnType` when it is the inner one, and the layout column's mapping is this one.
import DashboardRepository.{dashboardLayoutColumnType, instantColumnType}

import java.time.Instant
import scala.concurrent.ExecutionContext

/** Raised inside a create transaction when the dashboard row is not there (or not visible to the
 *  caller under RLS), so the panel insert that preceded it rolls back with it. */
final class PlacementTargetMissing(dashboardId: DashboardId)
    extends RuntimeException(s"Dashboard ${dashboardId.value} not found for panel placement")

/** The layout half of every panel create (HEL-1260). Runs INSIDE the caller's transaction, in the
 *  caller's DB context (`withUserContext` for a single create, `withSystemContext` for batch and
 *  duplicate): `DbContext` has two pools and one transaction cannot span them, so each path keeps
 *  its existing context and this adds only the lock and the write to it.
 *
 *  The dashboard row is read `FOR UPDATE` and the new items are appended to what that read returned,
 *  so concurrent creates serialize and neither placement is lost. Only `layout` and `last_updated`
 *  are written, never name or appearance (a stale read of those must not clobber a concurrent
 *  rename). Under RLS the `FOR UPDATE` read needs `dashboards_select` and `dashboards_update`
 *  (V36: owner or editor grantee) to admit the caller; a caller they do not admit sees no row.
 *
 *  ORDER IS LOAD-BEARING: the lock is taken BEFORE the panel insert. The insert takes a KEY SHARE
 *  lock on the dashboard row through the `panels.dashboard_id` foreign key, which conflicts with
 *  `FOR UPDATE`; two creates that each inserted first would each hold KEY SHARE and then wait on
 *  the other's `FOR UPDATE`, a deadlock. */
private[persistence] object PanelLayoutPlacement {

  private val dashboards = TableQuery[DashboardRepository.DashboardTable]

  /** Locks the dashboard row, runs `insert` (the panel rows), then appends one item per panel from
   *  `plan` to every breakpoint of the locked layout and returns the items stored per panel. Fails
   *  the transaction with [[PlacementTargetMissing]] when the dashboard row cannot be read, before
   *  `insert` runs. */
  def insertAndAppend(
      dashboardId: DashboardId,
      insert: DBIO[Any],
      plan: DashboardLayout => Vector[(PanelId, PlacementSizes)]
  )(implicit ec: ExecutionContext): DBIO[Vector[PlacedLayouts]] =
    dashboards.filter(_.id === dashboardId.value).map(_.layout).forUpdate.result.headOption.flatMap {
      case None => DBIO.failed(new PlacementTargetMissing(dashboardId))
      case Some(layout) =>
        val (next, placed) = CreatePlacement.append(layout, plan(layout))
        insert.andThen(
          dashboards
            .filter(_.id === dashboardId.value)
            .map(r => (r.layout, r.lastUpdated))
            .update((next, Instant.now()))
        ).map(_ => placed)
    }
}
