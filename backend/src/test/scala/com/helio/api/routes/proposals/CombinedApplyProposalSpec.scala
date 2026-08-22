package com.helio.api.routes.proposals

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** Happy-path route-level coverage for `POST /api/proposals/apply` (HEL-387)
 *  under real RLS — mirrors `PipelineApplyProposalSpec`/`DashboardApplyProposalSpec`'s
 *  structure. Dangling-ref rejection cases live in
 *  `CombinedApplyProposalDanglingRefSpec`; rollback/short-circuit cases live
 *  in `CombinedApplyProposalRollbackSpec`; standalone-path regression lives
 *  in `CombinedApplyProposalRegressionSpec` — split out to keep every file
 *  under the ~250-line soft budget. */
class CombinedApplyProposalSpec extends CombinedApplyProposalSpecBase {

  "POST /api/proposals/apply" should {

    "atomically create source+pipeline+run+dashboard+panels, binding the panel to the new output type" in {
      val beforeSources    = dataSourceCount()
      val beforePipelines  = pipelineCount()
      val beforeTypes      = dataTypeCount()
      val beforeDashboards = dashboardCount()
      val beforePanels     = panelCount()
      val body =
        """{
          |  "pipeline": {
          |    "pipelineName": "Combined Pipeline",
          |    "source": {"type":"static","name":"Combined Static",
          |      "config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"],["y"]]}},
          |    "outputDataTypeName": "Combined Output",
          |    "steps": []
          |  },
          |  "dashboard": {
          |    "dashboardName": "Combined Dashboard",
          |    "panels": [
          |      {"title":"Total","type":"metric","dataTypeId":"$pipelineOutput","fieldMapping":{"value":"name"}}
          |    ]
          |  }
          |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj           = responseAs[String].parseJson.asJsObject
        val pipelineResp  = obj.fields("pipeline").asJsObject
        val outputTypeId  = pipelineResp.fields("outputDataTypeId").convertTo[String]
        outputTypeId should not be empty
        pipelineResp.fields("run").asJsObject.fields("rowCount").convertTo[Int] shouldBe 2

        val dashboardResp = obj.fields("dashboard").asJsObject
        dashboardResp.fields("dashboard").asJsObject.fields("name").convertTo[String] shouldBe "Combined Dashboard"
        val panels = dashboardResp.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val metric = panels.find(_.fields("title").convertTo[String] == "Total").get
        metric.fields("config").asJsObject.fields("dataTypeId").convertTo[String] shouldBe outputTypeId
      }
      dataSourceCount()    shouldBe (beforeSources + 1)
      pipelineCount()      shouldBe (beforePipelines + 1)
      // Static source's companion DataType + the pipeline's own output DataType.
      dataTypeCount()      shouldBe (beforeTypes + 2)
      dashboardCount()     shouldBe (beforeDashboards + 1)
      panelCount()         shouldBe (beforePanels + 1)
    }

    "create both panels correctly for a mixed sentinel + pre-existing-type binding" in {
      val body =
        s"""{
           |  "pipeline": {
           |    "pipelineName": "Mixed Pipeline",
           |    "source": {"type":"static","name":"Mixed Static",
           |      "config":{"columns":[{"name":"name","type":"string"}],"rows":[["x"]]}},
           |    "outputDataTypeName": "Mixed Output",
           |    "steps": []
           |  },
           |  "dashboard": {
           |    "dashboardName": "Mixed Dashboard",
           |    "panels": [
           |      {"title":"New","type":"metric","dataTypeId":"$$pipelineOutput","fieldMapping":{"value":"name"}},
           |      {"title":"Existing","type":"metric","dataTypeId":"$pipelineOutputTypeId","fieldMapping":{"value":"region"}}
           |    ]
           |  }
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj          = responseAs[String].parseJson.asJsObject
        val outputTypeId = obj.fields("pipeline").asJsObject.fields("outputDataTypeId").convertTo[String]
        val panels       = obj.fields("dashboard").asJsObject.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        panels.find(_.fields("title").convertTo[String] == "New").get
          .fields("config").asJsObject.fields("dataTypeId").convertTo[String] shouldBe outputTypeId
        panels.find(_.fields("title").convertTo[String] == "Existing").get
          .fields("config").asJsObject.fields("dataTypeId").convertTo[String] shouldBe pipelineOutputTypeId
      }
    }

    "require authentication" in {
      Post("/api/proposals/apply", json("""{"pipeline":{"pipelineName":"P","source":{"sourceId":"x"},
        |"outputDataTypeName":"O","steps":[]},"dashboard":{"dashboardName":"D","panels":[]}}""".stripMargin)) ~>
        routes ~> check {
          status shouldBe StatusCodes.Unauthorized
        }
    }
  }
}
