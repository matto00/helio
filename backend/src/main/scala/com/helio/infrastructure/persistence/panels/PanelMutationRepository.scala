package com.helio.infrastructure.persistence.panels

import com.helio.api.protocols.panels.PanelBatchItem
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.services.panels.{CreatePlacement, PlacedLayouts, PlacementSizes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.Future

/** Panel mutation operations extracted from [[PanelRepository]] to keep that
 *  file within the 250-line budget. Mixed in via self-type so all protected
 *  members of [[PanelRepository]] remain accessible. */
trait PanelMutationOps { self: PanelRepository =>

  import PanelRepository._ // column-type implicits (e.g. panelAppearanceColumnType)

  /** Single create (HEL-1260): the panel insert, the dashboard row lock and the layout append run in ONE
   *  `withUserContext(caller)` transaction, so a failed layout write rolls the panel back and the
   *  `panels_insert` WITH CHECK policy stays a live defence. Returns `None` (nothing written) when the
   *  dashboard row is not visible to the caller. */
  def insertPlaced(panel: Panel, sizes: PlacementSizes): Future[Option[PlacedLayouts]] = {
    val action = PanelLayoutPlacement
      .insertAndAppend(panel.dashboardId, table += domainToRow(panel), _ => Vector(panel.id -> sizes))
      .map(placed => Option(placed.head))
      .transactionally
    ctx.withUserContext(panel.ownerId.value)(action).recover { case _: PlacementTargetMissing => None }
  }

  /** Privileged duplicate: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. New row is inserted with the calling user's
   *  ownerId so V36 RLS policies apply to it correctly after insertion. The layout item is
   *  appended in the same transaction (HEL-1260), sized from the source's item in the locked
   *  layout, else `kindDefault` (see [[CreatePlacement.duplicateSizes]]). */
  def duplicate(id: PanelId, ownerId: UserId, kindDefault: PlacementSizes): Future[Option[(Panel, PlacedLayouts)]] = {
    val copyTitleRegex = """^(.*)\s+\(copy(?:\s+(\d+))?\)$""".r

    def baseTitle(title: String): String = title match {
      case copyTitleRegex(base, _) => base
      case _                       => title
    }

    def nextCopyTitle(base: String, existingTitles: Seq[String]): String = {
      val usedNumbers = existingTitles.collect {
        case t if t == s"$base (copy)"                      => 1
        case copyTitleRegex(b, n) if b == base && n != null => n.toInt
      }.toSet
      val n = Iterator.from(1).dropWhile(usedNumbers.contains).next()
      if (n == 1) s"$base (copy)" else s"$base (copy $n)"
    }

    val action = table.filter(_.id === id.value).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some(source) =>
        val base = baseTitle(source.title)
        table
          .filter(_.dashboardId === source.dashboardId)
          .map(_.title)
          .result
          .flatMap { existingTitles =>
            val now    = Instant.now()
            val newRow = source.copy(
              id          = UUID.randomUUID().toString,
              title       = nextCopyTitle(base, existingTitles),
              createdAt   = now,
              lastUpdated = now,
              ownerId     = UUID.fromString(ownerId.value)
            )
            val plan = (layout: DashboardLayout) =>
              Vector(PanelId(newRow.id) -> CreatePlacement.duplicateSizes(layout, PanelId(source.id), kindDefault))
            PanelLayoutPlacement
              .insertAndAppend(DashboardId(source.dashboardId), table += newRow, plan)
              .map(placed => Option((rowToDomain(newRow), placed.head)))
          }
    }.transactionally

    ctx.withSystemContext(action).recover { case _: PlacementTargetMissing => None }
  }

  /** Batch update: applies title / appearance / typed-config patches to many
   *  panels in one transaction. Cross-type lock is enforced at the service
   *  layer; this method assumes each item's `type` (if any) matches the
   *  stored row's `type` column. Parent dashboard ACL is the authoritative
   *  gate — this method performs no ACL check. */
  def batchUpdate(items: Vector[PanelBatchItem], now: Instant): Future[Vector[Panel]] = {
    if (items.isEmpty) return Future.successful(Vector.empty)

    val panelIds = items.map(_.id)

    def buildItemAction(item: PanelBatchItem): DBIO[Unit] =
      table.filter(_.id === item.id).result.headOption.flatMap {
        case None => DBIO.failed(new NoSuchElementException(s"Panel '${item.id}' not found"))
        case Some(row) =>
          val updates = Vector.newBuilder[DBIO[Unit]]

          item.title.foreach { title =>
            updates += table.filter(_.id === item.id).map(r => (r.title, r.lastUpdated)).update((title, now)).map(_ => ())
          }

          // HEL-362: shared merge (PanelAppearance.applyPatchJson) replaces the
          // old hand-rolled top-level-only getOrElse/orElse block so batch and
          // single-item PATCH cannot diverge (partial `chart` now supported here
          // too). Mirrors the `item.config` pattern below: a decode failure
          // throws synchronously inside this lazily-evaluated DBIO closure, which
          // Slick surfaces as a failed action — rolled back by `.transactionally`
          // and reported by `PanelService.batchUpdate`'s `.recover` (no partial write).
          item.appearance.foreach { appearanceJson =>
            val current = row.appearance
            val merged = PanelAppearance.applyPatchJson(appearanceJson, current) match {
              case Right(a)  => a
              case Left(err) => throw new IllegalArgumentException(s"panel '${item.id}' appearance patch: $err")
            }
            updates += table.filter(_.id === item.id).map(r => (r.appearance, r.lastUpdated)).update((merged, now)).map(_ => ())
          }

          // CS2c-3c: typed-config patch path. Builds a fresh Panel from the
          // stored row, applies the per-subtype Patch, writes every config
          // column back via domainToRow.
          item.config.foreach { configJson =>
            val existingPanel = rowToDomain(row)
            val patched = PanelConfigCodec.applyConfigPatch(existingPanel, configJson) match {
              case Right(p)  => p
              case Left(err) => throw new IllegalArgumentException(s"panel '${item.id}' config patch: $err")
            }
            val patchedRow = domainToRow(patched)
            updates += table.filter(_.id === item.id)
              .map(r => (configColumnsOf(r), r.lastUpdated))
              .update((configColumnValuesOf(patchedRow), now))
              .map(_ => ())
          }

          val actions = updates.result()
          if (actions.isEmpty) DBIO.successful(())
          else DBIO.seq(actions: _*)
      }

    val action =
      DBIO.sequence(items.map(buildItemAction))
        .andThen(table.filter(_.id inSet panelIds.toSet).result)
        .transactionally

    ctx.withSystemContext(action).map(_.map(rowToDomain).toVector)
  }

  /** Batch create (HEL-370 D1, placement HEL-1260): a multi-row INSERT plus, in the SAME transaction, the
   *  dashboard row lock and one layout item per panel at every breakpoint, stacked in input order
   *  below the existing items. All-or-nothing: a failed layout write rolls every panel back.
   *  Returns `panels` verbatim (not a re-query) so the response order is exactly the input order, with
   *  the items stored for each; `None` (nothing written) when the dashboard row cannot be read.
   *
   *  Privileged (`withSystemContext`, bypasses the `panels_insert` RLS `WITH
   *  CHECK` policy): `PanelService.batchCreate` has already confirmed the
   *  caller is an owner/editor of the target dashboard, and every panel
   *  passed here already has its `ownerId` set to that ACL-checked caller by
   *  `PanelService.buildForCreate` -- mirrors `duplicate`'s identical bypass rationale above. The
   *  layout write rides the same bypass: it only touches `layout`/`last_updated` of the dashboard
   *  the ACL check already admitted. */
  def insertBatchPlaced(panels: Vector[(Panel, PlacementSizes)]): Future[Option[Vector[(Panel, PlacedLayouts)]]] = {
    if (panels.isEmpty) return Future.successful(Some(Vector.empty))
    val inserts = DBIO.sequence(panels.map { case (p, _) => table += domainToRow(p) })
    val plan    = (_: DashboardLayout) => panels.map { case (p, sizes) => p.id -> sizes }
    val action  = PanelLayoutPlacement
      .insertAndAppend(panels.head._1.dashboardId, inserts, plan)
      .map(placed => Option(panels.map(_._1).zip(placed)))
      .transactionally
    ctx.withSystemContext(action).recover { case _: PlacementTargetMissing => None }
  }
}
