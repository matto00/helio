package com.helio.services.home

import com.helio.domain.model.ScheduleKind

import java.time.{Duration, Instant}

/** HEL-1578: bounds and thresholds of the Home summary, in one place (design D2). */
object HomeSummaryLimits {
  val WindowHours: Long             = 24L
  val HorizonHours: Long            = 6L
  val MaxPipelines: Int             = 8
  val MaxRunsPerPipeline: Int       = 150
  val MaxUpcoming: Int              = 24
  val UpNext: Int                   = 5
  val StuckAfter: Duration          = Duration.ofMinutes(15)
  val MissedAfter: Duration         = Duration.ofMinutes(10)
  val ErrorLogMax: Int              = 500
  val MaxDashboardChangeIds: Int    = 20
}

/** One real (non-dry) run row as read for the summary (error log already truncated to `ErrorLogMax`). */
final case class HomeRunRow(
    runId: String,
    pipelineId: String,
    pipelineName: String,
    status: String,
    startedAt: Instant,
    completedAt: Option[Instant],
    triggerSource: String,
    rowCount: Option[Int],
    errorLog: Option[String]
)

/** One enabled schedule of an owned pipeline. */
final case class HomeScheduleRow(
    pipelineId: String,
    pipelineName: String,
    kind: ScheduleKind,
    expression: String,
    timezone: String,
    nextRunAt: Option[Instant]
)

final case class HomeSummaryRows(runs: Vector[HomeRunRow], schedules: Vector[HomeScheduleRow])

final case class HomeRunItem(
    runId: String,
    status: String,
    startedAt: Instant,
    completedAt: Option[Instant],
    triggerSource: String,
    rowCount: Option[Int],
    errorLog: Option[String]
)

final case class HomePipelineItem(
    pipelineId: String,
    name: String,
    runs: Vector[HomeRunItem],
    runsOmitted: Int,
    upcoming: Vector[Instant]
)

/** `kind` is `failed`, `stuck` or `missed`; `runId` is empty for `missed`. */
final case class HomeAttentionItem(
    kind: String,
    pipelineId: String,
    pipelineName: String,
    runId: Option[String],
    at: Instant,
    reason: Option[String],
    resolvedAt: Option[Instant],
    inFlight: Boolean
)

final case class HomeUpNextItem(pipelineId: String, pipelineName: String, at: Instant)

final case class HomeDashboardChange(dashboardId: String, contentUpdatedAt: Option[Instant], dataUpdatedAt: Option[Instant])

final case class HomeSummary(
    serverNow: Instant,
    windowStart: Instant,
    horizonEnd: Instant,
    pipelines: Vector[HomePipelineItem],
    pipelinesWithActivity: Int,
    attention: Vector[HomeAttentionItem],
    upNext: Vector[HomeUpNextItem],
    dashboardChanges: Vector[HomeDashboardChange]
)
