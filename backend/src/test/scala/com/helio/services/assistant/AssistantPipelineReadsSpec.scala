package com.helio.services.assistant

import com.helio.api.protocols.workspace.WorkspaceContextProtocol
import com.helio.domain.model.OutputId
import com.helio.services.pipelines.OutputReadAccess
import com.helio.testsupport.AssistantStandingsFixture
import spray.json._

/** HEL-1639 D1/D6 (tasks 3.1, 3.2, 3.5b, 3.6a), against an EmbeddedPostgres mirror of the 2026-10-16 Standings
 *  workspace (`AssistantStandingsFixture`): what the assistant's `find` and `get_resource` now return. */
class AssistantPipelineReadsSpec extends AssistantStandingsFixture with WorkspaceContextProtocol {

  private lazy val st = seedStandings()

  private def callOk(tool: String, input: String): JsValue =
    await(newExecutor().execute(tool, input.parseJson)) match {
      case Right(out) => out.parseJson
      case Left(err)  => fail(s"$tool failed: $err")
    }

  private def fieldsOf(v: JsValue): Map[String, JsValue] = v.asJsObject.fields
  private def arr(v: JsValue, key: String): Vector[JsValue] = fieldsOf(v)(key).asInstanceOf[JsArray].elements

  "find" should {
    "find a dashboard named Standings from the long query the model actually sent (taxonomy 9)" in {
      val st0 = st
      val hits = callOk("find", """{"query":"Fantasy Football standings dashboard","resourceTypes":["dashboard"]}""")
      hits.asInstanceOf[JsArray].elements.map(h => fieldsOf(h)("id").convertTo[String]) should contain(st0.dashboardId)
    }

    "rank a resource matching more keywords above one matching fewer, and still return nothing for a query matching nothing" in {
      val ranked = callOk("find", """{"query":"sleeper rosters"}""").asInstanceOf[JsArray].elements.map(h => fieldsOf(h)("name").convertTo[String])
      ranked.head shouldBe "Sleeper rosters"
      callOk("find", """{"query":"zzqxnomatchzz"}""").asInstanceOf[JsArray].elements shouldBe empty
    }
  }

  "get_resource(pipeline)" should {
    "return a populated laneTree, every node with its config, parent, root and the schema AFTER it, and the Outputs (taxonomy 4)" in {
      val s0 = st
      val detail = callOk("get_resource", s"""{"id":"${s0.pipelineId}","type":"pipeline"}""")
      arr(detail, "laneTree") should not be empty

      val nodes = arr(detail, "nodes")
      nodes.map(n => fieldsOf(n)("type").convertTo[String]) shouldBe Vector("lookup", "compute")
      val lookup = nodes.head
      fieldsOf(lookup)("id").convertTo[String] shouldBe s0.lookupStepId
      fieldsOf(fieldsOf(lookup)("config"))("sourceKey").convertTo[String] shouldBe "owner_id"
      fieldsOf(lookup).contains("rootId") shouldBe true
      val lookupSchema = arr(lookup, "outputSchema").map(c => fieldsOf(c)("name").convertTo[String])
      lookupSchema should contain("display_name")
      lookupSchema should not contain "points_for"

      val compute = nodes(1)
      fieldsOf(compute)("parentStepId").convertTo[String] shouldBe s0.lookupStepId
      arr(compute, "outputSchema").map(c => fieldsOf(c)("name").convertTo[String]) should contain allOf ("display_name", "points_for")

      val outputs = arr(detail, "outputs")
      outputs should have size 1
      fieldsOf(outputs.head)("id").convertTo[String] shouldBe s0.tableOutputId
      fieldsOf(outputs.head)("kind").convertTo[String] shouldBe "table"
      fieldsOf(outputs.head)("nodeStepId").convertTo[String] shouldBe s0.computeStepId
    }
  }

  "get_resource(dashboard) and get_resource(Output) (taxonomy 6)" should {
    "link a dashboard's panel to its Output and pipeline, and an Output to its pipeline and node" in {
      val s0 = st
      val dashboard = callOk("get_resource", s"""{"id":"${s0.dashboardId}","type":"dashboard"}""")
      val panels = arr(dashboard, "panels")
      panels should have size 1
      fieldsOf(panels.head)("id").convertTo[String] shouldBe s0.tablePanelId
      fieldsOf(panels.head)("outputId").convertTo[String] shouldBe s0.tableOutputId
      fieldsOf(panels.head)("outputPipelineId").convertTo[String] shouldBe s0.pipelineId

      val output = callOk("get_resource", s"""{"id":"${s0.tableOutputId}","type":"dataType"}""")
      val detail = fieldsOf(output).getOrElse("detail", output)
      fieldsOf(detail)("pipelineId").convertTo[String] shouldBe s0.pipelineId
      fieldsOf(detail)("nodeStepId").convertTo[String] shouldBe s0.computeStepId
    }
  }

  // `dashboardPanels` (outputPipelineId) and the Output-as-root hint both resolve a pipeline through OutputReadAccess. A
  // panel cannot be bound to an Output its dashboard owner does not own, so the rule is proved on the shared function.
  "OutputReadAccess.readablePipelineId" should {
    "name the pipeline to its owner and to a grantee, and to nobody else, including after the share is withdrawn" in {
      val s0 = seedStandings(suffix = " ra")
      def asOther = await(OutputReadAccess.readablePipelineId(outputRepo, pipelineService, OutputId(s0.tableOutputId), otherUser))
      await(OutputReadAccess.readablePipelineId(outputRepo, pipelineService, OutputId(s0.tableOutputId), owner)) shouldBe Some(s0.pipelineId)
      asOther shouldBe None
      grantRole("pipeline", s0.pipelineId, otherIdStr, "viewer")
      asOther shouldBe Some(s0.pipelineId)
      import slick.jdbc.PostgresProfile.api._
      await(db.run(sqlu"DELETE FROM resource_permissions WHERE resource_type = 'pipeline' AND resource_id = ${s0.pipelineId}"))
      asOther shouldBe None
      await(OutputReadAccess.readablePipelineId(outputRepo, pipelineService, OutputId("not-a-uuid"), owner)) shouldBe None
    }
  }

  "the shared workspace-context types (3.5b)" should {
    "be unchanged: assemble's JSON carries none of the get_resource-only fields" in {
      val s0 = st
      val context = await(workspaceContextService.assemble(owner)).toJson.asJsObject
      val pipeline = context.fields("pipelines").asInstanceOf[JsArray].elements.find(p => fieldsOf(p)("id").convertTo[String] == s0.pipelineId).get
      fieldsOf(pipeline).keySet shouldBe Set(
        "id", "name", "roots", "outputId", "outputName", "lastRunStatus", "lastRunAt", "lastRunRowCount", "lastRunTruncated",
        "tag", "steps", "stepsError", "laneTree"
      ).intersect(fieldsOf(pipeline).keySet) // optional keys may be omitted; none beyond this set may appear
      fieldsOf(pipeline).keySet should not contain "nodes"
      fieldsOf(pipeline).keySet should not contain "outputs"
      val dashboard = context.fields("dashboards").asInstanceOf[JsArray].elements.find(d => fieldsOf(d)("id").convertTo[String] == s0.dashboardId).get
      fieldsOf(dashboard).keySet shouldBe Set("id", "name", "panelCount", "accessRole")
      val output = context.fields("dataTypes").asInstanceOf[JsArray].elements.find(o => fieldsOf(o)("id").convertTo[String] == s0.tableOutputId).get
      fieldsOf(output).keySet should not contain "pipelineId"
      fieldsOf(output).keySet should not contain "nodeStepId"
    }
  }
}
