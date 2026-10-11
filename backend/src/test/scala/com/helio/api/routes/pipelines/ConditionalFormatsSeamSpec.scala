package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.OutputHistoryApiHarness
import com.helio.domain.model._
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}
import scala.concurrent.ExecutionContext

/** HEL-1307 seam test, backend half (C2). `shared-test-fixtures/conditional-formats-config.json` holds the exact
 *  `conditionalFormats` configs the Output editor writes. Here the SAME objects must be accepted by the real
 *  Output create and PATCH routes and read back identical; every invalid case must be a 400 naming the
 *  fragment, persisting nothing. The frontend half drives the real editor and compares its PATCH body. */
class ConditionalFormatsSeamSpec
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

  private val fixture = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/conditional-formats-config.json"))).asJsObject
  private def cases(key: String): Vector[JsObject] = fixture.fields(key).asInstanceOf[JsArray].elements.map(_.asJsObject)
  private def str(o: JsObject, k: String): String = o.fields(k).convertTo[String]

  "the shared fixture's valid cases" should {
    "be accepted by Output create and PATCH and read back identical (nulls preserved)" in {
      val (pid, oid) = seedMetricOutput(ownerId, None)
      cases("valid").foreach { c =>
        val kind   = str(c, "kind")
        val config = c.fields("config").asJsObject
        withClue(str(c, "name") + " create: ") {
          Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, kind, str(c, "name"), Some(config))) ~> routes() ~> check {
            status shouldBe StatusCodes.Created
            val created = responseAs[OutputResponse]
            created.config.asJsObject.fields("conditionalFormats") shouldBe config.fields("conditionalFormats")
            Get(s"/outputs/${created.id}") ~> routes() ~> check {
              responseAs[OutputResponse].config.asJsObject.fields("conditionalFormats") shouldBe config.fields("conditionalFormats")
            }
          }
        }
        if (kind == "metric") withClue(str(c, "name") + " patch: ") {
          Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(config))) ~> routes() ~> check {
            status shouldBe StatusCodes.OK
            responseAs[OutputResponse].config.asJsObject.fields("conditionalFormats") shouldBe config.fields("conditionalFormats")
          }
        }
      }
    }
  }

  "the shared fixture's invalid cases" should {
    "each be a 400 with the fragment on Output create, persisting nothing" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val before   = awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size
      cases("invalid").foreach { c =>
        withClue(str(c, "name") + ": ") {
          Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, str(c, "kind"), "bad", Some(c.fields("config").asJsObject))) ~> routes() ~> check {
            status shouldBe StatusCodes.BadRequest
            responseAs[String] should include(str(c, "fragment"))
          }
        }
      }
      awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size shouldBe before
    }
  }
}
