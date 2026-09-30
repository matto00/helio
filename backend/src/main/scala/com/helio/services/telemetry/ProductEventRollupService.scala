package com.helio.services.telemetry

import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.telemetry.ProductEventRepository
import org.slf4j.LoggerFactory

import java.time.{Instant, LocalDate, ZoneOffset}
import scala.concurrent.{ExecutionContext, Future}

/** Materialises the daily product-event rollups and runs the retention purge; driven by the
 *  existing `PipelineSchedulerService.tick()` (no dedicated timer). Rollups are materialised
 *  rather than computed on read because the per-user rows are purged while history must survive.
 *
 *  Invariant (design.md Decision 3): a day enters the `rolled_through` high-water mark only once
 *  it is at least 2 UTC days old, after a final rollup of that day in the same pass. Client
 *  `occurredAt` is clamped to now-24h, so no late row can land in a day already past the mark. */
final class ProductEventRollupService(repo: ProductEventRepository, config: ProductTelemetryConfig, clock: Clock)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val PurgeMinIntervalSeconds = 3600L

  def tick(): Future[Unit] = tickAt(clock.now())

  def tickAt(now: Instant): Future[Unit] = {
    val today = now.atOffset(ZoneOffset.UTC).toLocalDate
    val rollup = repo.state().flatMap { st =>
      val recomputeFloor = today.minusDays(1)
      val start: Future[Option[LocalDate]] = st.rolledThrough match {
        case Some(rt) => Future.successful(Some(minDate(rt.plusDays(1), recomputeFloor)))
        case None     => repo.earliestEventDay()
      }
      start.flatMap {
        case Some(from) if !from.isAfter(today) =>
          repo.rollupRange(from, today, advanceThrough = today.minusDays(2), now, config.retentionDays)
        case _ => Future.successful(())
      }
    }
    rollup
      .flatMap(_ => repo.purgeIfDue(now, config.retentionDays, PurgeMinIntervalSeconds))
      .map(_ => ())
      .recover { case e => log.error("product event rollup/purge tick failed", e) }
  }

  private def minDate(a: LocalDate, b: LocalDate): LocalDate = if (a.isBefore(b)) a else b
}
