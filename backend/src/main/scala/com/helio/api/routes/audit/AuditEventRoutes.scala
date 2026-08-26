package com.helio.api.routes.audit

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.audit.AuditEventResponse
import com.helio.domain.model._
import com.helio.infrastructure.persistence.audit.{AuditEventFilters, AuditEventRepository}

import java.time.Instant
import java.time.format.DateTimeParseException
import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for `GET /api/audit-events` (HEL-488). All RLS-scoping
 *  and filter composition lives in [[AuditEventRepository.findPaged]] —
 *  this route's only jobs are: parse/validate query params (400 on a
 *  malformed `from`/`to` or unrecognized `source`, per design.md Decision 4),
 *  and pass `user.id` as `callerUserId` — never a client-supplied value —
 *  mirroring `MetricRoutes`/`DataTypeRoutes`'s existing paginated-list
 *  shape. */
final class AuditEventRoutes(
    auditEventRepo: AuditEventRepository,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private def parseInstant(raw: String): Either[String, Instant] =
    Try(Instant.parse(raw)) match {
      case Success(instant) => Right(instant)
      case Failure(_: DateTimeParseException) => Left(s"Invalid timestamp: '$raw'")
      case Failure(other) => Left(s"Invalid timestamp: '$raw' (${other.getMessage})")
    }

  val routes: Route =
    pathPrefix("audit-events") {
      pathEndOrSingleSlash {
        get {
          parameters(
            "offset".as[Int].withDefault(Page.Default.offset),
            "limit".as[Int].withDefault(Page.Default.limit),
            "resourceType".optional,
            "resourceId".optional,
            "action".optional,
            "source".optional,
            "from".optional,
            "to".optional
          ) { (offsetRaw, limitRaw, resourceType, resourceId, action, sourceRaw, fromRaw, toRaw) =>
            if (offsetRaw < 0) {
              complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
            } else {
              val sourceParsed = sourceRaw.map(AuditSource.fromString)
              val fromParsed   = fromRaw.map(parseInstant)
              val toParsed     = toRaw.map(parseInstant)

              val firstError: Option[String] =
                sourceParsed.collectFirst { case Left(err) => err }
                  .orElse(fromParsed.collectFirst { case Left(err) => err })
                  .orElse(toParsed.collectFirst { case Left(err) => err })

              firstError match {
                case Some(err) =>
                  complete(StatusCodes.BadRequest, ErrorResponse(err))
                case None =>
                  val filters = AuditEventFilters(
                    resourceType = resourceType,
                    resourceId   = resourceId,
                    action       = action,
                    source       = sourceParsed.collect { case Right(s) => s },
                    from         = fromParsed.collect { case Right(i) => i },
                    to           = toParsed.collect { case Right(i) => i }
                  )
                  val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                  onSuccess(auditEventRepo.findPaged(user.id, filters, page)) { result =>
                    complete(PagedResult(result.items.map(AuditEventResponse.fromDomain), result.total, result.offset, result.limit))
                  }
              }
            }
          }
        }
      }
    }
}
