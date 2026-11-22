package com.helio.infrastructure.ai

import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import spray.json._

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** Fixtures shared by the `ClaudeClient` specs (`ClaudeClientSpec` and the `ClaudeClientTool*Spec` /
 *  `ClaudeClientFailureBudgetSpec` split out of it, HEL-1803): the config builder, the response and block builders and
 *  the recording fake tool transport / executor. Moved verbatim apart from dropping `private`. */
trait ClaudeClientTestSupport {

  def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  def config(maxOutputTokens: Int = 4096, maxInputTokens: Int = 100000, webSearchMaxUses: Int = 3): ClaudeConfig =
    ClaudeConfig(
      apiKey = "sk-ant-test-key-should-never-be-logged",
      model = "claude-opus-4-8",
      temperature = 1.0,
      maxOutputTokens = maxOutputTokens,
      maxInputTokens = maxInputTokens,
      webSearchMaxUses = webSearchMaxUses
    )

  def toolUseResponse(id: String, name: String, input: JsValue, usage: ClaudeApiUsage = ClaudeApiUsage(10, 5)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = s"msg_$id",
      content = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))),
      stopReason = Some("tool_use"),
      usage = usage
    )

  def finalTextResponse(text: String, usage: ClaudeApiUsage = ClaudeApiUsage(8, 4)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = "msg_final",
      content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))),
      stopReason = Some("end_turn"),
      usage = usage
    )

  // HEL-757 design.md D2 — hand-written fixtures for Anthropic's server-executed web_search
  // blocks, mirroring toolUseResponse/finalTextResponse's own fixture style.
  def serverToolUseBlock(id: String, name: String = "web_search", input: JsValue = JsObject.empty): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "server_tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))

  def webSearchToolResultBlock(toolUseId: String, content: JsValue = JsArray.empty): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "web_search_tool_result", text = None, toolUseId = Some(toolUseId), serverToolResult = Some(content))

  def clientToolUseBlock(id: String, name: String, input: JsValue = JsObject.empty): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))

  /** Sequenced `sendTool` responses (one per invocation, in call order) — mirrors
   *  `DashboardAuthoringServiceSpec`'s `Vector`-of-responses + invocation-counter fake (tasks.md
   *  4.1). Indexing past the end of the vector throws `IndexOutOfBoundsException`, which doubles as
   *  a hard assertion that a further hop never happens — same "fake throws on the Nth call" fixture
   *  style as HEL-392's bounded self-repair test (tasks.md 4.4). `send`/`stream` are never exercised
   *  by these tests, so they fail loudly if `sendWithTools` ever mistakenly delegates to them. */
  class FakeToolTransport(sendToolResponses: Vector[Future[ClaudeApiResponse]]) extends ClaudeTransport {
    private val invocationCount  = new AtomicInteger(0)
    private val recordedRequests = new CopyOnWriteArrayList[ClaudeApiToolRequest]()

    def toolInvocations: Int                       = invocationCount.get()
    def toolRequests: Vector[ClaudeApiToolRequest] = recordedRequests.asScala.toVector

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] =
      Future.failed(new UnsupportedOperationException("FakeToolTransport.send is not exercised by these tests"))

    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("FakeToolTransport.stream is not exercised by these tests")

    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      recordedRequests.add(request)
      sendToolResponses(invocationCount.getAndIncrement())
    }
  }

  /** Resolves every `execute` call the same way (by-name, mirroring `FakeClaudeTransport`'s own
   *  `sendResult: => Future[...]` pattern above) while recording invocation count + args, so tests
   *  can assert both "was the executor called, how many times" and "with what". */
  class FakeToolExecutor(result: => Future[Either[String, String]]) extends ClaudeToolExecutor {
    private val invocationCount = new AtomicInteger(0)
    private val recordedCalls   = new CopyOnWriteArrayList[(String, JsValue)]()

    def invocations: Int                 = invocationCount.get()
    def calls: Vector[(String, JsValue)] = recordedCalls.asScala.toVector

    override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
      invocationCount.incrementAndGet()
      recordedCalls.add((name, input))
      result
    }
  }

  val findTool = ClaudeTool(name = "find", description = "Find a resource", inputSchema = JsObject("type" -> JsString("object")))

  def toolRequest(maxHops: Int, prompt: String = "help me"): ClaudeToolRequest =
    ClaudeToolRequest(history = Seq(ClaudeToolMessage.text(ClaudeRole.User, prompt)), tools = Seq(findTool), maxHops = maxHops)
}
