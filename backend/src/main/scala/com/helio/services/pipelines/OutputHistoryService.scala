package com.helio.services.pipelines

import com.helio.domain.history.OutputCompare
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId}
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, OutputHistoryPoint, OutputHistoryRepository, OutputRepository}
import com.helio.services.ServiceError
import org.slf4j.LoggerFactory
import spray.json.{JsArray, JsNull, JsNumber, JsObject, JsString, JsValue}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** A history point reduced to what a comparison needs. `value` is the stored, server-computed
 *  headline metric over ALL rows (summary `metric.value`), `None` when the summary has none. */
final case class ResolvedHistoryPoint(capturedAt: Instant, rowCount: Int, value: Option[Double], series: Option[JsValue])

/** `points` is newest first (the raw rows, after `limit`/`since`); `sparkline` is derived from the
 *  same points, oldest first. Everything but `points`/`sparkline` is resolved over the Output's
 *  whole retained history. */
final case class OutputHistoryResolution(
    compare: Option[String],
    current: Option[ResolvedHistoryPoint],
    baseline: Option[ResolvedHistoryPoint],
    delta: Option[Double],
    pct: Option[Double],
    availableFrom: Option[Instant],
    points: Vector[OutputHistoryPoint]
)

/** HEL-1276: a stored payload with the history point it was read through. */
final case class OutputHistoryPayload(point: OutputHistoryPoint, rowCount: Int, rows: JsArray)

/** HEL-1273: the one comparison-resolution routine behind both history routes (owner ruling D6).
 *  Reuses L1's `OutputHistoryRepository` reads as-is (no new SQL). Statement budget, independent of
 *  history size: `listRecent` always, `nearestAtOrBefore` for a window, `earliest` only when a window
 *  baseline is missing. */
final class OutputHistoryService(
    outputRepo: OutputRepository,
    historyRepo: OutputHistoryRepository,
    payloadRepo: NodePayloadHistoryRepository
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** Authorizes through `findById` (sharing-aware RLS; an unknown id and a no-access id are both
   *  `NotFound`, same message), then resolves. */
  def read(id: OutputId, user: AuthenticatedUser, limit: Int, since: Option[Instant]): Future[Either[ServiceError, OutputHistoryResolution]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(output) =>
        outputRepo.findConfigById(id, user).flatMap(cfg => forOutput(output, cfg.getOrElse(JsObject.empty), limit, since).map(Right(_)))
    }

  /** HEL-1276: the stored row payload of one history point. Authorizes through `findById` exactly as
   *  `read` does (an unknown id and a no-access id are the same `NotFound`), then loads the point
   *  scoped to this Output (a point of another Output never resolves), then its payload. A point
   *  with no payload is `NotFound`. Authenticated only: no public route calls this. */
  def payloadRows(id: OutputId, pointId: UUID, user: AuthenticatedUser): Future[Either[ServiceError, OutputHistoryPayload]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(_) =>
        historyRepo.findPoint(id.value, pointId).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("History point not found")))
          case Some(point) =>
            point.payloadId match {
              case None => Future.successful(Left(ServiceError.NotFound("History point has no stored payload")))
              case Some(pid) =>
                payloadRepo.findById(pid).map {
                  case None          => Left(ServiceError.NotFound("History point has no stored payload"))
                  case Some(payload) => Right(OutputHistoryPayload(point, payload.rowCount, payload.rows))
                }
            }
        }
    }

  /** No ACL: the caller must already have authorized access to `output` (the public route does so
   *  through its dashboard gate). */
  def forOutput(output: Output, config: JsObject, limit: Int, since: Option[Instant]): Future[OutputHistoryResolution] = {
    val id = output.id.value
    val compare: Option[OutputCompare] = OutputCompare.fromConfig(config) match {
      case Right(c)  => c
      case Left(err) =>
        // Only reachable for a row written outside the validated paths: degrade, never 500.
        log.warn(s"Output $id has an unparsable config.compare ($err); resolving as no comparison")
        None
    }
    val compareStr = compare.map(_ => rawCompare(config))
    historyRepo.listRecent(id, math.max(limit, 2)).flatMap { recent =>
      val points = recent.take(limit).filter(p => since.forall(s => !p.capturedAt.isBefore(s)))
      recent.headOption match {
        case None => Future.successful(OutputHistoryResolution(compareStr, None, None, None, None, None, points))
        case Some(head) =>
          val current = OutputHistoryService.resolve(head)
          resolveBaseline(id, head, recent, compare).map { case (baseline, availableFrom) =>
            val (delta, pct) = OutputHistoryService.deltaAndPct(current.value, baseline.flatMap(_.value))
            OutputHistoryResolution(compareStr, Some(current), baseline, delta, pct, availableFrom, points)
          }
      }
    }
  }

  private def rawCompare(config: JsObject): String =
    config.fields.get("compare").collect { case JsString(s) => s }.getOrElse("")

  private def resolveBaseline(
      id: String,
      head: OutputHistoryPoint,
      recent: Vector[OutputHistoryPoint],
      compare: Option[OutputCompare]
  ): Future[(Option[ResolvedHistoryPoint], Option[Instant])] =
    compare match {
      case None                         => Future.successful((None, None))
      case Some(OutputCompare.PreviousRun) =>
        Future.successful((recent.lift(1).map(OutputHistoryService.resolve), None))
      case Some(OutputCompare.Window(w)) =>
        // Measured from the LATEST point, not wall-clock now (owner ruling D6).
        historyRepo.nearestAtOrBefore(id, head.capturedAt.minus(w)).flatMap {
          case Some(p) => Future.successful((Some(OutputHistoryService.resolve(p)), None))
          case None    => historyRepo.earliest(id).map(e => (None, e.map(_.plus(w))))
        }
    }
}

object OutputHistoryService {

  def resolve(p: OutputHistoryPoint): ResolvedHistoryPoint = ResolvedHistoryPoint(p.capturedAt, p.rowCount, headline(p.summary), p.summary.fields.get("series").filter(_ != JsNull))

  /** The stored summary's all-rows metric value (`v == 1`, `metric.value` a JSON number). */
  def headline(summary: JsObject): Option[Double] =
    for {
      JsNumber(v)    <- summary.fields.get("v")
      if v == BigDecimal(1)
      metric         <- summary.fields.get("metric").collect { case o: JsObject => o }
      JsNumber(value) <- metric.fields.get("value")
    } yield value.toDouble

  /** `delta = cur - base`; `pct = delta / |base| * 100` (null when base is 0); non-finite -> None. */
  def deltaAndPct(current: Option[Double], baseline: Option[Double]): (Option[Double], Option[Double]) =
    (current, baseline) match {
      case (Some(c), Some(b)) =>
        val delta = Some(c - b).filter(finite)
        val pct   = if (b == 0.0) None else Some((c - b) / math.abs(b) * 100.0).filter(finite)
        (delta, pct)
      case _ => (None, None)
    }

  private def finite(d: Double): Boolean = !d.isNaN && !d.isInfinite
}
