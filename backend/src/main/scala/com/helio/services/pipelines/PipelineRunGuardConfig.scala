package com.helio.services.pipelines

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
    sourceFetchRateLimitPerWindow: Int
)

object PipelineRunGuardConfig {
  val DefaultRateLimitPerWindow: Int           = 10
  val DefaultRateWindowSeconds: Int            = 60
  val DefaultMaxConcurrent: Int                = 3
  val DefaultConcurrencyRetryAfterSeconds: Long = 15
  val DefaultSourceFetchRateLimitPerWindow: Int = 30

  /** Reads `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW`, `PIPELINE_RUN_RATE_WINDOW_SECONDS`,
   *  `PIPELINE_RUN_MAX_CONCURRENT`, `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS`, and
   *  `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW` (all falling back to their documented conservative
   *  defaults when unset or non-numeric). */
  def fromEnv(): PipelineRunGuardConfig =
    PipelineRunGuardConfig(
      rateLimitPerWindow = sys.env.get("PIPELINE_RUN_RATE_LIMIT_PER_WINDOW").flatMap(_.toIntOption).getOrElse(DefaultRateLimitPerWindow),
      rateWindowSeconds = sys.env.get("PIPELINE_RUN_RATE_WINDOW_SECONDS").flatMap(_.toIntOption).getOrElse(DefaultRateWindowSeconds),
      maxConcurrent = sys.env.get("PIPELINE_RUN_MAX_CONCURRENT").flatMap(_.toIntOption).getOrElse(DefaultMaxConcurrent),
      concurrencyRetryAfterSeconds =
        sys.env.get("PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS").flatMap(_.toLongOption).getOrElse(DefaultConcurrencyRetryAfterSeconds),
      sourceFetchRateLimitPerWindow =
        sys.env.get("SOURCE_FETCH_RATE_LIMIT_PER_WINDOW").flatMap(_.toIntOption).getOrElse(DefaultSourceFetchRateLimitPerWindow)
    )
}
