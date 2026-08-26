package com.helio.services.audit

import com.helio.domain.model.AuditEvent.NewAuditEvent
import com.helio.domain.model.AuditEventId
import com.helio.infrastructure.persistence.audit.AuditEventRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-477 tasks.md 1.2 — shared test fixture for every service spec whose
 *  constructor now takes an `AuditService` param, so each spec doesn't have
 *  to hand-roll its own stub repository. Mirrors the anonymous-subclass
 *  pattern `AuditServiceSpec` already uses (`AuditEventRepository` is not
 *  `final`, and `append` is overridable) — `ctx = null` is safe because the
 *  overridden `append` never touches it. */
object AuditTestFixture {

  /** A no-op repository whose `append` always succeeds without touching a
   *  database — for specs that don't care about audit call arguments at all,
   *  just that the constructor compiles and the mutation isn't affected. */
  final class NoOpAuditEventRepository(implicit ec: ExecutionContext) extends AuditEventRepository(ctx = null) {
    override def append(event: NewAuditEvent): Future[AuditEventId] =
      Future.successful(AuditEventId("noop"))
  }

  def noOpAuditService(implicit ec: ExecutionContext): AuditService =
    new AuditService(new NoOpAuditEventRepository)

  /** A repository whose `append` always fails — for the "audit write never
   *  fails the underlying request" acceptance criterion (HEL-477 tasks.md
   *  7.4). `AuditService.record` already swallows this (HEL-471's own
   *  contract), so this fixture exists purely to prove that swallow holds
   *  at each call site, not to re-test `AuditService` itself. */
  final class FailingAuditEventRepository(implicit ec: ExecutionContext) extends AuditEventRepository(ctx = null) {
    override def append(event: NewAuditEvent): Future[AuditEventId] =
      Future.failed(new RuntimeException("HEL-477 test: simulated audit append failure"))
  }

  def failingAuditService(implicit ec: ExecutionContext): AuditService =
    new AuditService(new FailingAuditEventRepository)

  /** A repository that records every appended event in-memory (thread-unsafe,
   *  test-only) — for specs that assert on the exact action/resource/actor
   *  an audit call site produced. */
  final class CapturingAuditEventRepository(implicit ec: ExecutionContext) extends AuditEventRepository(ctx = null) {
    val events: scala.collection.mutable.ArrayBuffer[NewAuditEvent] = scala.collection.mutable.ArrayBuffer.empty
    override def append(event: NewAuditEvent): Future[AuditEventId] = {
      events += event
      Future.successful(AuditEventId(java.util.UUID.randomUUID().toString))
    }
  }

  def capturingAuditService(implicit ec: ExecutionContext): (AuditService, CapturingAuditEventRepository) = {
    val repo = new CapturingAuditEventRepository
    (new AuditService(repo), repo)
  }
}
