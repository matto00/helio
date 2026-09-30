package com.helio.services.telemetry

/** Env-sourced configuration for first-party product telemetry (HEL-1208). Read once via
 *  [[ProductTelemetryConfig.fromEnv]] and injected explicitly, mirroring `PipelineRunGuardConfig`;
 *  specs construct their own values directly.
 *
 *  `retentionDays` (default 90) is a driver default, not an owner ruling. */
final case class ProductTelemetryConfig(rateLimitPerWindow: Int, retentionDays: Int)

object ProductTelemetryConfig {
  val DefaultRateLimitPerWindow: Int = 60
  val DefaultRetentionDays: Int      = 90

  def fromEnv(): ProductTelemetryConfig =
    ProductTelemetryConfig(
      rateLimitPerWindow = sys.env.get("PRODUCT_EVENTS_RATE_LIMIT_PER_WINDOW").flatMap(_.toIntOption).getOrElse(DefaultRateLimitPerWindow),
      retentionDays      = sys.env.get("PRODUCT_EVENTS_RETENTION_DAYS").flatMap(_.toIntOption).filter(_ >= 1).getOrElse(DefaultRetentionDays)
    )
}
