package com.helio.ai

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.NotUsed
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import spray.json._

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** Coverage for `ClaudeClient` against a hand-written fake `ClaudeTransport` (HEL-390 task 6.2) —
 *  no real network call is ever made: request construction, the input-token guardrail rejection
 *  (zero transport invocations, for both `send` and `stream`), the output-token clamp, successful
 *  `usage` passthrough, API-error mapping, and that the configured API key never appears in
 *  captured log output. */
class ClaudeClientSpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private implicit val mat: Materializer = Materializer(system)

  private def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  private def config(maxOutputTokens: Int = 4096, maxInputTokens: Int = 100000, webSearchMaxUses: Int = 3): ClaudeConfig =
    ClaudeConfig(
      apiKey = "sk-ant-test-key-should-never-be-logged",
      model = "claude-opus-4-8",
      temperature = 1.0,
      maxOutputTokens = maxOutputTokens,
      maxInputTokens = maxInputTokens,
      webSearchMaxUses = webSearchMaxUses
    )

  private val canned = ClaudeApiResponse(
    id = "msg_abc123",
    content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some("Hello there"))),
    stopReason = Some("end_turn"),
    usage = ClaudeApiUsage(inputTokens = 12, outputTokens = 3)
  )

  /** Hand-written fake — records every `send`/`stream` invocation and the request it was called
   *  with, so tests can assert both "was the transport called" and "with what". */
  private class FakeClaudeTransport(sendResult: => Future[ClaudeApiResponse], streamEvents: Seq[ClaudeStreamEvent] = Seq.empty)
      extends ClaudeTransport {
    val sendInvocations: AtomicInteger   = new AtomicInteger(0)
    val streamInvocations: AtomicInteger = new AtomicInteger(0)
    @volatile var lastRequest: Option[ClaudeApiRequest] = None

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      sendInvocations.incrementAndGet()
      lastRequest = Some(request)
      sendResult
    }

    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = {
      streamInvocations.incrementAndGet()
      lastRequest = Some(request)
      Source(streamEvents.toList)
    }
  }

  private val request = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, "hi")))

  "ClaudeClient.send" should {

    "wire model/max-tokens/temperature/messages through to the transport request" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxOutputTokens = 777), transport)

      val req = ClaudeRequest(
        messages = Seq(ClaudeMessage(ClaudeRole.User, "What is 2+2?")),
        maxTokens = Some(100),
        temperature = Some(0.2)
      )
      await(client.send(req))

      // assistant-prompt-caching design.md D3/skeptic-design-1.md CR1: every real send request with
      // a non-empty message list now carries the first-message cache marker -- tasks.md 4.6.
      transport.lastRequest shouldBe Some(
        ClaudeApiRequest(
          model = "claude-opus-4-8",
          maxTokens = 100,
          messages = Seq(ClaudeApiMessage("user", "What is 2+2?", cacheControl = Some(ClaudeApiCacheControl.Ephemeral))),
          temperature = 0.2,
          stream = false
        )
      )
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D3) -- toApiRequest marks the first message.
    "mark the first message with a cache breakpoint" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(), transport)

      val req = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, "first"), ClaudeMessage(ClaudeRole.Assistant, "second")))
      await(client.send(req))

      val messages = transport.lastRequest.map(_.messages).getOrElse(Seq.empty)
      messages.head.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
      messages.last.cacheControl shouldBe None
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D3) -- the empty-messages guard: no exception,
    // no marker to place.
    "not fail when marking an empty message list (guarded on non-empty)" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(), transport)

      val result = await(client.send(ClaudeRequest(messages = Seq.empty)))

      result.isRight shouldBe true
      transport.lastRequest.map(_.messages) shouldBe Some(Seq.empty)
    }

    "default maxTokens/temperature from config when the request doesn't override them" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxOutputTokens = 4096), transport)

      await(client.send(request))

      transport.lastRequest.map(_.maxTokens) shouldBe Some(4096)
      transport.lastRequest.map(_.temperature) shouldBe Some(1.0)
    }

    "clamp an over-ceiling requested maxTokens down to the ceiling rather than rejecting" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxOutputTokens = 500), transport)

      val result = await(client.send(request.copy(maxTokens = Some(10000))))

      transport.lastRequest.map(_.maxTokens) shouldBe Some(500)
      result.isRight shouldBe true
    }

    "reject over-input-budget requests with GuardrailExceeded and zero transport invocations" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxInputTokens = 1), transport)

      val longMessage = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, "this message has more than one token in it easily")))
      val result       = await(client.send(longMessage))

      result match {
        case Left(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                   => fail(s"expected Left(GuardrailExceeded), got $other")
      }
      transport.sendInvocations.get() shouldBe 0
    }

    "proceed normally when the estimated input is at or below the budget" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxInputTokens = 100000), transport)

      val result = await(client.send(request))

      result.isRight shouldBe true
      transport.sendInvocations.get() shouldBe 1
    }

    "expose usage from the API response, not the pre-flight estimate" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(), transport)

      val result = await(client.send(request))

      result shouldBe Right(ClaudeResponse(id = "msg_abc123", text = "Hello there", stopReason = Some("end_turn"), usage = TokenUsage(12, 3)))
    }

    "map a transport ClaudeApiException to Left(ClaudeError.ApiError)" in {
      val transport = new FakeClaudeTransport(Future.failed(ClaudeApiException(401, "unauthorized")))
      val client    = new ClaudeClient(config(), transport)

      await(client.send(request)) shouldBe Left(ClaudeError.ApiError(401, "unauthorized"))
    }

    "map any other transport failure to Left(ClaudeError.TransportFailure)" in {
      val transport = new FakeClaudeTransport(Future.failed(new RuntimeException("connection refused")))
      val client    = new ClaudeClient(config(), transport)

      await(client.send(request)) shouldBe Left(ClaudeError.TransportFailure("Request failed"))
    }

    "never log the configured API key, even when the transport call fails" in {
      val secretKey  = "sk-ant-should-never-appear-in-logs-hel390"
      val transport  = new FakeClaudeTransport(Future.failed(ClaudeApiException(401, "unauthorized")))
      val clientConf = config().copy(apiKey = secretKey)
      val client     = new ClaudeClient(clientConf, transport)

      val logbackLogger = LoggerFactory.getLogger(client.getClass).asInstanceOf[LogbackLogger]
      val appender       = new ListAppender[ILoggingEvent]()
      appender.start()
      logbackLogger.addAppender(appender)

      try {
        await(client.send(request))
        val events = appender.list.asScala.toSeq
        events.foreach(_.getFormattedMessage should not include secretKey)
      } finally {
        logbackLogger.detachAppender(appender)
      }
    }
  }

  "ClaudeClient.stream" should {

    "reject over-input-budget requests with a single GuardrailExceeded error event and zero transport invocations" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxInputTokens = 1), transport)

      val longMessage = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, "this message has more than one token in it easily")))
      val events       = await(client.stream(longMessage).runWith(Sink.seq))

      events should have size 1
      events.head match {
        case ClaudeStreamEvent.Error(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                                       => fail(s"expected a single GuardrailExceeded error event, got $other")
      }
      transport.streamInvocations.get() shouldBe 0
    }

    "delegate to the transport and pass through emitted events when under budget" in {
      val streamEvents = Seq(ClaudeStreamEvent.TextDelta("hi"), ClaudeStreamEvent.MessageStop)
      val transport     = new FakeClaudeTransport(Future.successful(canned), streamEvents)
      val client        = new ClaudeClient(config(), transport)

      val events = await(client.stream(request).runWith(Sink.seq))

      events shouldBe streamEvents
      transport.streamInvocations.get() shouldBe 1
    }
  }

  // ── sendWithTools (HEL-660) ─────────────────────────────────────────────

  private def toolUseResponse(id: String, name: String, input: JsValue, usage: ClaudeApiUsage = ClaudeApiUsage(10, 5)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = s"msg_$id",
      content = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))),
      stopReason = Some("tool_use"),
      usage = usage
    )

  private def finalTextResponse(text: String, usage: ClaudeApiUsage = ClaudeApiUsage(8, 4)): ClaudeApiResponse =
    ClaudeApiResponse(
      id = "msg_final",
      content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))),
      stopReason = Some("end_turn"),
      usage = usage
    )

  // HEL-757 design.md D2 — hand-written fixtures for Anthropic's server-executed web_search
  // blocks, mirroring toolUseResponse/finalTextResponse's own fixture style.
  private def serverToolUseBlock(id: String, name: String = "web_search", input: JsValue = JsObject.empty): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "server_tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))

  private def webSearchToolResultBlock(toolUseId: String, content: JsValue = JsArray.empty): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "web_search_tool_result", text = None, toolUseId = Some(toolUseId), serverToolResult = Some(content))

  private def clientToolUseBlock(id: String, name: String, input: JsValue = JsObject.empty): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))

  /** Sequenced `sendTool` responses (one per invocation, in call order) — mirrors
   *  `DashboardAuthoringServiceSpec`'s `Vector`-of-responses + invocation-counter fake (tasks.md
   *  4.1). Indexing past the end of the vector throws `IndexOutOfBoundsException`, which doubles as
   *  a hard assertion that a further hop never happens — same "fake throws on the Nth call" fixture
   *  style as HEL-392's bounded self-repair test (tasks.md 4.4). `send`/`stream` are never exercised
   *  by these tests, so they fail loudly if `sendWithTools` ever mistakenly delegates to them. */
  private class FakeToolTransport(sendToolResponses: Vector[Future[ClaudeApiResponse]]) extends ClaudeTransport {
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
  private class FakeToolExecutor(result: => Future[Either[String, String]]) extends ClaudeToolExecutor {
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

  private val findTool = ClaudeTool(name = "find", description = "Find a resource", inputSchema = JsObject("type" -> JsString("object")))

  private def toolRequest(maxHops: Int, prompt: String = "help me"): ClaudeToolRequest =
    ClaudeToolRequest(history = Seq(ClaudeToolMessage.text(ClaudeRole.User, prompt)), tools = Seq(findTool), maxHops = maxHops)

  "ClaudeClient.sendWithTools" should {

    "resolve FinalResponse with zero executor invocations when the first response has no tool_use" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("all set"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client       = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "all set"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }
      toolExecutor.invocations shouldBe 0
      transport.toolInvocations shouldBe 1
    }

    "invoke the executor exactly once on a single tool_use round trip, then resolve FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject("query" -> JsString("revenue")))),
          Future.successful(finalTextResponse("found it"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("3 rows")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      toolExecutor.invocations shouldBe 1
      toolExecutor.calls.head._1 shouldBe "find"
      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "found it"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }
    }

    "hard-cap at maxHops: a 4th tool_use attempt terminates gracefully, not a 5th transport call" in {
      val toolUseFuture = Future.successful(toolUseResponse("toolu_x", "find", JsObject.empty))
      val transport      = new FakeToolTransport(Vector.fill(4)(toolUseFuture))
      val toolExecutor        = new FakeToolExecutor(Future.successful(Right("ok")))
      val client          = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      toolExecutor.invocations shouldBe 3
      transport.toolInvocations shouldBe 4
      outcome shouldBe a[ClaudeToolOutcome.HopBudgetExhausted]
    }

    "resolve FinalResponse (not HopBudgetExhausted) when exactly maxHops tool_use round trips are followed by a final response" in {
      val toolUseFuture = Future.successful(toolUseResponse("toolu_x", "find", JsObject.empty))
      val transport = new FakeToolTransport(
        Vector(toolUseFuture, toolUseFuture, toolUseFuture, Future.successful(finalTextResponse("done")))
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client   = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      toolExecutor.invocations shouldBe 3
      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "done"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }
    }

    "feed a Left executor result back as an isError tool_result and continue the loop to FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty)),
          Future.successful(finalTextResponse("recovered"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Left("resource not found")))
      val client   = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "recovered"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }

      val secondRequest   = transport.toolRequests(1)
      val toolResultBlock = secondRequest.messages.last.content.find(_.blockType == "tool_result")
      toolResultBlock.flatMap(_.isError) shouldBe Some(true)
      toolResultBlock.flatMap(_.text) shouldBe Some("resource not found")
    }

    // HEL-667 design.md D3/tasks.md 7.1 — a THROWN exception (not an explicit Left) from the
    // executor still recovers to an isError tool_result and the loop continues, rather than failing
    // sendWithTools's overall Future.
    "recover a THROWN executor exception as an isError tool_result and continue the loop to FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty)),
          Future.successful(finalTextResponse("recovered from a throw"))
        )
      )
      val throwingExecutor = new ClaudeToolExecutor {
        override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
          throw new RuntimeException("executor blew up synchronously")
      }
      val client = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), throwingExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "recovered from a throw"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }

      val secondRequest   = transport.toolRequests(1)
      val toolResultBlock = secondRequest.messages.last.content.find(_.blockType == "tool_result")
      toolResultBlock.flatMap(_.isError) shouldBe Some(true)
      toolResultBlock.flatMap(_.text) shouldBe Some("executor blew up synchronously")
    }

    // HEL-667 design.md D3/tasks.md 7.1 — a FAILED inner Future (not Future.successful(Left(...)))
    // from the executor also recovers to an isError tool_result and the loop continues.
    "recover a FAILED inner Future from the executor as an isError tool_result and continue the loop to FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty)),
          Future.successful(finalTextResponse("recovered from a failed future"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.failed(new RuntimeException("upstream lookup timed out")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "recovered from a failed future"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }

      val secondRequest   = transport.toolRequests(1)
      val toolResultBlock = secondRequest.messages.last.content.find(_.blockType == "tool_result")
      toolResultBlock.flatMap(_.isError) shouldBe Some(true)
      toolResultBlock.flatMap(_.text) shouldBe Some("upstream lookup timed out")
    }

    "sum usage across hops into the FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty, usage = ClaudeApiUsage(inputTokens = 20, outputTokens = 5))),
          Future.successful(finalTextResponse("done", usage = ClaudeApiUsage(inputTokens = 15, outputTokens = 8)))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client   = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(_, _, usage) => usage shouldBe TokenUsage(inputTokens = 35, outputTokens = 13)
        case other                                          => fail(s"expected FinalResponse, got $other")
      }
    }

    // ── web_search wiring (HEL-757 design.md D2/D3, tasks.md 5.2-5.4) ─────────────────────────

    // tasks.md 5.2 -- webSearch = false (the default) adds nothing to the outbound tool list.
    "not add the web_search tool to the outbound request when webSearch = false (default)" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      val built = transport.toolRequests.head
      built.tools should have size 1
      built.tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } shouldBe empty
    }

    // tasks.md 5.2 -- webSearch = true adds the server tool alongside the existing custom tools.
    "add the web_search server-tool entry alongside custom tools when webSearch = true" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val request = toolRequest(maxHops = 3).copy(webSearch = true)
      await(client.sendWithTools(request, toolExecutor))

      val built = transport.toolRequests.head
      built.tools should have size 2
      built.tools.collect { case t: ClaudeApiTool => t } should have size 1
      built.tools.last shouldBe ClaudeApiToolSpec.WebSearch(3)
    }

    // tasks.md 5.3 -- cross-hop budget: once the cumulative web_search count reaches
    // webSearchMaxUses, the tool is dropped from a later hop's outbound request entirely,
    // independent of maxHops (mirrors claude-api-client spec.md's own scenario).
    "drop the web_search tool from a later hop's outbound request once the cross-hop budget is exhausted" in {
      def twoSearchesThenClientTool(searchId1: String, searchId2: String, toolId: String): ClaudeApiResponse =
        ClaudeApiResponse(
          id = s"msg_$searchId1",
          content = Seq(
            serverToolUseBlock(searchId1),
            webSearchToolResultBlock(searchId1),
            serverToolUseBlock(searchId2),
            webSearchToolResultBlock(searchId2),
            clientToolUseBlock(toolId, "find")
          ),
          stopReason = Some("tool_use"),
          usage = ClaudeApiUsage(10, 5)
        )

      val transport = new FakeToolTransport(
        Vector(
          Future.successful(twoSearchesThenClientTool("s1", "s2", "t1")),
          Future.successful(twoSearchesThenClientTool("s3", "s4", "t2")),
          Future.successful(finalTextResponse("done"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client        = new ClaudeClient(config(webSearchMaxUses = 2), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      outcome shouldBe a[ClaudeToolOutcome.FinalResponse]
      // Hop 1's request is built with zero searches used so far -- web_search still offered.
      transport.toolRequests(0).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } should have size 1
      // By hop 2, hop 1's response already fired 2 searches -- the cumulative count already reached
      // webSearchMaxUses, so the tool is omitted from hop 2's request too (not just hop 3's).
      transport.toolRequests(1).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } shouldBe empty
      // By hop 3, the cumulative count (>= 2) already reached webSearchMaxUses -- tool omitted entirely.
      transport.toolRequests(2).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } shouldBe empty
    }

    // tasks.md 5.4 (spec.md's first scenario) -- a hop containing ONLY a web_search server-tool
    // pair (no client tool_use) never reaches the executor and resolves straight to FinalResponse.
    "resolve FinalResponse with zero executor invocations when a hop contains only a web_search server-tool pair" in {
      val searchOnly = ClaudeApiResponse(
        id = "msg_search_only",
        content = Seq(serverToolUseBlock("s1"), webSearchToolResultBlock("s1"), ClaudeApiContentBlock(blockType = "text", text = Some("Found it via search"))),
        stopReason = Some("end_turn"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport    = new FakeToolTransport(Vector(Future.successful(searchOnly)))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      toolExecutor.invocations shouldBe 0
      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "Found it via search"
        case other                                         => fail(s"expected FinalResponse, got $other")
      }
    }

    // tasks.md 5.4 (spec.md's second scenario) -- a hop with BOTH a web_search server-tool pair AND
    // a client tool_use block invokes executor.execute exactly once, for the client block only; the
    // server-tool blocks are preserved in the appended history unchanged.
    "invoke the executor exactly once when a hop contains both a web_search server-tool pair and a client tool_use block" in {
      val mixedHop = ClaudeApiResponse(
        id = "msg_mixed",
        content = Seq(serverToolUseBlock("s1"), webSearchToolResultBlock("s1"), clientToolUseBlock("t1", "find")),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport    = new FakeToolTransport(Vector(Future.successful(mixedHop), Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("3 rows")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      toolExecutor.invocations shouldBe 1
      toolExecutor.calls.head._1 shouldBe "find"
      outcome match {
        case ClaudeToolOutcome.FinalResponse(_, history, _) =>
          val serverBlocks = history.flatMap(_.content).collect {
            case s: ClaudeContentBlock.ServerToolUse    => s
            case r: ClaudeContentBlock.ServerToolResult => r
          }
          serverBlocks should have size 2
        case other => fail(s"expected FinalResponse, got $other")
      }
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D3) -- toApiToolRequest marks the last tools
    // element and the last content block of the first message, and nowhere else.
    // HEL-757 tasks.md 5.7 -- re-verified against the new ClaudeApiToolSpec sealed type: `built.tools`
    // is now Seq[ClaudeApiToolSpec], so the marker assertions narrow to the ClaudeApiTool ("Custom")
    // elements specifically, rather than calling .cacheControl on the sealed trait directly.
    "mark the last tools element and the first message's last content block with a cache breakpoint" in {
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val multiTools = ClaudeToolRequest(
        history = Seq(ClaudeToolMessage.text(ClaudeRole.User, "help me"), ClaudeToolMessage.text(ClaudeRole.Assistant, "sure")),
        tools = Seq(findTool, ClaudeTool(name = "list", description = "List things", inputSchema = JsObject("type" -> JsString("object")))),
        maxHops = 3
      )
      await(client.sendWithTools(multiTools, toolExecutor))

      val built       = transport.toolRequests.head
      val customTools = built.tools.collect { case t: ClaudeApiTool => t }
      customTools should have size 2
      customTools.init.foreach(_.cacheControl shouldBe None)
      customTools.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)

      val firstMessageBlocks = built.messages.head.content
      firstMessageBlocks.init.foreach(_.cacheControl shouldBe None)
      firstMessageBlocks.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
      built.messages.tail.foreach(_.content.foreach(_.cacheControl shouldBe None))
    }

    // HEL-757 design.md D2a/tasks.md 5.7 -- the appended WebSearch entry is NEVER a candidate for
    // the "mark the last tools element" breakpoint: the last CUSTOM tool stays marked regardless of
    // webSearch, and WebSearch itself carries no cacheControl field to set. The first-message
    // marker (unrelated to the tools array) stays unaffected on hop 1 either way.
    "mark the last custom tool -- not the appended WebSearch entry -- when webSearch = true" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val request = toolRequest(maxHops = 3).copy(webSearch = true)
      await(client.sendWithTools(request, toolExecutor))

      val built = transport.toolRequests.head
      built.tools should have size 2
      val customTools = built.tools.collect { case t: ClaudeApiTool => t }
      customTools should have size 1
      customTools.head.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
      built.tools.last shouldBe ClaudeApiToolSpec.WebSearch(3)

      built.messages.head.content.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
    }

    // HEL-757 design.md D2a's accepted trade-off/tasks.md 5.7 -- once web_search has fired, the
    // remaining budget (and therefore the WebSearch entry's own max_uses) shrinks hop-to-hop, so the
    // tools-array byte sequence genuinely differs between hop 1 and hop 2 -- the documented cache-miss
    // trade-off is real, not silently absent.
    "produce a different tools-array byte sequence on the hop after web_search first fires" in {
      val searchThenClientTool = ClaudeApiResponse(
        id = "msg_search_then_tool",
        content = Seq(serverToolUseBlock("s1"), webSearchToolResultBlock("s1"), clientToolUseBlock("t1", "find")),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport = new FakeToolTransport(Vector(Future.successful(searchThenClientTool), Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client        = new ClaudeClient(config(webSearchMaxUses = 3), transport)

      await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      val hop1Tools = transport.toolRequests(0).tools
      val hop2Tools = transport.toolRequests(1).tools
      hop1Tools.last shouldBe ClaudeApiToolSpec.WebSearch(3)
      hop2Tools.last shouldBe ClaudeApiToolSpec.WebSearch(2)
      hop1Tools should not be hop2Tools
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D3) -- empty-tools/empty-messages guard: no
    // exception, no marker to place.
    "not fail when tools and history are both empty (guarded on non-empty)" in {
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val empty = ClaudeToolRequest(history = Seq.empty, tools = Seq.empty, maxHops = 3)
      val outcome = await(client.sendWithTools(empty, toolExecutor))

      outcome shouldBe a[ClaudeToolOutcome.FinalResponse]
      val built = transport.toolRequests.head
      built.tools shouldBe Seq.empty
      built.messages shouldBe Seq.empty
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D4) -- the two new cache counters aggregate
    // across hops exactly like inputTokens/outputTokens already do.
    "aggregate cache-read and cache-creation input tokens across hops into the FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(
            toolUseResponse(
              "toolu_1",
              "find",
              JsObject.empty,
              usage = ClaudeApiUsage(inputTokens = 20, outputTokens = 5, cacheCreationInputTokens = 100, cacheReadInputTokens = 0)
            )
          ),
          Future.successful(
            finalTextResponse("done", usage = ClaudeApiUsage(inputTokens = 15, outputTokens = 8, cacheCreationInputTokens = 0, cacheReadInputTokens = 100))
          )
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(_, _, usage) =>
          usage shouldBe TokenUsage(inputTokens = 35, outputTokens = 13, cacheCreationInputTokens = 100, cacheReadInputTokens = 100)
        case other => fail(s"expected FinalResponse, got $other")
      }
    }

    "reject a mid-loop guardrail breach with Failed(GuardrailExceeded) and no transport call for that hop" in {
      val transport = new FakeToolTransport(Vector(Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty))))
      val longResult = "a very long tool result that will blow the input token budget once appended to history"
      val toolExecutor    = new FakeToolExecutor(Future.successful(Right(longResult)))
      // Sized to admit the first hop's short prompt but not the grown history once the long
      // tool_result is appended ahead of the second hop's guardrail check.
      val client = new ClaudeClient(config(maxInputTokens = 10), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3, prompt = "hi"), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                                        => fail(s"expected Failed(GuardrailExceeded), got $other")
      }
      transport.toolInvocations shouldBe 1
    }
  }
}
