package com.helio.infrastructure.persistence.dashboards

import com.helio.domain.model._
import slick.jdbc.PostgresProfile.api._
import DashboardRepository.{dashboardAppearanceColumnType, dashboardLayoutColumnType, instantColumnType}

import java.time.Instant
import scala.concurrent.Future

/** A layout write that only lands while the stored layout is still version `expectedVersion`. */
final case class LayoutCas(expectedVersion: Long, next: DashboardLayout)

sealed trait DashboardWriteResult
object DashboardWriteResult {
  final case class Written(dashboard: Dashboard)    extends DashboardWriteResult
  case object NotFound                              extends DashboardWriteResult
  /** The layout version moved since the caller read it; nothing was written. `current` is the row as it is now. */
  final case class LayoutMoved(current: Dashboard)  extends DashboardWriteResult
}

/** The one dashboard field write (HEL-1457), extracted so [[DashboardRepository]] stays small. */
trait DashboardFieldWriteOps { self: DashboardRepository =>

  /** Writes only the fields supplied, plus `last_updated`, in ONE transaction under the owner's user context
   *  (V36's `dashboards_update` policy applies), and returns the re-read row.
   *
   *  The layout is a compare-and-set, `WHERE layout_version = expected`, and runs FIRST so a miss leaves the
   *  transaction having written nothing: a rejected layout saves no name or appearance either. It takes only the
   *  dashboard row lock every UPDATE takes, never a panel row lock, so the HEL-1485 order ("panel rows, then
   *  dashboards") is not touched. Under READ COMMITTED a CAS that waited on another writer's lock re-evaluates its
   *  `WHERE` against that writer's committed row, so the loser sees the bumped version and matches nothing. */
  def writeFields(
      id: DashboardId,
      ownerId: UserId,
      layout: Option[LayoutCas],
      name: Option[String],
      appearance: Option[DashboardAppearance],
      now: Instant
  ): Future[DashboardWriteResult] = {
    val row = table.filter(_.id === id.value)

    def readBack(onRow: Dashboard => DashboardWriteResult): DBIO[DashboardWriteResult] =
      row.result.headOption.map(_.fold[DashboardWriteResult](DashboardWriteResult.NotFound)(r => onRow(rowToDomain(r))))

    val layoutStep: DBIO[Int] = layout.fold[DBIO[Int]](DBIO.successful(1)) { cas =>
      table.filter(d => d.id === id.value && d.layoutVersion === cas.expectedVersion)
        .map(r => (r.layout, r.lastUpdated)).update((cas.next, now))
    }

    val action: DBIO[DashboardWriteResult] = layoutStep.flatMap { layoutRows =>
      if (layout.isDefined && layoutRows == 0) readBack(DashboardWriteResult.LayoutMoved(_))
      else {
        val renameStep     = name.fold[DBIO[Int]](DBIO.successful(1))(n => row.map(r => (r.name, r.lastUpdated)).update((n, now)))
        val appearanceStep = appearance.fold[DBIO[Int]](DBIO.successful(1))(a => row.map(r => (r.appearance, r.lastUpdated)).update((a, now)))
        renameStep.andThen(appearanceStep).andThen(readBack(DashboardWriteResult.Written(_)))
      }
    }.transactionally

    ctx.withUserContext(ownerId.value)(action)
  }
}
