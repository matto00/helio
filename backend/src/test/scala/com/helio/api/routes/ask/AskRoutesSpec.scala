package com.helio.api.routes.ask

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.infrastructure.ai.ClaudeModelCatalog
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ask.{AskAccess, AskScope}
import com.helio.services.pipelines.PipelineService
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.AskScript._
import com.helio.testsupport.{AskApiHarness, ScriptedTransport}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1745 routes: access (4.4), billing (4.5), contract (4.6 keys), through the real `ApiRoutes` wiring. */
class AskRoutesSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with AskApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem

  private var owner, stranger: String = _
  private var pid, board, publicDash: String = _
  private var rev: Output = _
  private var haikuApi, sonnetApi, opusApi, unconfiguredApi: Route = _

  override def beforeAll(): Unit = {
    super.beforeAll(); startHarness()
    owner = seedUser("owner"); stranger = seedUser("beta")
    pid = seedPipelineWithOutput(owner, "table")._1
    rev = addOutput(pid, owner, "Revenue", OutputKind.Table, regionSchema)
    seedRows(pid, Seq(regionRow("east", 10)))
    board = seedBoard(owner); seedBoardPanel(board, owner, rev.id.value)
    publicDash = seedBoard(owner); seedBoardPanel(publicDash, owner, rev.id.value); publicBoard(publicDash)
    haikuApi = buildAskApi(ClaudeModelCatalog.HaikuId); sonnetApi = buildAskApi(ClaudeModelCatalog.SonnetId)
    opusApi = buildAskApi(ClaudeModelCatalog.OpusId); unconfiguredApi = buildAskApi(ClaudeModelCatalog.HaikuId, configured = false)
  }

  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def script(steps: Step*): ScriptedTransport = { val t = new ScriptedTransport(steps.toVector); switch.current = t; t }
  private val plain: Step = _ => Seq(text("There is nothing to report."))

  private def post(api: Route, path: String, user: Option[String], body: String = """{"question":"What is the amount?"}""")(assertions: => Unit): Unit = {
    val req = HttpRequest(HttpMethods.POST, path, entity = HttpEntity(ContentTypes.`application/json`, body))
    user.fold(req)(askAuthed(req, _)) ~> api ~> check(assertions)
  }

  private def betaViewer(): String = { val u = seedUser("beta"); grantBoard(board, u, "viewer"); u }

  private def keysAnywhere(v: JsValue): Set[String] = v match {
    case JsObject(f) => f.keySet ++ f.values.flatMap(keysAnywhere)
    case JsArray(e)  => e.flatMap(keysAnywhere).toSet
    case _           => Set.empty
  }

  "access (4.4)" should {
    "reject an unauthenticated caller with 401 and no model call" in {
      val t = script(plain)
      post(haikuApi, s"/api/dashboards/$board/ask", None)(status shouldBe StatusCodes.Unauthorized)
      post(haikuApi, s"/api/outputs/${rev.id.value}/ask", None)(status shouldBe StatusCodes.Unauthorized)
      t.hopCount shouldBe 0
    }

    "give 404, no model call and no charge to every stranger shape" in {
      val t = script(plain)
      post(haikuApi, s"/api/dashboards/$board/ask", Some(stranger))(status shouldBe StatusCodes.NotFound)
      post(haikuApi, s"/api/dashboards/$publicDash/ask", Some(stranger))(status shouldBe StatusCodes.NotFound)
      post(haikuApi, s"/api/dashboards/$publicDash/ask?token=abc", Some(stranger))(status shouldBe StatusCodes.NotFound)
      post(haikuApi, s"/api/outputs/${rev.id.value}/ask", Some(stranger))(status shouldBe StatusCodes.NotFound)
      post(haikuApi, s"/api/outputs/no-such-output/ask", Some(stranger))(status shouldBe StatusCodes.NotFound)
      t.hopCount shouldBe 0
      usageToday(stranger) shouldBe 0
    }

    "hold the Output gate when row-level security is bypassed (dev and CI shape)" in {
      implicit val ec: ExecutionContext = harnessEc
      val superCtx = new DbContext(db, db)
      val ds       = new DataSourceRepository(superCtx)
      val pipes    = new PipelineRepository(superCtx, ds)
      val outs     = new OutputRepository(superCtx)
      val access   = new AskAccess(accessChecker, outs, new PipelineService(pipes, stepRepo, ds, outputRepo = outs), new PanelRepository(superCtx))
      awaitDb(access.gate(AskScope.OutputScope(rev.id.value), authUser(stranger))).isLeft shouldBe true
      awaitDb(access.gate(AskScope.OutputScope(rev.id.value), authUser(owner))).isRight shouldBe true
    }

    "degrade to 503 without a model client" in {
      post(unconfiguredApi, s"/api/dashboards/$board/ask", Some(owner))(status shouldBe StatusCodes.ServiceUnavailable)
    }
  }

  "billing (4.5)" should {
    "refuse a free-tier grantee with 403 TIER_FORBIDDEN and no model call" in {
      val free = seedUser("free"); grantBoard(board, free, "viewer")
      val t    = script(plain)
      post(haikuApi, s"/api/dashboards/$board/ask", Some(free)) {
        status shouldBe StatusCodes.Forbidden
        responseAs[JsObject].fields("code") shouldBe JsString("TIER_FORBIDDEN")
      }
      t.hopCount shouldBe 0
    }

    "charge a beta user the server default model's catalog weight, and an owner nothing" in {
      Seq((haikuApi, 1), (sonnetApi, 4), (opusApi, 8)).foreach { case (api, weight) =>
        val u = betaViewer(); script(plain)
        post(api, s"/api/dashboards/$board/ask", Some(u))(status shouldBe StatusCodes.OK)
        usageToday(u) shouldBe weight
      }
      script(plain)
      post(opusApi, s"/api/dashboards/$board/ask", Some(owner))(status shouldBe StatusCodes.OK)
      usageToday(owner) shouldBe 0
    }

    "not charge the corrective retry again" in {
      val u = betaViewer(); val t = script(_ => Seq(text("It fell 99 percent.")), plain)
      post(sonnetApi, s"/api/dashboards/$board/ask", Some(u))(status shouldBe StatusCodes.OK)
      t.hopCount shouldBe 2
      usageToday(u) shouldBe 4
    }

    "reject an empty question with 400, no model call and no charge" in {
      val u = betaViewer(); val t = script(plain)
      post(haikuApi, s"/api/dashboards/$board/ask", Some(u), """{"question":"   "}""")(status shouldBe StatusCodes.BadRequest)
      post(haikuApi, s"/api/dashboards/$board/ask", Some(u), s"""{"question":"${"x" * 2001}"}""")(status shouldBe StatusCodes.BadRequest)
      t.hopCount shouldBe 0
      usageToday(u) shouldBe 0
    }
  }

  "the contract (4.6)" should {
    "answer with exactly answer, citations, citedOutputs and an explicit null pin, and never a model, usage or cost key" in {
      val u = betaViewer(); script(plain)
      post(haikuApi, s"/api/dashboards/$board/ask", Some(u)) {
        status shouldBe StatusCodes.OK
        val body = responseAs[String].parseJson
        body.asJsObject.fields.keySet shouldBe Set("answer", "citations", "citedOutputs", "pin")
        body.asJsObject.fields("pin") shouldBe JsNull
        keysAnywhere(body) should contain noneOf ("model", "usage", "inputTokens", "outputTokens", "costMicros")
      }
    }

    "answer an Output ask for a pipeline grantee" in {
      script(plain)
      post(haikuApi, s"/api/outputs/${rev.id.value}/ask", Some(owner))(status shouldBe StatusCodes.OK)
    }

    "return 422 ASK_UNGROUNDED with no answer text after two failures" in {
      script(_ => Seq(text("It fell 99 percent.")))
      post(haikuApi, s"/api/dashboards/$board/ask", Some(owner)) {
        status shouldBe StatusCodes.UnprocessableEntity
        val body = responseAs[JsObject]
        body.fields("code") shouldBe JsString("ASK_UNGROUNDED")
        responseAs[String] should not include "fell"
      }
    }
  }
}
