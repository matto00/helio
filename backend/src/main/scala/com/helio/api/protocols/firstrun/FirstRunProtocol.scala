package com.helio.api.protocols.firstrun

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

final case class FirstRunDashboardRequest(sourceId: String)

/** Everything the client needs to land on the dashboard and, for beta/owner, to prefill the
 *  assistant draft naming what was built. */
final case class FirstRunDashboardResponse(
    dashboardId: String,
    dashboardName: String,
    panelCount: Int,
    pipelineId: String,
    pipelineName: String,
    sourceId: String,
    sourceName: String
)

trait FirstRunProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val firstRunDashboardRequestFormat: RootJsonFormat[FirstRunDashboardRequest] =
    jsonFormat1(FirstRunDashboardRequest.apply)
  implicit val firstRunDashboardResponseFormat: RootJsonFormat[FirstRunDashboardResponse] =
    jsonFormat7(FirstRunDashboardResponse.apply)
}
