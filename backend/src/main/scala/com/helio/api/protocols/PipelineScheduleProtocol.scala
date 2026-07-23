package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── PipelineSchedule API types ───────────────────────────────────────────────

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
}
