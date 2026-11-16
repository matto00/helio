package com.helio.infrastructure.ai

import com.helio.testkit.HelioRouteTest
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1639 D5 (task 3.6): within ONE model response only the first call of the `oncePerResponseTools` runs; each later
 *  one gets an `isError` result telling the model a turn yields one proposal. A call in a LATER response runs normally.
 *  Scripted transport and executor only: no network, no model. */
class ClaudeClientOncePerResponseSpec extends AnyWordSpec with Matchers with HelioRouteTest {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  private val config = ClaudeConfig(apiKey = "sk-test", model = "claude-haiku-4-5-20251001", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000, webSearchMaxUses = 3)

  private def block(id: String, name: String): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(JsObject("n" -> JsString(id))))

  private def response(blocks: ClaudeApiContentBlock*): ClaudeApiResponse =
    ClaudeApiResponse("msg", blocks, Some("tool_use"), ClaudeApiUsage(10, 5))

  private val finalText = ClaudeApiResponse("msg", Seq(ClaudeApiContentBlock(blockType = "text", text = Some("done"))), Some("end_turn"), ClaudeApiUsage(8, 4))

  private class ScriptedTransport(responses: Vector[ClaudeApiResponse]) extends ClaudeTransport {
    private val calls = new AtomicInteger(0)
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = Future.failed(new UnsupportedOperationException)
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = Future.successful(responses(calls.getAndIncrement()))
  }

  /** Records executed calls; a `propose_*` whose id is in `failIds` answers an error (a rejected proposal). */
  private class RecordingExecutor(failIds: Set[String] = Set.empty) extends ClaudeToolExecutor {
    private val executed = new CopyOnWriteArrayList[String]()
    def ran: Vector[String] = executed.asScala.toVector
    override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
      val id = input.asJsObject.fields("n").convertTo[String]
      executed.add(id)
      Future.successful(if (failIds(id)) Left("rejected") else Right("ok"))
    }
  }

  private val proposeNames = Set("propose_dashboard", "propose_pipeline", "propose_combined", "propose_patch_set")
  private val tools = Seq(ClaudeTool("find", "d", JsObject()), ClaudeTool("propose_pipeline", "d", JsObject()))

  private def request(maxHops: Int = 4) =
    ClaudeToolRequest(Seq(ClaudeToolMessage.text(ClaudeRole.User, "go")), tools, maxHops, oncePerResponseTools = proposeNames)

  private def resultsOf(outcome: ClaudeToolOutcome): Vector[ClaudeContentBlock.ToolResult] = outcome match {
    case ClaudeToolOutcome.FinalResponse(_, history, _) =>
      history.flatMap(_.content).collect { case r: ClaudeContentBlock.ToolResult => r }.toVector
    case other => fail(s"expected FinalResponse, got $other")
  }

  "ClaudeClient.sendWithTools with oncePerResponseTools" should {

    "run only the first of four propose_pipeline calls in one response and reject the other three" in {
      val transport = new ScriptedTransport(Vector(response(block("a", "propose_pipeline"), block("b", "propose_pipeline"), block("c", "propose_pipeline"), block("d", "propose_pipeline")), finalText))
      val executor  = new RecordingExecutor
      val results   = resultsOf(await(new ClaudeClient(config, transport).sendWithTools(request(), executor)))

      executor.ran shouldBe Vector("a")
      results.map(_.toolUseId) shouldBe Vector("a", "b", "c", "d")
      results.map(_.isError) shouldBe Vector(false, true, true, true)
      results.drop(1).foreach { r =>
        r.content should include("only one propose_* call per response is evaluated")
        r.content should include("ONE proposal")
        r.content should include("single propose_patch_set call")
      }
    }

    "treat different propose tools in one response as sharing one slot, in block order, and never reject a find" in {
      val transport = new ScriptedTransport(Vector(response(block("f", "find"), block("p1", "propose_pipeline"), block("p2", "propose_patch_set")), finalText))
      val executor  = new RecordingExecutor
      val results   = resultsOf(await(new ClaudeClient(config, transport).sendWithTools(request(), executor)))

      executor.ran.toSet shouldBe Set("f", "p1")
      results.map(r => r.toolUseId -> r.isError) shouldBe Vector("f" -> false, "p1" -> false, "p2" -> true)
    }

    "run a corrected propose in the NEXT response after the first one failed" in {
      val transport = new ScriptedTransport(Vector(response(block("bad", "propose_pipeline")), response(block("good", "propose_pipeline")), finalText))
      val executor  = new RecordingExecutor(failIds = Set("bad"))
      val results   = resultsOf(await(new ClaudeClient(config, transport).sendWithTools(request(), executor)))

      executor.ran shouldBe Vector("bad", "good")
      results.map(r => r.toolUseId -> r.isError) shouldBe Vector("bad" -> true, "good" -> false)
    }

    "leave every call running when no tool is named (the default for every other caller)" in {
      val transport = new ScriptedTransport(Vector(response(block("a", "propose_pipeline"), block("b", "propose_pipeline")), finalText))
      val executor  = new RecordingExecutor
      val plain     = ClaudeToolRequest(Seq(ClaudeToolMessage.text(ClaudeRole.User, "go")), tools, maxHops = 4)
      resultsOf(await(new ClaudeClient(config, transport).sendWithTools(plain, executor))).map(_.isError) shouldBe Vector(false, false)
      executor.ran.toSet shouldBe Set("a", "b")
    }
  }
}
