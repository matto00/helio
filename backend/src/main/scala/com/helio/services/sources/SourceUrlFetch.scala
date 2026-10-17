package com.helio.services.sources

import org.apache.pekko.actor.typed.ActorSystem

import java.net.InetAddress
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** HEL-862/HEL-881 (design.md Decision 2/3, task 2.2); extracted by HEL-1628 so a pipeline run and a source
 *  sample apply the SAME URL checks (one function, no copy): the single seam the engine calls for EVERY
 *  URL-backed source kind -- a thin closure that dispatches by `kind` to `CsvUrlFetch.fetch` (csv keeps its
 *  https-only + non-CSV-body gate) or `ContentSourceSupport.fetchUrlWithLimit` (text/pdf/image stay
 *  http-or-https, per Decision 3), NOT a second implementation of either's checks.
 *
 *  `system` is read INSIDE the closure (call time), never when the seam is built, so a fixture that never
 *  runs a URL-backed source never pays for (or NPEs on) a null `system`. */
object SourceUrlFetch {

  def seam(
      system: => ActorSystem[_],
      resolveHost: String => Try[Array[InetAddress]],
      isBlocked: (String, InetAddress) => Boolean
  )(implicit ec: ExecutionContext): (String, String) => Future[Either[String, Array[Byte]]] =
    (kind: String, url: String) =>
      if (system == null)
        Future.successful(Left("URL-backed source fetch is not configured"))
      else
        kind match {
          case "csv" =>
            CsvUrlFetch.fetch(url, CsvUrlFetch.maxFileSizeBytes, resolveHost, isBlocked)(system)
              .map(_.left.map(_.message))
          case "text"  => ContentSourceSupport.fetchUrlWithLimit(url, ContentSourceSupport.textMaxBytes, resolveHost, isBlocked)(system)
          case "pdf"   => ContentSourceSupport.fetchUrlWithLimit(url, ContentSourceSupport.pdfMaxBytes, resolveHost, isBlocked)(system)
          case "image" => ContentSourceSupport.fetchUrlWithLimit(url, ContentSourceSupport.imageMaxBytes, resolveHost, isBlocked)(system)
          case other   => Future.successful(Left(s"URL-backed fetch is not supported for source kind '$other'"))
        }
}
