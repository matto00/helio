package com.helio.api.http

import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.services.sources.CsvLimits
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.`Retry-After`
import org.apache.pekko.http.scaladsl.server.{Directive, Directive0, Directives, ExceptionHandler, RequestContext, RouteResult}
import org.apache.pekko.http.scaladsl.model.{EntityStreamException, EntityStreamSizeException}

import java.util.concurrent.Semaphore
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Guards the CSV multipart upload routes: at most `maxConcurrent` in flight per instance (an
 *  upload buffers the whole body, so concurrency is what multiplies heap use), a byte-cap-plus-margin
 *  entity limit scoped to those routes only, and a 413 `ErrorResponse` instead of Pekko's default
 *  500 when the entity is too large.
 *
 *  The permit is taken before the entity is touched, so a rejected request never buffers its body
 *  (429 + `Retry-After`), and it is released when the inner route's result future completes,
 *  whether that is a response, a rejection or a failure (a client abort fails the entity stream
 *  inside the route, which still completes the future). */
final class CsvUploadGate(maxConcurrent: Int, retryAfterSeconds: Long = 5L)(implicit ec: ExecutionContext)
    extends Directives
    with JsonProtocols {

  private val permits = new Semaphore(maxConcurrent)

  def inFlight: Int = maxConcurrent - permits.availablePermits()

  private val permit: Directive0 = Directive[Unit] { inner => ctx =>
    if (!permits.tryAcquire())
      respondTooBusy(ctx)
    else
      try {
        val result = inner(())(ctx)
        result.onComplete(_ => permits.release())
        result
      } catch {
        case NonFatal(e) =>
          permits.release()
          throw e
      }
  }

  private def respondTooBusy(ctx: RequestContext): Future[RouteResult] =
    (respondWithHeader(`Retry-After`(retryAfterSeconds)) {
      complete(StatusCodes.TooManyRequests, ErrorResponse("Too many CSV uploads are in progress; retry shortly"))
    })(ctx)

  private val entityTooLarge: ExceptionHandler = ExceptionHandler {
    case _: EntityStreamSizeException | _: EntityStreamException =>
      complete(StatusCodes.RequestEntityTooLarge, ErrorResponse(CsvLimits.message))
  }

  private def gated(entityLimit: Long): Directive0 =
    permit & withSizeLimit(entityLimit) & handleExceptions(entityTooLarge)

  /** Permit first (outermost), then the route-scoped size limit, then the 413 mapping. Applies
   *  only to multipart requests: a JSON body that falls through to the multipart branch of the
   *  create route keeps the global default limit and never takes (or is refused) a permit. */
  def csvUpload(entityLimit: Long = CsvLimits.entityLimitBytes): Directive0 =
    extractRequest.flatMap(req => if (req.entity.contentType.mediaType.isMultipart) gated(entityLimit) else pass)
}

object CsvUploadGate {
  val DefaultMaxConcurrent: Int = 2

  def maxConcurrentFromEnv(): Int =
    sys.env.get("CSV_UPLOAD_MAX_CONCURRENT").flatMap(_.toIntOption).filter(_ > 0).getOrElse(DefaultMaxConcurrent)
}
