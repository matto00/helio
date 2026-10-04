package com.helio.services.sources

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, HttpResponse}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Keep, Sink}

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** Loopback HTTP server that counts accepted TCP connections (not requests) and answers every
 *  request with `{"id":"<identity>"}`, so a test can tell both how many connections a client
 *  opened and which server a request really reached. */
final class ConnectionCountingServer(host: String, port: Int, val identity: String)(implicit
    system: ActorSystem[_],
    mat: Materializer
) {
  private val connections = new AtomicInteger(0)

  private val handler: HttpRequest => HttpResponse = _ =>
    HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, s"""{"id":"$identity"}"""))

  private val binding: Http.ServerBinding =
    Await.result(
      Http(system.classicSystem)
        .newServerAt(host, port)
        .connectionSource()
        .toMat(Sink.foreach { c =>
          connections.incrementAndGet()
          c.handleWithSyncHandler(handler)
        })(Keep.left)
        .run(),
      10.seconds
    )

  val boundPort: Int = binding.localAddress.getPort

  def connectionCount: Int = connections.get()

  def stop(): Unit = Await.ready(binding.unbind(), 10.seconds)
}
