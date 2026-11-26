package com.helio.api.routes.ask

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.services.ask.AskPinBuilder
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.AskApiHarness
import com.helio.infrastructure.ai.ClaudeModelCatalog
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1775 item 3: the ask pin's body for a step-less Output is sent to the REAL `POST /api/pipelines/:id/outputs` route, on a
 *  pipeline whose root has a fresh id (every root created since V98; only V98's backfilled roots share the pipeline's id). */
class AskPinRealRouteSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with AskApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem

  private var owner: String   = _
  private var pid, rootId: String = _
  private var rev: Output     = _
  private var askApi: Route   = _

  override def beforeAll(): Unit = {
    super.beforeAll(); startHarness()
    owner  = seedUser("owner")
    pid    = UUID.randomUUID().toString
    rootId = UUID.randomUUID().toString
    val src = UUID.randomUUID().toString
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($src, 'ds', 'dataset', '{}', ${owner}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rootId, $pid, $src, 0)"""
    )))
    rev = awaitDb(outputRepo.insertInternal(PipelineId(pid), None, UserId(owner), "Revenue", OutputKind.Table, JsObject.empty, regionSchema, explicitRootId = Some(PipelineRootId(rootId)), actor = AuthenticatedUser(UserId(owner))))
    askApi = buildAskApi(ClaudeModelCatalog.HaikuId)
  }

  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private lazy val pins = new AskPinBuilder(accessChecker)(harnessEc)

  private def pinBody(output: Output): JsValue =
    awaitDb(pins.build("Why is revenue what it is?", Vector(output), authUser(owner))).get.request

  private def create(body: JsValue): (Int, String) = {
    var out: (Int, String) = (0, "")
    val req = HttpRequest(HttpMethods.POST, s"/api/pipelines/$pid/outputs", entity = HttpEntity(ContentTypes.`application/json`, body.compactPrint))
    askAuthed(req, owner) ~> askApi ~> check { out = (status.intValue, responseAs[String]) }
    out
  }

  "the step-less pin body through POST /api/pipelines/:id/outputs" should {
    "create the insight on the Output's own root when the Output carries one" in {
      val body = pinBody(rev)
      body.asJsObject.fields("rootId") shouldBe JsString(rootId)
      val (code, raw) = create(body)
      withClue(raw)(code shouldBe StatusCodes.Created.intValue)
      raw.parseJson.asJsObject.fields("rootId") shouldBe JsString(rootId)
    }

    "create the insight on the pipeline's real root when the in-memory Output carries no root id (no guessed pipeline id)" in {
      val body = pinBody(rev.copy(node = NodeRef(PipelineId(pid), None, None)))
      val (code, raw) = create(body)
      withClue(s"body=${body.compactPrint} response=$raw: ")(code shouldBe StatusCodes.Created.intValue)
      raw.parseJson.asJsObject.fields("rootId") shouldBe JsString(rootId)
    }
  }
}
