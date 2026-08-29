package com.helio.services.sources

import org.apache.pekko.actor.typed.ActorSystem

import java.net.{InetAddress, URI}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Discriminated outcome of a URL-backed CSV fetch attempt. Four distinct
 *  callers need four distinct HTTP statuses out of this one channel (design.md
 *  Decision 2) — a bare `Left[String]` would leave only message-substring
 *  matching to recover the status, which nothing authorises. */
sealed trait CsvUrlFetchError { def message: String }

object CsvUrlFetchError {
  final case class InvalidScheme(message: String) extends CsvUrlFetchError
  final case class Upstream(message: String)      extends CsvUrlFetchError
  final case class TooLarge(message: String)      extends CsvUrlFetchError
  final case class NotCsv(message: String)        extends CsvUrlFetchError
}

/** The single shared ingestion path for every URL-backed CSV fetch — create,
 *  manual refresh, and the pipeline-engine run path (design.md Decision 2).
 *  All three call sites call [[fetch]] directly; none reimplements any of its
 *  four checks (https-only scheme gate, the shared SSRF guard, the size
 *  limit, the non-CSV-body gate), so all three get byte-identical semantics
 *  by construction.
 *
 *  A new, PUBLIC object rather than an addition to `DataSourceCsvSupport`:
 *  that file's own scaladoc disclaims a Pekko dependency, and this helper
 *  needs `ActorSystem` (for [[ContentSourceSupport.fetchUrl]]). Public (not
 *  private) because `PipelineRunService` holds no `DataSourceService`
 *  reference and cannot call a private method on one — a private helper here
 *  would guarantee the exact two-copies drift this design exists to
 *  prevent. */
object CsvUrlFetch {

  /** The CSV size limit, defined exactly once (design.md Decision 7) so the
   *  route-layer multipart check and every URL path read the same value
   *  rather than each keeping its own literal default that could silently
   *  diverge. Unchanged in value from the pre-existing route default:
   *  50 MiB. */
  val maxFileSizeBytes: Long =
    sys.env.get("CSV_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(52428800L)

  /** `fetch` performs, in order: (1) an https-only scheme pre-check on the
   *  parsed URI — never a `startsWith("https://")` string test, which would
   *  accept `https:/evil`-style inputs inconsistently and reject valid
   *  mixed-case schemes; (2) [[ContentSourceSupport.fetchUrl]] (the shared
   *  SSRF guard, reused rather than forked, per design.md Decision 1/2);
   *  (3) the size check; (4) the non-CSV-body gate.
   *
   *  `resolveHost`/`isBlocked` default to the same production values
   *  `ContentSourceSupport`'s other callers use; tests may override them to
   *  exercise the guard against a local test server without weakening it for
   *  any other caller. */
  def fetch(
      url: String,
      maxBytes: Long,
      resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
  )(implicit system: ActorSystem[_]): Future[Either[CsvUrlFetchError, Array[Byte]]] = {
    implicit val ec: ExecutionContext = system.executionContext

    Try(new URI(url)).toOption.flatMap(uri => Option(uri.getScheme)).map(_.toLowerCase) match {
      case Some("https") =>
        ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked).map {
          case Left(err) => Left(CsvUrlFetchError.Upstream(err))
          case Right(bytes) =>
            if (bytes.length.toLong > maxBytes)
              Left(CsvUrlFetchError.TooLarge(s"CSV at $url exceeds the maximum allowed size of $maxBytes bytes"))
            else
              nonCsvGate(url, bytes)
        }
      case other =>
        val scheme = other.getOrElse("(none)")
        Future.successful(
          Left(CsvUrlFetchError.InvalidScheme(s"Unsupported URL scheme '$scheme': only https is allowed for CSV URL ingestion."))
        )
    }
  }

  /** Reject an obviously-non-CSV body (design.md Decision 8): skip a leading
   *  UTF-8 BOM (`EF BB BF`) — `Character.isWhitespace('﻿')` is `false`,
   *  so a naive whitespace-only skip would let a BOM'd HTML body smuggle past
   *  this gate — and any leading ASCII whitespace; if the next byte is `<`,
   *  reject. Schema inference has no failure path of its own, so without this
   *  an HTML interstitial/login page/rate-limit notice returned with HTTP 200
   *  would silently become a CSV source with a garbage one-column schema. */
  private def nonCsvGate(url: String, bytes: Array[Byte]): Either[CsvUrlFetchError, Array[Byte]] = {
    val bom          = Array(0xef.toByte, 0xbb.toByte, 0xbf.toByte)
    val afterBom     = if (bytes.length >= 3 && bytes.take(3).sameElements(bom)) bytes.drop(3) else bytes
    val firstNonWs   = afterBom.indexWhere(b => !isAsciiWhitespace(b))
    val firstReal    = if (firstNonWs < 0) None else Some(afterBom(firstNonWs))
    if (firstReal.contains('<'.toByte))
      Left(CsvUrlFetchError.NotCsv(s"URL $url returned HTML/XML content rather than CSV."))
    else
      Right(bytes)
  }

  private def isAsciiWhitespace(b: Byte): Boolean = {
    val c = b & 0xff
    c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == 0x0b
  }
}
