package com.helio.infrastructure

import com.helio.api.protocols.PanelBatchItem
import com.helio.domain._
import com.helio.domain.panels._
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

  /** Privileged duplicate: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. New row is inserted with the calling user's
   *  ownerId so V36 RLS policies apply to it correctly after insertion. */
  def duplicate(id: PanelId, ownerId: UserId): Future[Option[Panel]] = {
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
            (table += newRow).map(_ => Some(rowToDomain(newRow)))
          }
    }.transactionally

    ctx.withSystemContext(action)
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

          item.appearance.foreach { ap =>
            val current = row.appearance
            val merged = PanelAppearance(
              background   = ap.background.getOrElse(current.background),
              color        = ap.color.getOrElse(current.color),
              transparency = ap.transparency.getOrElse(current.transparency),
              chart        = ap.chart.orElse(current.chart)
            )
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
              .map(r => (r.typeId, r.fieldMapping, r.content, r.imageUrl, r.imageFit, r.dividerOrientation, r.dividerWeight, r.dividerColor, r.lastUpdated))
              .update((patchedRow.typeId, patchedRow.fieldMapping, patchedRow.content, patchedRow.imageUrl, patchedRow.imageFit, patchedRow.dividerOrientation, patchedRow.dividerWeight, patchedRow.dividerColor, now))
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
}
