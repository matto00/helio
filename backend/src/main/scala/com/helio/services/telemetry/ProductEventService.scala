package com.helio.services.telemetry

import com.helio.domain.model.UserId
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.telemetry.ProductEventRepository
import com.helio.services.ServiceError
import org.slf4j.LoggerFactory
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Ingestion for first-party product events (HEL-1208). The whole batch is validated before
 *  anything is stored: one bad event rejects the request with 400 and stores nothing. */
final class ProductEventService(repo: ProductEventRepository, clock: Clock)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** `body` is `{"events": [{event, properties?, occurredAt?}, ...]}`; returns the number of
   *  events accepted (a deduplicated once-per-user repeat still counts as accepted). */
  def ingest(userId: UserId, body: JsValue): Future[Either[ServiceError, Int]] = {
    val now = clock.now()
    parse(body, now) match {
      case Left(msg)     => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(events) => repo.insertBatch(userId, events).map(_ => Right(events.size))
    }
  }

  private def parse(body: JsValue, now: Instant): Either[String, Seq[ValidatedProductEvent]] =
    body match {
      case JsObject(fields) if fields.keySet == Set("events") =>
        fields("events") match {
          case JsArray(items) if items.isEmpty => Left("events must not be empty")
          case JsArray(items) if items.size > ProductEventRegistry.MaxBatchSize =>
            Left(s"at most ${ProductEventRegistry.MaxBatchSize} events per request")
          case JsArray(items) =>
            items.foldLeft[Either[String, Vector[ValidatedProductEvent]]](Right(Vector.empty)) { (acc, item) =>
              acc.flatMap(done => ProductEventRegistry.validateClientEvent(item, now).map(done :+ _))
            }
          case _ => Left("events must be an array")
        }
      case _ => Left("body must be an object with a single 'events' array")
    }

  /** Best-effort server-side signup event: a telemetry failure is logged and never propagates, so
   *  it can never fail a registration. */
  def recordSignup(userId: UserId): Future[Unit] =
    Future(repo.insertBatch(userId, Seq(ValidatedProductEvent(ProductEventRegistry.SignupCompleted, JsObject.empty, clock.now())))).flatten
      .map(_ => ())
      .recover { case NonFatal(e) => log.error(s"signup_completed record failed for user ${userId.value}", e) }
}
