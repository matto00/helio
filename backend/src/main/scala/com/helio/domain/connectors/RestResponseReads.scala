package com.helio.domain.connectors

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{HttpResponse, ResponseEntity}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

/** Response-body read helpers shared by the REST driver's request issuers, moved out of `RestApiConnectorDriver`
 *  unchanged (HEL-1013 D1) so the driver stays within its size budget. */
object RestResponseReads {

  /** HEL-1877: the limit `HttpEntity.toStrict(timeout)` applies when given no byte argument -- the same key, config and
   *  logic as Pekko HTTP 1.1.0's own (`private[http]`) `getPossiblyInfiniteBytes`, reproduced here so the 2xx limit is
   *  passed explicitly yet stays identical to today's, including under a config change (8 MiB by default). */
  def maxStrictBytes(system: ActorSystem[_]): Long = {
    val config = system.classicSystem.settings.config
    val key    = "pekko.http.parsing.max-to-strict-bytes"
    if (config.getString(key) == "infinite") Long.MaxValue else config.getBytes(key).longValue
  }

  /** HEL-1877: the capped `HTTP <code>: <body>` text of a non-2xx response, reading at most
   *  `RemoteErrorText.MaxBodyBytes` of the body, within the same 30 s ceiling as before. */
  def errorText(response: HttpResponse, code: Int)(implicit mat: Materializer, ec: ExecutionContext): Future[String] =
    RemoteErrorText
      .readBodyPrefix(response.entity.dataBytes, RemoteErrorText.MaxBodyBytes, 30.seconds)
      .map(prefix => RemoteErrorText.cap(s"HTTP $code: ${prefix.utf8String}"))

  /** HEL-1877: a connection test needs only the status of a 2xx, but a body over the 2xx limit (or slower than 30 s)
   *  still reports `Request failed`, as `toStrict` did. The body is counted, never held; a declared Content-Length over
   *  the limit fails at once and the entity is cancelled (releasing the connection) without being read. */
  def countWithinLimit(entity: ResponseEntity)(implicit system: ActorSystem[_], mat: Materializer, ec: ExecutionContext): Future[Unit] = {
    val limit = maxStrictBytes(system)
    entity.contentLengthOption match {
      case Some(length) if length > limit =>
        entity.dataBytes.runWith(Sink.cancelled)
        Future.failed(new IllegalStateException(s"response body of $length bytes exceeds $limit"))
      case _ =>
        entity.dataBytes
          .scan(0L)(_ + _.length)
          .map { total => if (total > limit) throw new IllegalStateException(s"response body exceeds $limit bytes") else total }
          .completionTimeout(30.seconds)
          .runWith(Sink.ignore)
          .map(_ => ())
    }
  }
}
