package com.helio.api.routes.pipelines

import com.helio.api.http.RateLimitDirective
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.api.routes.ServiceResponse
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.domain.model.{AuthenticatedUser, PipelineId}
import com.helio.services.pipelines.draftpreview.{DraftPreviewConfig, DraftPreviewGate, DraftPreviewLimits, DraftPreviewService}
import com.helio.services.pipelines.draftpreview.DraftPreviewService.SlotHooks
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.{`Cache-Control`, `Retry-After`, CacheDirectives}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.PathMatcher.Matched
import org.apache.pekko.http.scaladsl.server.{Directive, Directive1, PathMatcher1, RequestContext, Route, RouteResult}
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import spray.json._

import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.{DurationInt, DurationLong}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal
import scala.util.{Failure, Success, Try}

object DraftPreviewRoutes {

  /** The one path matcher, shared by this route and by the general `/api` limiter's exemption so the two cannot drift apart.
   *  Matched against the path AFTER the `/api` prefix. */
  val PathShape: PathMatcher1[PipelineId] = "pipelines" / PipelineIdSegment / "draft-preview"

  /** True for exactly `POST /api/pipelines/:id/draft-preview`: another method, a trailing slash or an extra segment is not
   *  exempt and stays counted by the general bucket. */
  def isDraftPreviewRequest(ctx: RequestContext): Boolean =
    ctx.request.method == HttpMethods.POST && WholePath(ctx.unmatchedPath).isInstanceOf[Matched[_]]

  private val WholePath: PathMatcher1[PipelineId] = Slash ~ PathShape ~ PathEnd

  val NdJson: ContentType.WithFixedCharset =
    ContentType(MediaType.customWithFixedCharset("application", "x-ndjson", HttpCharsets.`UTF-8`))

  private val ReadTimeout = 10.seconds

  private val Pending      = 0
  private val Materialized = 1
  private val Expired      = 2
}

/** `POST /api/pipelines/:id/draft-preview` (HEL-1630). Thin HTTP shell: it applies the endpoint's own rate limit, takes an
 *  in-flight slot BEFORE the body is read, reads the body under a hard size cap, and streams what
 *  [[DraftPreviewService]] produces. The slot is held until the response stream ends and is released on every earlier exit.
 *
 *  Mounted inside `authenticate`, so session/PAT auth, the CSRF header and `confineScopedToken` all still apply; only the
 *  general `/api` bucket is skipped (see `DraftPreviewRoutes.isDraftPreviewRequest`). The HEL-505 run guard is never touched. */
final class DraftPreviewRoutes(
    service: DraftPreviewService,
    user: AuthenticatedUser,
    rateLimit: RateLimitDirective,
    gate: DraftPreviewGate,
    config: DraftPreviewConfig
)(implicit ec: ExecutionContext, mat: Materializer)
    extends JsonProtocols {
  import DraftPreviewRoutes._

  private def bodyTooLarge = ErrorResponse(s"Draft preview body exceeds ${DraftPreviewLimits.MaxBodyBytes} bytes")

  private def busy: Route =
    respondWithHeader(`Retry-After`(1)) {
      complete(StatusCodes.TooManyRequests, ErrorResponse("Draft preview busy"))
    }

  /** Holds a slot for the inner route; a chunked 200 keeps it until its walk has ended (or, for a walk that never started, its
   *  stream ends), everything else gives it back now. */
  private val inFlightSlot: Directive1[DraftPreviewGate#Permit] = Directive[Tuple1[DraftPreviewGate#Permit]] { inner => ctx =>
    gate.tryAcquire(user.id.value) match {
      case None =>
        busy(ctx)
      case Some(permit) =>
        val result =
          try inner(Tuple1(permit))(ctx)
          catch { case NonFatal(e) => permit.release(); throw e }
        result.transform {
          case kept @ Success(RouteResult.Complete(resp)) if resp.status == StatusCodes.OK && resp.entity.isChunked() => kept
          case other                                                                                              => permit.release(); other
        }
    }
  }

  /** The permit must come back even when pekko-http drops the response without ever materializing its entity (the client reset the
   *  connection while `service.start` was still running): then the service's own `watchTermination` never fires. So the entity is
   *  guarded: if it has not been materialized within `config.materializeGraceMillis` the permit is released (idempotent) and the
   *  walk, which starts only on materialization, is never allowed to start; a cancel before the first element releases it at once.
   *  Once a walk HAS started the stream ending releases nothing (a cancelled walk still evaluates its current node): the walk's own
   *  completion does, see `SlotHooks`. */
  private def releasedIfNeverMaterialized(source: Source[ByteString, NotUsed], permit: DraftPreviewGate#Permit): Source[ByteString, NotUsed] = {
    val state = new AtomicInteger(Pending)
    val timer = mat.scheduleOnce(config.materializeGraceMillis.millis, () => if (state.compareAndSet(Pending, Expired)) permit.release())
    Source
      .lazySource { () =>
        if (state.compareAndSet(Pending, Materialized)) { timer.cancel(); source }
        else Source.empty[ByteString]
      }
      .mapMaterializedValue(_ => NotUsed)
      .watchTermination() { (notUsed, done) =>
        done.onComplete(_ => permit.releaseUnlessWalking())
        notUsed
      }
  }

  private def readBody(permit: DraftPreviewGate#Permit, pipelineId: PipelineId): Route =
    extractRequestContext { ctx =>
      val entity = ctx.request.entity
      if (entity.contentLengthOption.exists(_ > DraftPreviewLimits.MaxBodyBytes))
        complete(StatusCodes.RequestEntityTooLarge, bodyTooLarge)
      else
        onComplete(entity.withSizeLimit(DraftPreviewLimits.MaxBodyBytes).toStrict(ReadTimeout, DraftPreviewLimits.MaxBodyBytes.toLong)) {
          case Success(strict) =>
            Try(strict.data.utf8String.parseJson) match {
              case Success(json) =>
                // The body is in: only now does the request compete for one of the scarce running slots.
                if (!permit.startRunning()) busy
                else
                  ServiceResponse.run(service.start(pipelineId, json, user, SlotHooks(() => permit.releaseUnlessWalking(), () => permit.walkStarted(), () => permit.release()))) { source =>
                    HttpResponse(
                      entity = HttpEntity.Chunked.fromData(NdJson, releasedIfNeverMaterialized(source, permit)),
                      headers = List(`Cache-Control`(CacheDirectives.`no-store`))
                    )
                  }
              case Failure(_) => complete(StatusCodes.BadRequest, ErrorResponse("Draft preview body is not valid JSON"))
            }
          case Failure(_: EntityStreamSizeException) | Failure(_: EntityStreamException) =>
            complete(StatusCodes.RequestEntityTooLarge, bodyTooLarge)
          case Failure(_: TimeoutException) =>
            complete(StatusCodes.RequestTimeout, ErrorResponse("Draft preview body was not received in time"))
          case Failure(_) => complete(StatusCodes.BadRequest, ErrorResponse("Draft preview body could not be read"))
        }
    }

  val routes: Route =
    path(PathShape) { pipelineId =>
      post {
        rateLimit.rateLimit(config.requestsPerWindow) {
          inFlightSlot(permit => readBody(permit, pipelineId))
        }
      }
    }
}
