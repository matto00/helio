package com.helio.domain.connectors

import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.apache.pekko.util.ByteString

import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1841 (extends HEL-1727): the one cap on remote error text that embeds a response body. Applied where the text
 *  is built (the REST driver's non-2xx `HTTP <code>: <body>`), so every consumer (the source's stored `fetchError`,
 *  a run's `error_log`, the `test_connection` result, a proposal's blocked-run reason, the dry run's rejection) sees
 *  bounded text, and a large or hostile response cannot grow a tool result or the model's context. */
object RemoteErrorText {

  /** 500 matches `HomeSummaryLimits.ErrorLogMax`: it keeps an HTTP status plus the useful head of a JSON error body. */
  val MaxCodePoints: Int = 500

  private val TruncationMarker = " … [truncated]"

  /** Cuts `error` to [[MaxCodePoints]] code points plus a visible marker. Counted by code point (never splitting a
   *  surrogate pair); the `codePointCount` guard comes first because `offsetByCodePoints` throws when fewer code points
   *  exist than asked for, even when `length` exceeds the limit. Idempotent: re-capping capped text returns it
   *  unchanged. */
  def cap(error: String): String =
    if (error.codePointCount(0, error.length) <= MaxCodePoints) error
    else error.substring(0, error.offsetByCodePoints(0, MaxCodePoints)) + TruncationMarker

  /** HEL-1877: how many body bytes of a non-2xx response are read before the text is capped. A UTF-8 code point is at
   *  most 4 bytes, so the first [[MaxCodePoints]] code points of any body lie in its first `4 * MaxCodePoints` bytes,
   *  and the decoder needs at most 3 more bytes of lookahead to settle a trailing partial sequence; hence
   *  `4 * MaxCodePoints + 4` is the minimum, asserted by `RemoteErrorBodyPrefixSpec` (not a `require`, which would make
   *  a mutation of this constant fail at initialisation instead of at the assertion). 4 KiB leaves headroom. */
  val MaxBodyBytes: Int = 4096

  /** Reads at most `maxBytes` of `data`, then cancels the upstream (closing the HTTP connection) and returns exactly
   *  the first `maxBytes` bytes (fewer when the body is shorter). Raw bytes: the caller decodes once. Fails with a
   *  `TimeoutException` when the whole read exceeds `timeout`. */
  def readBodyPrefix(data: Source[ByteString, Any], maxBytes: Int, timeout: FiniteDuration)(implicit
      mat: Materializer,
      ec: ExecutionContext
  ): Future[ByteString] =
    data
      .scan(ByteString.empty)(_ ++ _)
      .takeWhile(_.length < maxBytes, inclusive = true)
      .completionTimeout(timeout)
      .runWith(Sink.last)
      .map(_.take(maxBytes))
}
