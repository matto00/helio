package com.helio.services.assistant

import com.helio.api.protocols.assistant.AssistantProposal
import com.helio.infrastructure.ai._
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.proposals.CombinedProposalService
import com.helio.services.sources.SourceService
import com.helio.testsupport.AssistantStandingsFixture
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.mockito.Mockito.mock
import spray.json._

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Future
import scala.jdk.CollectionConverters._

/** HEL-1638 task 4.2 (ticket AC 4, by scripted replay -- no live model call): the Sleeper-shaped loop. Hop 1 proposes an
 *  Output mapping `display_name` at the rosters node, where it does not exist; the tool_result fed back is an error naming
 *  the columns that node does have. Hop 2 proposes the lookup against the users source and maps `display_name` after it;
 *  that proposal is captured and the turn completes. Before HEL-1638 hop 1 was accepted at propose time (it failed only at
 *  apply), so the loop never saw the error. */
class AssistantColumnLoopSpec extends AssistantStandingsFixture {

  private lazy val st = seedStandings()

  private final class ScriptedTransport(responses: Vector[ClaudeApiResponse]) extends ClaudeTransport {
    private val count    = new AtomicInteger(0)
    val received         = new ConcurrentLinkedQueue[ClaudeApiToolRequest]()
    def invocations: Int = count.get()
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = Future.failed(new UnsupportedOperationException("not used"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException("not used")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      received.add(request)
      Future.successful(responses(count.getAndIncrement()))
    }
  }

  private def toolUse(id: String, name: String, input: JsValue): ClaudeApiResponse =
    ClaudeApiResponse(
      id = s"msg_$id",
      content = Seq(ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))),
      stopReason = Some("tool_use"), usage = ClaudeApiUsage(10, 5)
    )

  private def finalText(text: String): ClaudeApiResponse =
    ClaudeApiResponse(id = "msg_final", content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))), stopReason = Some("end_turn"), usage = ClaudeApiUsage(8, 4))

  private def output(nodeStep: Option[String]): String = {
    val node = nodeStep.fold("")(s => s""""nodeStepClientId":"$s",""")
    s"""{$node"kind":"chart","name":"Standings","config":{"chartType":"bar","fieldMapping":{"xAxis":"display_name","yAxis":"roster_id"}}}"""
  }

  "the assistant loop" should {
    "feed back a column error naming the node's columns, then capture the lookup proposal" in {
      val hop1 = s"""{"pipelineName":"Standings","roots":[{"sourceId":"${st.rostersSourceId}"}],"steps":[],"outputs":[${output(None)}]}""".parseJson
      val lookup =
        s"""{"clientId":"lk","type":"lookup","config":{"secondaryInput":{"kind":"source","dataSourceId":"${st.usersSourceId}"},"sourceKey":"owner_id","lookupKey":"user_id","columns":["display_name"]}}"""
      val hop2 = s"""{"pipelineName":"Standings","roots":[{"sourceId":"${st.rostersSourceId}"}],"steps":[$lookup],"outputs":[${output(Some("lk"))}]}""".parseJson
      val transport = new ScriptedTransport(Vector(toolUse("t1", "propose_pipeline", hop1), toolUse("t2", "propose_pipeline", hop2), finalText("Proposed.")))

      val client  = new ClaudeClient(ClaudeConfig("sk-ant-test-should-never-be-used", "claude-opus-4-8", 1.0, 4096, 100000), transport)
      val service = new AssistantService(
        client, workspaceSearchService, new PanelCapabilityService(outputRepo, nodeSnapshotRepo), dashboardProposalService,
        pipelineProposalService, new CombinedProposalService(pipelineProposalService, dashboardProposalService),
        patchSetPreviewService, mock(classOf[SourceService])
      )

      val result = await(service.converse(Seq.empty, "Show standings with player names", owner)).fold(e => fail(s"turn failed: $e"), identity)

      transport.invocations shouldBe 3
      // The request for hop 2 carries hop 1's tool_result.
      val hop2Request = transport.received.asScala.toVector(1)
      val results     = hop2Request.messages.flatMap(_.content).filter(_.blockType == "tool_result")
      results should have size 1
      results.head.isError shouldBe Some(true)
      val message = results.head.text.getOrElse("")
      message should include("display_name")
      message should include("not present at this node")
      message should include("Available columns:")
      message should include("owner_id")

      // The captured proposal is hop 2's: it does the lookup first.
      result.proposeAttempts shouldBe 2
      result.proposeValidationFailures shouldBe 1
      result.proposal match {
        case Some(AssistantProposal.Pipeline(p)) =>
          p.steps.map(_.`type`) shouldBe Vector("lookup")
          p.outputs.map(_.nodeStepClientId) shouldBe Vector(Some("lk"))
        case other => fail(s"expected the hop-2 pipeline proposal, got $other")
      }
    }
  }
}
