package com.helio.domain.model

import java.time.Instant

/** HEL-1574: one enabled schedule on a pipeline the caller owns, with the pipeline's name. */
final case class ScheduledPipelineItem(
    pipelineId: String,
    pipelineName: String,
    kind: String,
    expression: String,
    timezone: String,
    nextRunAt: Option[Instant],
    lastRunAt: Option[Instant]
)

/** A data source that roots at least one scheduled pipeline, with the soonest run among those pipelines. */
final case class ScheduledSourceItem(
    sourceId: String,
    sourceName: String,
    nextRunAt: Option[Instant],
    pipelineId: String,
    pipelineName: String
)

final case class PipelineScheduleList(items: Vector[ScheduledPipelineItem], sources: Vector[ScheduledSourceItem])
