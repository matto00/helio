package com.helio.services.ask

import com.helio.api.JsonProtocols
import com.helio.api.protocols.ask.AskQuestionResponse
import com.helio.domain.model._
import com.helio.infrastructure.ai.{ClaudeApiTool, ClaudeApiToolRequest}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.AskScript._
import com.helio.testsupport.{AskApiHarness, ScriptedTransport}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.ExecutionContext

/** HEL-1781 D4, a GUARD (the server was already correct), not a red-first case: a dashboard-only grantee's ask reads rows
 *  and history through the scope re-check under a role that does NOT bypass row-level security, is never offered or served
 *  the payload tool, and (with a cited answer, so the pin builder really runs) gets no pin while the owner does. Mutation
 *  evidence (persisted transcripts): offering `get_history_rows` unconditionally turns the no-payload-tool case red (RLS-A);
 *  `AskPinBuilder` pinning on any access turns the no-pin case red (RLS-C); the payload-refusal case goes red only when BOTH
 *  the executor's pipeline-grant check and the RLS-scoped `outputRepo.findById` in `OutputHistoryService.payloadRows` are
 *  removed (RLS-D) -- removing the grant check alone leaves it green (RLS-B), because that lookup is the second guard.
 *  The pin guard is also proven in `AskSeamSpec`. It uses `AskApiHarness`'s non-bypass app pool role (not
 *  `TwoUserRlsApiFixture`), asserted first so the proof is not vacuous. */
class AskGranteeRlsSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with AskApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem

  private var owner, viewer: String = _
  private var pid, board: String    = _
  private var rev, hist: Output     = _
  private var payloadPoint: String  = _

  override def beforeAll(): Unit = {
    super.beforeAll(); startHarness()
    owner = seedUser("owner"); viewer = seedUser("beta")
    pid = seedPipelineWithOutput(owner, "table")._1
    rev = addOutput(pid, owner, "Revenue", OutputKind.Table, regionSchema)
    hist = addOutput(pid, owner, "Daily revenue", OutputKind.Metric)
    seedRows(pid, Seq(regionRow("east", 10), regionRow("west", 30)))
    addDailyPoints(hist.id.value, pid, Instant.parse("2026-11-01T00:00:00Z"), Seq(100.0, 110.0))
    payloadPoint = seedPayloadPoint(hist.id.value, pid, Instant.parse("2026-12-31T00:00:00Z"), """[{"region":"PAYLOAD-ROW","amount":7}]""")
    board = seedBoard(owner)
    Seq(rev, hist).foreach(o => seedBoardPanel(board, owner, o.id.value, s"${o.name} panel"))
    grantBoard(board, viewer, "viewer")
  }

  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def toolNames(r: ClaudeApiToolRequest): Set[String] =
    r.tools.collect { case t: ClaudeApiTool => t.name }.toSet

  private def askAs(user: String, steps: Vector[Step]): (Either[AskError, AskQuestionResponse], ScriptedTransport) = {
    val t = new ScriptedTransport(steps)
    (awaitDb(askService(t).ask(AskScope.DashboardScope(board), "How is revenue?", authUser(user))), t)
  }

  "[HEL-1781 RLS] a dashboard-only grantee's ask under a NOBYPASSRLS role" should {
    "run the app pool as a role that does not bypass row-level security" in {
      val role = awaitDb(appDb.run(sql"SELECT current_user".as[String].head))
      info(s"current_user = $role")
      appPoolBypassesRls() shouldBe false
      awaitDb(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
    }

    "read rows and history through the scope re-check, offer no payload tool and pin nothing" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      val (res, t) = askAs(viewer, Vector(
        _ => Seq(
          toolUse("l", "list_board_outputs", obj()),
          toolUse("r", "get_output_rows", obj("outputId" -> JsString(rev.id.value))),
          toolUse("h", "get_output_history", obj("outputId" -> JsString(hist.id.value)))
        ),
        r => {
          seen.set(lastResults(r))
          val res = lastResults(r).find(_._1 == "r").get._2
          val c   = citations(res).find(_.fields("field") == JsString("amount")).get
          Seq(text(s"An amount is ${c.fields("value")} [${c.fields("id").convertTo[String]}]."))
        }
      ))
      res.isRight shouldBe true
      res.toOption.get.citedOutputs.map(_.id) shouldBe Vector(rev.id.value)
      res.toOption.get.pin shouldBe None
      toolNames(t.requests.head) should not contain "get_history_rows"
      val byId = seen.get.map(r => r._1 -> r).toMap
      byId.keySet shouldBe Set("l", "r", "h")
      byId.values.foreach(_._3 shouldBe false)
      byId("l")._2 should include(rev.id.value)
      byId("r")._2 should include("east")
      byId("r")._2 should include("west")
      val h = byId("h")._2.parseJson.asJsObject
      h.fields.keySet should not contain "points"
      citations(byId("h")._2).filter(_.fields("field") == JsString("recent.value")).map(_.fields("value").convertTo[Double]).toSet shouldBe Set(100.0, 110.0)
    }

    "refuse a scripted get_history_rows call with a real point id and never read the payload row" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      val (res, _) = askAs(viewer, Vector(
        _ => Seq(toolUse("p", "get_history_rows", obj("outputId" -> JsString(hist.id.value), "pointId" -> JsString(payloadPoint)))),
        r => { seen.set(lastResults(r)); Seq(text("Nothing to add.")) }
      ))
      res.isRight shouldBe true
      seen.get.head._3 shouldBe true
      seen.get.head._2 should not include "PAYLOAD-ROW"
    }

    "offer the payload tool and a pin to the owner (positive control: the same cited answer)" in {
      val (res, t) = askAs(owner, Vector(
        _ => Seq(toolUse("r", "get_output_rows", obj("outputId" -> JsString(rev.id.value)))),
        r => {
          val c = citations(lastResults(r).head._2).find(_.fields("field") == JsString("amount")).get
          Seq(text(s"An amount is ${c.fields("value")} [${c.fields("id").convertTo[String]}]."))
        }
      ))
      toolNames(t.requests.head) should contain("get_history_rows")
      res.toOption.get.pin should not be None
    }
  }
}
