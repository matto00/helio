package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-321 timeline flat-binding coverage for
 *  `POST /api/dashboards/apply-proposal`: a timeline binds via flat fields
 *  alone (dataTypeId + {time,event}) and its sole display option `sort` is a
 *  flat field derived server-side into config.timelineOptions.sort (an explicit
 *  config still wins; an invalid sort is rejected atomically). Shares the
 *  fixture via ApplyProposalSpecBase. */
class DashboardApplyProposalTimelineSpec extends ApplyProposalSpecBase {

  "POST /api/dashboards/apply-proposal" should {

    // ── HEL-321: timeline flat-binding (dataTypeId + {time,event} + flat sort) ─
    // Parity with metric/collection: a timeline binds via flat fields alone,
    // and its sole display option `sort` is a flat field derived server-side
    // into config.timelineOptions.sort (an explicit config still wins).

    "apply a timeline panel bound via flat fields only, sort defaulting to asc (HEL-321)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Timeline Flat",
           |  "panels": [
           |    {"title":"Events","type":"timeline","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"time":"region","event":"region"}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Events").get
        val config = panel.fields("config").asJsObject
        config.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
        config.fields("fieldMapping").asJsObject.fields("time").convertTo[String] shouldBe "region"
        // No flat sort → config carries the default, resolving to "asc".
        val sort = config.fields
          .get("timelineOptions")
          .map(_.asJsObject.fields("sort").convertTo[String])
          .getOrElse("asc")
        sort shouldBe "asc"
      }
      dashboardCount() shouldBe (before + 1)
    }

    "derive config.timelineOptions.sort from a flat sort field (HEL-321)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Timeline Desc",
           |  "panels": [
           |    {"title":"Events","type":"timeline","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"time":"region","event":"region"},"sort":"desc"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Events").get
        val config = panel.fields("config").asJsObject
        config.fields("timelineOptions").asJsObject.fields("sort").convertTo[String] shouldBe "desc"
      }
      dashboardCount() shouldBe (before + 1)
    }

    "reject a timeline panel with an invalid flat sort and create nothing (HEL-321)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Timeline Bad",
           |  "panels": [
           |    {"title":"Events","type":"timeline","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"time":"region","event":"region"},"sort":"sideways"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include("sort")
      }
      dashboardCount() shouldBe before
    }

    "let an explicit config.timelineOptions.sort override the flat sort (HEL-321)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Timeline Override",
           |  "panels": [
           |    {"title":"Events","type":"timeline","dataTypeId":"$pipelineOutputTypeId",
           |     "fieldMapping":{"time":"region","event":"region"},"sort":"asc",
           |     "config":{"timelineOptions":{"sort":"desc"}}}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val panel  = panels.find(_.fields("title").convertTo[String] == "Events").get
        val config = panel.fields("config").asJsObject
        config.fields("timelineOptions").asJsObject.fields("sort").convertTo[String] shouldBe "desc"
      }
      dashboardCount() shouldBe (before + 1)
    }
  }
}
