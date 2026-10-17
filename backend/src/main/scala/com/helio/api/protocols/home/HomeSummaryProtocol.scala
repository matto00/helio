package com.helio.api.protocols.home

import com.helio.services.home._
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

import java.time.Instant

final case class HomeRunResponse(
    runId: String,
    status: String,
    startedAt: String,
    completedAt: Option[String],
    triggerSource: String,
    rowCount: Option[Int],
    errorLog: Option[String]
)

final case class HomePipelineResponse(
    pipelineId: String,
    name: String,
    runs: Vector[HomeRunResponse],
    runsOmitted: Int,
    upcoming: Vector[String]
)

final case class HomeAttentionResponse(
    kind: String,
    pipelineId: String,
    pipelineName: String,
    runId: Option[String],
    at: String,
    reason: Option[String],
    resolvedAt: Option[String],
    inFlight: Boolean
)

final case class HomeUpNextResponse(pipelineId: String, pipelineName: String, at: String)

final case class HomeDashboardChangeResponse(dashboardId: String, contentUpdatedAt: Option[String], dataUpdatedAt: Option[String])

/** `GET /api/home-summary` (HEL-1578). Contract: schemas/home/home-summary-response.schema.json. */
final case class HomeSummaryResponse(
    serverNow: String,
    windowStart: String,
    horizonEnd: String,
    pipelines: Vector[HomePipelineResponse],
    pipelinesWithActivity: Int,
    attention: Vector[HomeAttentionResponse],
    upNext: Vector[HomeUpNextResponse],
    dashboardChanges: Vector[HomeDashboardChangeResponse]
)

object HomeSummaryResponse {
  private def iso(i: Instant): String = i.toString

  def fromDomain(s: HomeSummary): HomeSummaryResponse =
    HomeSummaryResponse(
      iso(s.serverNow), iso(s.windowStart), iso(s.horizonEnd),
      s.pipelines.map(p =>
        HomePipelineResponse(
          p.pipelineId, p.name,
          p.runs.map(r => HomeRunResponse(r.runId, r.status, iso(r.startedAt), r.completedAt.map(iso), r.triggerSource, r.rowCount, r.errorLog)),
          p.runsOmitted, p.upcoming.map(iso)
        )
      ),
      s.pipelinesWithActivity,
      s.attention.map(a => HomeAttentionResponse(a.kind, a.pipelineId, a.pipelineName, a.runId, iso(a.at), a.reason, a.resolvedAt.map(iso), a.inFlight)),
      s.upNext.map(u => HomeUpNextResponse(u.pipelineId, u.pipelineName, iso(u.at))),
      s.dashboardChanges.map(c => HomeDashboardChangeResponse(c.dashboardId, c.contentUpdatedAt.map(iso), c.dataUpdatedAt.map(iso)))
    )
}

trait HomeSummaryProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Write-only: every nullable field is an explicit JSON `null` (the contract lists them as required), which spray's
   *  default `jsonFormatN` would omit for `None`. Global `NullOptions` is deliberately NOT mixed in. */
  private def writeOnly[T](w: T => JsValue): RootJsonFormat[T] = new RootJsonFormat[T] {
    def write(t: T): JsValue = w(t)
    def read(json: JsValue): T = deserializationError("home summary responses are write-only")
  }

  private def str(v: Option[String]): JsValue = v.fold[JsValue](JsNull)(JsString(_))
  private def num(v: Option[Int]): JsValue    = v.fold[JsValue](JsNull)(JsNumber(_))

  private val runJs: HomeRunResponse => JsValue = r =>
    JsObject(
      "runId" -> JsString(r.runId), "status" -> JsString(r.status), "startedAt" -> JsString(r.startedAt),
      "completedAt" -> str(r.completedAt), "triggerSource" -> JsString(r.triggerSource),
      "rowCount" -> num(r.rowCount), "errorLog" -> str(r.errorLog)
    )

  private val pipelineJs: HomePipelineResponse => JsValue = p =>
    JsObject(
      "pipelineId" -> JsString(p.pipelineId), "name" -> JsString(p.name), "runs" -> JsArray(p.runs.map(runJs)),
      "runsOmitted" -> JsNumber(p.runsOmitted), "upcoming" -> JsArray(p.upcoming.map(JsString(_)))
    )

  private val attentionJs: HomeAttentionResponse => JsValue = a =>
    JsObject(
      "kind" -> JsString(a.kind), "pipelineId" -> JsString(a.pipelineId), "pipelineName" -> JsString(a.pipelineName),
      "runId" -> str(a.runId), "at" -> JsString(a.at), "reason" -> str(a.reason), "resolvedAt" -> str(a.resolvedAt),
      "inFlight" -> JsBoolean(a.inFlight)
    )

  implicit val homeSummaryResponseFormat: RootJsonFormat[HomeSummaryResponse] = writeOnly { r =>
    JsObject(
      "serverNow" -> JsString(r.serverNow), "windowStart" -> JsString(r.windowStart), "horizonEnd" -> JsString(r.horizonEnd),
      "pipelines" -> JsArray(r.pipelines.map(pipelineJs)),
      "pipelinesWithActivity" -> JsNumber(r.pipelinesWithActivity),
      "attention" -> JsArray(r.attention.map(attentionJs)),
      "upNext" -> JsArray(r.upNext.map(u => JsObject("pipelineId" -> JsString(u.pipelineId), "pipelineName" -> JsString(u.pipelineName), "at" -> JsString(u.at)))),
      "dashboardChanges" -> JsArray(r.dashboardChanges.map(c =>
        JsObject("dashboardId" -> JsString(c.dashboardId), "contentUpdatedAt" -> str(c.contentUpdatedAt), "dataUpdatedAt" -> str(c.dataUpdatedAt))
      ))
    )
  }
}
