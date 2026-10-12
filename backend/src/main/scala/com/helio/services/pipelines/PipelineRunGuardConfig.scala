package com.helio.services.pipelines

import org.slf4j.LoggerFactory

/** Env-sourced configuration for the pipeline-run guard (HEL-505 design.md Decision 8): the
 *  DB-backed rate limit + concurrency cap on pipeline-run submission, plus the tighter per-user
 *  rate limit reused (unmodified `RateLimitDirective`) on source-fetch/preview routes. Constructed
 *  once via [[PipelineRunGuardConfig.fromEnv]] and threaded explicitly into `PipelineRunService`
 *  (rate limit + concurrency cap) and `ApiRoutes`'s `SourcePreviewRoutes`/`DataSourcePreviewRoutes`
 *  wiring (source-fetch rate limit) — mirrors `RateLimitConfig`/`UserTierConfig`'s
 *  fromEnv-once-inject-explicitly convention. Specs construct their own values directly (never via
 *  `fromEnv()`). */
final case class PipelineRunGuardConfig(
    rateLimitPerWindow:            Int,
    rateWindowSeconds:             Int,
    maxConcurrent:                 Int,
    concurrencyRetryAfterSeconds:  Long,
    sourceFetchRateLimitPerWindow: Int,
    // HEL-1504: max guard-rejection re-arms of one pending dataset-write auto-run before it is dropped
    // with a WARN. Defaulted so fixtures need not state it; read by PipelineAutoRunDebounceFirer.
    autoRunMaxRetries:             Int = PipelineRunGuardConfig.DefaultAutoRunMaxRetries,
    // HEL-1511: a non-terminal real run whose heartbeat is older than this is reaped as failed by the scheduler
    // tick. Defaulted so fixtures need not state it; read by PipelineSchedulerService.
    staleRunAfterSeconds:          Long = PipelineRunGuardConfig.DefaultStaleRunAfterSeconds
)

object PipelineRunGuardConfig {
  val DefaultRateLimitPerWindow: Int           = 10
  val DefaultRateWindowSeconds: Int            = 60
  val DefaultMaxConcurrent: Int                = 3
  val DefaultConcurrencyRetryAfterSeconds: Long = 15
  val DefaultSourceFetchRateLimitPerWindow: Int = 30
  val DefaultAutoRunMaxRetries: Int            = 10
  val DefaultStaleRunAfterSeconds: Long        = 600L
  /** Three missed heartbeats (30 s each): anything lower would reap a healthy run on a single late stamp. */
  val MinStaleRunAfterSeconds: Long            = 3 * RunHeartbeatService.IntervalSeconds
  /** HEL-1511 (Q5 A): a run that never had a heartbeat (a row written by the previous revision) is judged by its
   *  start against this longer bound, so a run still executing on an old revision mid-deploy is not reaped. */
  val LegacyRunStaleAfterSeconds: Long         = 3600L

  private val log = LoggerFactory.getLogger(getClass)

  /** `PIPELINE_RUN_STALE_AFTER_SECONDS`: a non-numeric value, or one below [[MinStaleRunAfterSeconds]], falls back
   *  to the default with a WARN. */
  private[pipelines] def parseStaleRunAfterSeconds(raw: Option[String]): Long =
    raw match {
      case None => DefaultStaleRunAfterSeconds
      case Some(v) =>
        v.trim.toLongOption.filter(_ >= MinStaleRunAfterSeconds) match {
          case Some(n) => n
          case None =>
            log.warn("PIPELINE_RUN_STALE_AFTER_SECONDS='{}' is not a number >= {}; using the default {}", v, MinStaleRunAfterSeconds, DefaultStaleRunAfterSeconds)
            DefaultStaleRunAfterSeconds
        }
    }

  /** Reads `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW`, `PIPELINE_RUN_RATE_WINDOW_SECONDS`,
   *  `PIPELINE_RUN_MAX_CONCURRENT`, `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS`, and
   *  `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`, and `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` (HEL-1504; a negative
   *  value also falls back; `0` means never retry), plus `PIPELINE_RUN_STALE_AFTER_SECONDS` (HEL-1511; see
   *  [[parseStaleRunAfterSeconds]]) (all falling back to their documented conservative
   *  defaults when unset or non-numeric). */
  def fromEnv(): PipelineRunGuardConfig =
    PipelineRunGuardConfig(
      rateLimitPerWindow = sys.env.get("PIPELINE_RUN_RATE_LIMIT_PER_WINDOW").flatMap(_.toIntOption).getOrElse(DefaultRateLimitPerWindow),
      rateWindowSeconds = sys.env.get("PIPELINE_RUN_RATE_WINDOW_SECONDS").flatMap(_.toIntOption).getOrElse(DefaultRateWindowSeconds),
      maxConcurrent = sys.env.get("PIPELINE_RUN_MAX_CONCURRENT").flatMap(_.toIntOption).getOrElse(DefaultMaxConcurrent),
      concurrencyRetryAfterSeconds =
        sys.env.get("PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS").flatMap(_.toLongOption).getOrElse(DefaultConcurrencyRetryAfterSeconds),
      sourceFetchRateLimitPerWindow =
        sys.env.get("SOURCE_FETCH_RATE_LIMIT_PER_WINDOW").flatMap(_.toIntOption).getOrElse(DefaultSourceFetchRateLimitPerWindow),
      autoRunMaxRetries =
        sys.env.get("PIPELINE_RUN_AUTO_RUN_MAX_RETRIES").flatMap(_.toIntOption).filter(_ >= 0).getOrElse(DefaultAutoRunMaxRetries),
      staleRunAfterSeconds = parseStaleRunAfterSeconds(sys.env.get("PIPELINE_RUN_STALE_AFTER_SECONDS"))
    )
}
