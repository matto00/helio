package com.helio.services.telemetry

import com.helio.api.protocols.admin._
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.telemetry.ProductUsageRepository
import com.helio.infrastructure.persistence.telemetry.ProductUsageRepository.{ActiveUsersRow, EventDayRow, TtfdRow}
import com.helio.services.ServiceError

import java.time.{LocalDate, ZoneOffset}
import scala.concurrent.{ExecutionContext, Future}

/** Assembles the owner usage view from the rollup tables only (HEL-1211, design.md Decisions 1,
 *  3-6). Never reads `product_events`; the response carries no user identifier.
 *
 *  Window: the last `days` UTC days ending at `rolled_through` (the last fully rolled day), or
 *  ending today (UTC) when nothing has been rolled up yet. Count series are zero-filled so a
 *  chart axis is continuous; WAU and TTFD for a day without data are `None` (a gap, never 0). */
final class AdminUsageService(repo: ProductUsageRepository, clock: Clock)(implicit ec: ExecutionContext) {

  import AdminUsageService._

  /** `rawDays` is the unparsed query value: absent -> [[DefaultDays]]; non-numeric or outside
   *  `1..90` -> `BadRequest` (rejected, never clamped). */
  def usage(rawDays: Option[String]): Future[Either[ServiceError, AdminUsageResponse]] =
    parseDays(rawDays) match {
      case Left(msg)    => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(days)  => load(days).map(Right(_))
    }

  private def parseDays(raw: Option[String]): Either[String, Int] =
    raw match {
      case None => Right(DefaultDays)
      case Some(s) =>
        s.toIntOption.filter(d => d >= MinDays && d <= MaxDays).toRight(s"days must be an integer between $MinDays and $MaxDays")
    }

  private def load(days: Int): Future[AdminUsageResponse] =
    repo.rolledThrough().flatMap { rolled =>
      val to       = rolled.getOrElse(clock.now().atOffset(ZoneOffset.UTC).toLocalDate)
      val from     = to.minusDays(days - 1L)
      val window   = Iterator.iterate(from)(_.plusDays(1)).takeWhile(!_.isAfter(to)).toSeq
      val events   = Seq(Signup, Provenance, FileDropped, DashboardCreated, FirstRendered)
      // Nothing has been finalised yet (`rolled_through` is null): the only rollup rows that may
      // exist are the still-moving yesterday/today recomputes, which are not final numbers, so
      // none are read -- the response is the zero-filled empty window.
      if (rolled.isEmpty) Future.successful(empty(days, from, to, window))
      else for {
        eventRows <- repo.eventDaily(from, to, events)
        active    <- repo.activeUsersDaily(from, to)
        ttfd      <- repo.ttfdDaily(from, to)
        templates <- repo.propertyTotals(from, to, ProductEventRegistry.FirstrunTemplateChosen, "template")
      } yield AdminUsageResponse(
        days                  = days,
        from                  = from.toString,
        to                    = to.toString,
        rolledThrough         = rolled.map(_.toString),
        signupsPerDay         = countSeries(window, eventRows, Signup),
        ttfd                  = ttfdSeries(window, ttfd),
        funnel                = funnel(eventRows),
        templateChoices       = templates.map { case (t, n) => AdminUsageTemplateCount(t, n) },
        provenanceOpensPerDay = countSeries(window, eventRows, Provenance),
        activeUsers           = activeSeries(window, active)
      )
    }

  private def empty(days: Int, from: LocalDate, to: LocalDate, window: Seq[LocalDate]): AdminUsageResponse =
    AdminUsageResponse(
      days                  = days,
      from                  = from.toString,
      to                    = to.toString,
      rolledThrough         = None,
      signupsPerDay         = countSeries(window, Nil, Signup),
      ttfd                  = ttfdSeries(window, Nil),
      funnel                = funnel(Nil),
      templateChoices       = Nil,
      provenanceOpensPerDay = countSeries(window, Nil, Provenance),
      activeUsers           = activeSeries(window, Nil)
    )

  private def countSeries(window: Seq[LocalDate], rows: Seq[EventDayRow], event: String): Seq[AdminUsageDayCount] = {
    val byDay = rows.filter(_.event == event).map(r => r.day -> r.eventCount).toMap
    window.map(d => AdminUsageDayCount(d.toString, byDay.getOrElse(d, 0L)))
  }

  private def activeSeries(window: Seq[LocalDate], rows: Seq[ActiveUsersRow]): Seq[AdminUsageActiveUsersDay] = {
    val byDay = rows.map(r => r.day -> r).toMap
    window.map { d =>
      val row = byDay.get(d)
      AdminUsageActiveUsersDay(d.toString, row.fold(0L)(_.dailyActiveUsers), row.flatMap(_.weeklyActiveUsers))
    }
  }

  private def ttfdSeries(window: Seq[LocalDate], rows: Seq[TtfdRow]): AdminUsageTtfd = {
    val byDay = rows.map(r => r.day -> r).toMap
    val perDay = window.map { d =>
      byDay.get(d).fold(AdminUsageTtfdDay(d.toString, 0, None, None))(r =>
        AdminUsageTtfdDay(d.toString, r.sampleCount, Some(r.medianSeconds), Some(r.p90Seconds))
      )
    }
    AdminUsageTtfd(newUsersOnly = true, perDay = perDay, latest = perDay.reverseIterator.find(_.sampleCount > 0))
  }

  /** Window sums of per-day distinct users per stage; conversion is stage / previous stage. */
  private def funnel(rows: Seq[EventDayRow]): Seq[AdminUsageFunnelStage] = {
    val users = rows.groupBy(_.event).view.mapValues(_.map(_.activeUsers).sum).toMap
    val counts = FunnelStages.map(s => s -> users.getOrElse(s, 0L))
    counts.zipWithIndex.map { case ((stage, n), i) =>
      val conversion =
        if (i == 0) None
        else Some(counts(i - 1)._2).filter(_ > 0).map(prev => n.toDouble / prev)
      AdminUsageFunnelStage(stage, n, conversion)
    }
  }
}

object AdminUsageService {
  val DefaultDays: Int = 30
  val MinDays: Int     = 1
  val MaxDays: Int     = 90

  private val Signup           = ProductEventRegistry.SignupCompleted
  private val Provenance       = ProductEventRegistry.ProvenanceOpened
  private val FileDropped      = ProductEventRegistry.FirstrunFileDropped
  private val DashboardCreated = ProductEventRegistry.FirstrunDashboardCreated
  private val FirstRendered    = ProductEventRegistry.FirstDashboardRendered

  /** First-run funnel stages in order. */
  val FunnelStages: Seq[String] = Seq(FileDropped, DashboardCreated, FirstRendered)
}
