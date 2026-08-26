package com.helio.services.audit

import com.helio.domain.model._
import com.helio.domain.model.AuditEvent.NewAuditEvent
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** HEL-471 — the audit write path. `record` never fails, blocks, or
 *  otherwise perturbs the primary request it describes: a failed append is
 *  logged and swallowed, never propagated. No route, directive, or existing
 *  service calls this yet (design.md Non-Goals) — wiring `record` into a
 *  specific mutation is a later ticket's job. */
final class AuditService(auditEventRepo: AuditEventRepository)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** Appends an audit event; the returned `Future` always completes
   *  successfully. `Future(...)` below defers the repository call itself
   *  onto the execution context, so a repository that throws *synchronously*
   *  (before ever producing a `Future`) is caught by the same `.recover` that
   *  handles an asynchronously-failed `Future` — a bare
   *  `auditEventRepo.append(event).recover { ... }` would NOT catch a
   *  synchronous throw, since the throw happens before `.recover` is ever
   *  reached. */
  def record(
      actorUserId: Option[UserId],
      actorTokenId: Option[ApiTokenId],
      source: AuditSource,
      action: String,
      resourceType: String,
      resourceId: Option[String],
      metadata: JsValue = JsObject.empty
  ): Future[Unit] = {
    val event = NewAuditEvent(
      actorUserId  = actorUserId,
      actorTokenId = actorTokenId,
      source       = source,
      action       = action,
      resourceType = resourceType,
      resourceId   = resourceId,
      metadata     = metadata
    )
    Future(auditEventRepo.append(event)).flatten
      .map(_ => ())
      .recover {
        case NonFatal(e) =>
          log.error(
            "audit event append failed: source={} action={} resourceType={} resourceId={}",
            AuditSource.asString(source), action, resourceType, resourceId.getOrElse("<none>"), e
          )
      }
  }
}
