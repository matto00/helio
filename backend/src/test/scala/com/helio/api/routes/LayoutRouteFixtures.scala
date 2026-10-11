package com.helio.api.routes

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import spray.json._

/** Route-level fixtures shared by the HEL-1456 layout-strip specs: authenticated requests, dashboard/panel/pipeline
 *  creation over the real route tree, and the stored-layout readers. Mixed into the spec classes (the concurrency
 *  spec stays its own class for its own rate-limit bucket) so the helpers exist once. */
trait LayoutRouteFixtures { this: ApplyProposalSpecBase =>

  protected val Bps = Vector("lg", "md", "sm", "xs")

  protected def send[T](req: HttpRequest)(f: => T): T =
    req.addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check(f)

  protected def createDashboard(name: String): String =
    send(Post("/api/dashboards", json(s"""{"name":"$name"}"""))) {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  protected def createPanel(dashboardId: String, kind: String = "text", outputId: Option[String] = None): String = {
    val config = outputId.fold("")(o => s""","config":{"outputId":"$o"}""")
    send(Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"p","type":"$kind"$config}"""))) {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }
  }

  protected def deleteOk(path: String): Unit = send(Delete(path)) { status.isSuccess shouldBe true }

  protected def itemsOf(dashboardId: String, bp: String): Vector[JsObject] =
    storedLayoutJson(dashboardId).fields(bp).convertTo[Vector[JsObject]]

  protected def idsOf(dashboardId: String, bp: String): Vector[String] = itemsOf(dashboardId, bp).map(_.fields("panelId").convertTo[String])

  protected case class PipelineFixture(pipelineId: String, outputId: String, stepId: Option[String])

  /** The `id`s of a list body, whether a bare array or `{items: [...]}`. */
  private def listIds(body: JsValue): Vector[String] = {
    val arr = body match { case JsArray(xs) => xs; case o: JsObject => o.fields("items").convertTo[Vector[JsValue]]; case _ => Vector.empty }
    arr.map(_.asJsObject.fields("id").convertTo[String])
  }

  protected def outputIds(pipelineId: String): Vector[String] =
    send(Get(s"/api/pipelines/$pipelineId/outputs")) {
      status shouldBe StatusCodes.OK
      listIds(responseAs[String].parseJson)
    }

  protected def createPipeline(name: String, withStep: Boolean): PipelineFixture = {
    val step = if (withStep) s""","steps":[{"clientId":"s1","type":"rename","config":{"renames":{"a":"b"}}}]""" else ""
    val out  = if (withStep) """{"nodeStepClientId":"s1","kind":"table","name":"o"}""" else """{"kind":"table","name":"o"}"""
    val body = s"""{"name":"$name","roots":[{"type":"static","name":"$name-src","staticConfig":{"columns":[{"name":"a","type":"string"}],"rows":[["x"]]}}]$step,"outputs":[$out]}"""
    val pipelineId = send(Post("/api/pipelines", json(body))) {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }
    val stepId =
      if (withStep) Some(send(Get(s"/api/pipelines/$pipelineId/steps")) {
        status shouldBe StatusCodes.OK
        listIds(responseAs[String].parseJson).head
      })
      else None
    PipelineFixture(pipelineId, outputIds(pipelineId).head, stepId)
  }
}
