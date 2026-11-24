package com.helio.domain.connectors

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
}
