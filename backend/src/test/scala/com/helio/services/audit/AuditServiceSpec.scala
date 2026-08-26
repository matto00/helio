package com.helio.services.audit

import com.helio.domain.model._
import com.helio.domain.model.AuditEvent.NewAuditEvent
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** `AuditService.record` failure isolation (HEL-471 tasks.md 6.3). Both stub
 *  repositories below were run against a naive
 *  `auditEventRepo.append(event).recover { case NonFatal(e) => () }`
 *  implementation before the eager `Future(...)` guard was added: the
 *  failed-`Future` case passed against that naive version, but the
 *  synchronous-throw case failed it (`ThrowingRepository`'s
 *  `IllegalStateException` propagated straight out of `record`, uncaught,
 *  because the throw happens before `.recover` is ever reached) — see
 *  `openspec/changes/audit-event-append-only-store/evidence.md`. */
class AuditServiceSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val actor = UserId(UUID.randomUUID().toString)

  /** A repository whose `append` returns an already-failed `Future`. */
  private class FailingFutureRepository extends AuditEventRepository(ctx = null) {
    override def append(event: NewAuditEvent): Future[AuditEventId] =
      Future.failed(new RuntimeException("append failed"))
  }

  /** A repository whose `append` throws synchronously, before ever
   *  producing a `Future` — the case a bare `.recover` cannot catch. */
  private class ThrowingRepository extends AuditEventRepository(ctx = null) {
    override def append(event: NewAuditEvent): Future[AuditEventId] =
      throw new IllegalStateException("synchronous append failure")
  }

  "record" should {
    "complete successfully even when the repository's append returns a failed Future" in {
      val service = new AuditService(new FailingFutureRepository)
      noException should be thrownBy await(service.record(
        Some(actor), None, AuditSource.Ui, "dashboard.create", "dashboard", None
      ))
    }

    "complete successfully even when the repository's append throws synchronously" in {
      val service = new AuditService(new ThrowingRepository)
      noException should be thrownBy await(service.record(
        Some(actor), None, AuditSource.Ui, "dashboard.create", "dashboard", None
      ))
    }

    "pass through the supplied actor/source/action/resource/metadata to append" in {
      var captured: Option[NewAuditEvent] = None
      val repo = new AuditEventRepository(ctx = null) {
        override def append(event: NewAuditEvent): Future[AuditEventId] = {
          captured = Some(event)
          Future.successful(AuditEventId(UUID.randomUUID().toString))
        }
      }
      val service  = new AuditService(repo)
      val metadata = JsObject("k" -> JsString("v"))

      await(service.record(Some(actor), None, AuditSource.Pat, "pipeline.run", "pipeline", Some("p1"), metadata))

      captured shouldBe Some(NewAuditEvent(Some(actor), None, AuditSource.Pat, "pipeline.run", "pipeline", Some("p1"), metadata))
    }

    "record a system event with no actor" in {
      var captured: Option[NewAuditEvent] = None
      val repo = new AuditEventRepository(ctx = null) {
        override def append(event: NewAuditEvent): Future[AuditEventId] = {
          captured = Some(event)
          Future.successful(AuditEventId(UUID.randomUUID().toString))
        }
      }
      val service = new AuditService(repo)

      await(service.record(None, None, AuditSource.System, "ratelimit.trip", "rate-limit-bucket", None))

      captured.map(_.actorUserId) shouldBe Some(None)
      captured.map(_.actorTokenId) shouldBe Some(None)
    }
  }
}
