package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines._
import com.helio.api.routes.pipelines.OutputRoutes
import com.helio.domain.model._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.OutputHistoryApiHarness
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1311: `heatmap` and `histogram` are accepted chart types on the Output write routes, never
 *  carry an `aggregation`, and `chartOptions.histogram.binCount` is validated (whole number 2-100). */
class OutputHeatmapHistogramSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String = _
  private def owner           = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = { super.beforeAll(); startHarness(); ownerId = seedUser() }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }

  private def routes(): Route = new OutputRoutes(outputService, owner, Some(historyService))(harnessEc).routes
  private def storedConfig(oid: String): JsObject = awaitDb(outputRepo.findConfigsByIdsInternal(Vector(oid)))(oid)
  private def s(v: String): JsString = JsString(v)
  private def seed(pid: String, config: JsObject): String =
    awaitDb(outputRepo.insertInternal(PipelineId(pid), None, owner.id, "seeded", OutputKind.Chart, config, explicitRootId = None)).id.value

  private val chartAgg = JsObject("groupBy" -> s("region"), "agg" -> s("sum"), "yField" -> s("amount"))
  private def hist(binCount: JsValue): JsObject =
    JsObject("chartType" -> s("histogram"), "chartOptions" -> JsObject("histogram" -> JsObject("binCount" -> binCount)))

  "POST /pipelines/:id/outputs" should {
    "201 a heatmap and a histogram Output, storing the chartType" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      Seq("heatmap", "histogram").foreach { t =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "chart", t, Some(JsObject("chartType" -> s(t), "aggregation" -> JsNull)))) ~> routes() ~> check {
          status shouldBe StatusCodes.Created
          responseAs[OutputResponse].config.asJsObject.fields("chartType") shouldBe s(t)
        }
      }
    }

    "400 an aggregation on a heatmap or histogram, naming aggregation and the chart type" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      Seq("heatmap", "histogram").foreach { t =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "chart", t, Some(JsObject("chartType" -> s(t), "aggregation" -> chartAgg)))) ~> routes() ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should (include("aggregation") and include(t))
        }
      }
    }

    "400 a histogram binCount of 1, 101, 2.5 or a string; accept 2, 100 and null" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      def post(cfg: JsObject) = Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "chart", "h", Some(cfg))) ~> routes()
      Seq[JsValue](JsNumber(1), JsNumber(101), JsNumber(2.5), s("10")).foreach { bad =>
        post(hist(bad)) ~> check { status shouldBe StatusCodes.BadRequest; responseAs[String] should include("binCount") }
      }
      Seq[JsValue](JsNumber(2), JsNumber(100), JsNull).foreach { good =>
        post(hist(good)) ~> check { status shouldBe StatusCodes.Created }
      }
    }
  }

  "PATCH /outputs/:id" should {
    "400 patching a stored aggregated bar chart to histogram, leaving it unchanged" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val oid      = seed(pid, JsObject("chartType" -> s("bar"), "aggregation" -> chartAgg))
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("chartType" -> s("histogram"))))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("aggregation")
      }
      storedConfig(oid).fields("chartType") shouldBe s("bar")
    }

    "judge binCount only when it differs from the stored value" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val oid      = seed(pid, hist(JsNumber(1000)))
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("compare" -> s("7d"))))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(hist(JsNumber(1))))) ~> routes() ~> check { status shouldBe StatusCodes.BadRequest }
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(hist(JsNumber(12))))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
    }
  }
}
