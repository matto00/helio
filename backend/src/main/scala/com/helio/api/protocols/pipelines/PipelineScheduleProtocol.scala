package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import spray.json._


final case class PipelineScheduleResponse(
    id: String,
    pipelineId: String,
    kind: String,
    expression: String,
    enabled: Boolean,
    timezone: String,
    nextRunAt: Option[String],
    lastRunAt: Option[String],
    createdAt: String,
    updatedAt: String
)

/** `PUT /api/pipelines/:id/schedule` body — `{ kind, expression, enabled?,
 *  timezone }`. `enabled` is the one field the ticket calls out as optional
 *  on the wire (spray-json omits `None`); `PipelineScheduleService`
 *  normalizes an absent value to `true`. */
final case class PutPipelineScheduleRequest(
    kind: String,
    expression: String,
    enabled: Option[Boolean],
    timezone: String
)

final case class ScheduledPipelineItemResponse(
    pipelineId: String,
    pipelineName: String,
    kind: String,
    expression: String,
    timezone: String,
    nextRunAt: Option[String],
    lastRunAt: Option[String]
)
final case class ScheduledSourceItemResponse(
    sourceId: String,
    sourceName: String,
    nextRunAt: Option[String],
    pipelineId: String,
    pipelineName: String
)
/** `GET /api/pipeline-schedules` (HEL-1574): the caller's enabled schedules and the sources feeding them. */
final case class PipelineScheduleListResponse(
    items: Vector[ScheduledPipelineItemResponse],
    sources: Vector[ScheduledSourceItemResponse]
)

object PipelineScheduleListResponse {
  def fromDomain(list: PipelineScheduleList): PipelineScheduleListResponse =
    PipelineScheduleListResponse(
      list.items.map(i =>
        ScheduledPipelineItemResponse(i.pipelineId, i.pipelineName, i.kind, i.expression, i.timezone, i.nextRunAt.map(_.toString), i.lastRunAt.map(_.toString))
      ),
      list.sources.map(s => ScheduledSourceItemResponse(s.sourceId, s.sourceName, s.nextRunAt.map(_.toString), s.pipelineId, s.pipelineName))
    )
}

object PipelineScheduleResponse {
  def fromDomain(schedule: PipelineSchedule): PipelineScheduleResponse =
    PipelineScheduleResponse(
      id         = schedule.id.value,
      pipelineId = schedule.pipelineId.value,
      kind       = ScheduleKind.asString(schedule.kind),
      expression = schedule.expression,
      enabled    = schedule.enabled,
      timezone   = schedule.timezone,
      nextRunAt  = schedule.nextRunAt.map(_.toString),
      lastRunAt  = schedule.lastRunAt.map(_.toString),
      createdAt  = schedule.createdAt.toString,
      updatedAt  = schedule.updatedAt.toString
    )
}

trait PipelineScheduleProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val pipelineScheduleResponseFormat: RootJsonFormat[PipelineScheduleResponse]     = jsonFormat10(PipelineScheduleResponse.apply)
  implicit val putPipelineScheduleRequestFormat: RootJsonFormat[PutPipelineScheduleRequest] = jsonFormat4(PutPipelineScheduleRequest.apply)
  implicit val scheduledPipelineItemResponseFormat: RootJsonFormat[ScheduledPipelineItemResponse] = jsonFormat7(ScheduledPipelineItemResponse.apply)
  implicit val scheduledSourceItemResponseFormat: RootJsonFormat[ScheduledSourceItemResponse]     = jsonFormat5(ScheduledSourceItemResponse.apply)
  implicit val pipelineScheduleListResponseFormat: RootJsonFormat[PipelineScheduleListResponse]   = jsonFormat2(PipelineScheduleListResponse.apply)
}
