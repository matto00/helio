package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.PatchSet
import com.helio.api.protocols.pipelines.CreatePipelineStepRequest
import com.helio.domain.model.{AuthenticatedUser, OutputId, PanelId, PatchSetApplicationId, PipelineId}
import com.helio.services.ServiceError
import com.helio.services.pipelines.{OutputService, PipelineRunService}
import com.helio.testsupport.AssistantStandingsFixture
import org.mockito.Mockito.{mock, mockingDetails}
import org.mockito.invocation.InvocationOnMock
import org.mockito.stubbing.Answer
import spray.json._

import scala.concurrent.Future
import scala.jdk.CollectionConverters._

/** HEL-1639 D2 (tasks 3.5, 3.5a, 3.5c): an `output` create in a patch set, and a panel create bound to it by `$ref`:
 *  preview, apply, rollback, undo, the saved-step schema check and the edited-node guard, on the Standings fixture. */
class PatchSetOutputCreateSpec extends AssistantStandingsFixture {

  private def patchSet(json: String): PatchSet = json.parseJson.convertTo[PatchSet]

  /** Output create at `node` with ref `ref`, then a panel on `dashboard` bound to `$ref:<ref>`. */
  private def chartAndPanel(s: Standings, node: String, ref: String = "wins", yAxis: String = "settings.wins", xAxis: String = "display_name"): String =
    s"""{"summary":"chart","edits":[
      {"target":{"kind":"output","parentId":"${s.pipelineId}","ref":"$ref"},"op":"create",
       "patch":{"name":"Wins by team","kind":"chart","nodeStepId":"$node",
                "config":{"chartType":"bar","fieldMapping":{"xAxis":"$xAxis","yAxis":"$yAxis"}}}},
      {"target":{"kind":"panel"},"op":"create",
       "patch":{"dashboardId":"${s.dashboardId}","title":"Wins by team","type":"output","config":{"outputId":"$$ref:$ref"}}}
    ]}"""

  private def previewError(user: AuthenticatedUser, json: String): String =
    await(patchSetPreviewService.preview(patchSet(json), user)) match {
      case Left(err) => err.message
      case Right(_)  => fail("expected the preview to be refused")
    }

  private def outputsOf(pipelineId: String) = await(outputRepo.listByPipelineInternal(PipelineId(pipelineId)))

  "an output create bound to a panel by $ref" should {

    "preview as two pending creates and write nothing" in {
      val s = seedStandings(suffix = " pv")
      val before = outputsOf(s.pipelineId).size
      val preview = await(patchSetPreviewService.preview(patchSet(chartAndPanel(s, s.computeStepId)), owner)).getOrElse(fail("preview refused"))
      preview.edits.map(e => (e.kind, e.op)) shouldBe Vector(("output", "create"), ("panel", "create"))
      preview.edits(1).after.get.toJson.compactPrint should include("$ref:wins")
      outputsOf(s.pipelineId).size shouldBe before
    }

    "apply with the panel bound to the NEW Output's real id, then undo removes both" in {
      val s = seedStandings(suffix = " ap")
      val response = await(patchSetApplyService.apply(patchSet(chartAndPanel(s, s.computeStepId)), owner)).getOrElse(fail("apply refused"))
      response.failure shouldBe None
      val newOutputId = response.edits.head.newId.getOrElse(fail("no output id"))
      val newPanelId  = response.edits(1).newId.getOrElse(fail("no panel id"))
      val output = await(outputRepo.findByIdInternal(OutputId(newOutputId))).getOrElse(fail("output missing"))
      output.node.stepId.map(_.value) shouldBe Some(s.computeStepId)
      await(outputRepo.findConfigById(OutputId(newOutputId), owner)).get.fields("fieldMapping").asJsObject.fields("yAxis") shouldBe JsString("settings.wins")
      val panel = await(panelRepo.findByIdInternal(PanelId(newPanelId))).getOrElse(fail("panel missing"))
      panel.toString should include(newOutputId)

      val undone = await(patchSetUndoService.undo(PatchSetApplicationId(response.applicationId.getOrElse(fail("not journaled"))), owner))
      undone.isRight shouldBe true
      await(outputRepo.findByIdInternal(OutputId(newOutputId))) shouldBe None
      await(panelRepo.findByIdInternal(PanelId(newPanelId))) shouldBe None
    }

    "reject a dangling ref, naming the refs that do exist" in {
      val s = seedStandings(suffix = " dr")
      val msg = previewError(owner, chartAndPanel(s, s.computeStepId).replace("$ref:wins", "$ref:missing"))
      msg should include("edit 1")
      msg should include("$ref:missing does not name an earlier output create")
      msg should include("refs: wins")
    }

    "reject a panel that names a ref defined LATER in the set" in {
      val s = seedStandings(suffix = " lt")
      val json =
        s"""{"edits":[
          {"target":{"kind":"panel"},"op":"create","patch":{"dashboardId":"${s.dashboardId}","title":"T","type":"output","config":{"outputId":"$$ref:wins"}}},
          {"target":{"kind":"output","parentId":"${s.pipelineId}","ref":"wins"},"op":"create","patch":{"name":"W","kind":"table","nodeStepId":"${s.computeStepId}"}}
        ]}"""
      previewError(owner, json) should include("$ref:wins does not name an earlier output create (refs: none)")
    }

    "reject a malformed, duplicate or non-create ref" in {
      val s = seedStandings(suffix = " rf")
      previewError(owner, chartAndPanel(s, s.computeStepId, ref = "Bad Ref")) should include("target.ref 'Bad Ref' must match")
      val dup =
        s"""{"edits":[
          {"target":{"kind":"output","parentId":"${s.pipelineId}","ref":"a"},"op":"create","patch":{"name":"A","kind":"table","nodeStepId":"${s.computeStepId}"}},
          {"target":{"kind":"output","parentId":"${s.pipelineId}","ref":"a"},"op":"create","patch":{"name":"B","kind":"table","nodeStepId":"${s.computeStepId}"}}
        ]}"""
      previewError(owner, dup) should include("target.ref 'a' is already used by edit 0")
      val onUpdate = s"""{"edits":[{"target":{"kind":"panel","id":"${s.tablePanelId}","ref":"x"},"op":"update","patch":{"title":"T"}}]}"""
      previewError(owner, onUpdate) should include("only valid on a create edit")
    }

    "reject a mapped column that is not in the node's schema, naming the column and the node (taxonomy 3)" in {
      val s = seedStandings(suffix = " mc")
      // display_name does not exist at the raw-source level; the lookup step is the first node that has it
      val atLookup = previewError(owner, chartAndPanel(s, s.lookupStepId, yAxis = "points_for"))
      atLookup should include("points_for")
      atLookup should include(s.lookupStepId)
    }

    "reject a nodeStepId that is not a step of the pipeline" in {
      val s = seedStandings(suffix = " ns")
      val other = seedStandings(suffix = " ns2")
      previewError(owner, chartAndPanel(s, other.computeStepId)) should include("is not a step of pipeline")
    }

    "reject an output create that names no step" in {
      val s = seedStandings(suffix = " nn")
      val json = s"""{"edits":[{"target":{"kind":"output","parentId":"${s.pipelineId}"},"op":"create","patch":{"name":"A","kind":"table"}}]}"""
      previewError(owner, json) should include("nodeStepId is required")
    }

    "reject a set that also edits the Output's node, or any step upstream of it" in {
      val s = seedStandings(suffix = " ed")
      val json =
        s"""{"edits":[
          {"target":{"kind":"pipelineStep","id":"${s.lookupStepId}"},"op":"update","patch":{"config":{"secondaryInput":{"kind":"source","dataSourceId":"${s.usersSourceId}"},"sourceKey":"owner_id","lookupKey":"user_id","columns":["display_name"]}}},
          {"target":{"kind":"output","parentId":"${s.pipelineId}"},"op":"create","patch":{"name":"A","kind":"table","nodeStepId":"${s.computeStepId}"}}
        ]}"""
      val msg = previewError(owner, json)
      msg should include("edit 1")
      msg should include("cannot target a node whose steps are edited in this patch set; propose the step edits first")
    }
  }

  "a panel create" should {
    "reject target.parentId with a message that names patch.dashboardId (taxonomy 2)" in {
      val s = seedStandings(suffix = " pp")
      val json = s"""{"edits":[{"target":{"kind":"panel","parentId":"${s.dashboardId}"},"op":"create","patch":{"title":"T","type":"output","config":{"outputId":"${s.tableOutputId}"}}}]}"""
      previewError(owner, json) should include("patch.dashboardId")
    }

    "reject panel-level fieldMapping/aggregation instead of silently dropping them (taxonomy 1)" in {
      val s = seedStandings(suffix = " fm")
      val json = s"""{"edits":[{"target":{"kind":"panel"},"op":"create","patch":{"dashboardId":"${s.dashboardId}","title":"T","type":"output","config":{"outputId":"${s.tableOutputId}","fieldMapping":{"xAxis":"a"},"aggregation":{"agg":"sum"}}}}]}"""
      val msg = previewError(owner, json)
      msg should include("fieldMapping and aggregation")
      msg should include("chart shape belongs on the Output")
    }
  }

  "applying a set with an output create" should {
    "roll back both creates in order (panel before Output) when a LATER edit fails, and never trigger a backfill" in {
      val s = seedStandings(suffix = " rb")
      // Every call answers a completed Future; the invocations are what the test counts.
      val runs = mock(classOf[PipelineRunService], new Answer[AnyRef] {
        override def answer(invocation: InvocationOnMock): AnyRef = Future.successful(())
      })
      def backfills(): Int = mockingDetails(runs).getInvocations.asScala.count(_.getMethod.getName == "backfillOutputNode")
      val outputsWithBackfill = new OutputService(outputRepo, panelRepo, accessChecker, pipelineRunService = runs)
      val applying = new PatchSetApplyService(
        panelService, dashboardService, dataSourceService, pipelineService, panelRepo, dashboardRepo, dataSourceRepo,
        pipelineRepo, pipelineStepRepo, accessChecker, applicationRepo, outputRepo, outputsWithBackfill
      )
      val failing = chartAndPanel(s, s.computeStepId).stripSuffix("]}") +
        s""",{"target":{"kind":"dashboard","id":"${s.dashboardId}"},"op":"update","patch":{"name":""}}]}"""
      val before = outputsOf(s.pipelineId).size
      val response = await(applying.apply(patchSet(failing), owner)).getOrElse(fail("expected a Right with a failure"))
      response.failure shouldBe defined
      // If the Output were deleted first its cascade would take the panel with it and the panel's own compensation
      // would find nothing: this pins the reverse order.
      response.edits.map(_.status) shouldBe Vector("rolledBack", "rolledBack")
      outputsOf(s.pipelineId).size shouldBe before
      backfills() shouldBe 0

      val ok = await(applying.apply(patchSet(chartAndPanel(s, s.computeStepId)), owner)).getOrElse(fail("apply refused"))
      ok.failure shouldBe None
      // The backfill is fire-and-forget after the response, so wait for it (bounded).
      (1 to 40).takeWhile(_ => backfills() == 0).foreach(_ => Thread.sleep(50))
      backfills() shouldBe 1
    }
  }

  "an editor who does not own the pipeline's sources (3.5a)" should {
    "get the owner's view of the node schema, so display_name (from a source they cannot read) is not 'missing'" in {
      val s = seedStandings(suffix = " ed2")
      grantRole("pipeline", s.pipelineId, otherIdStr, "editor")
      grantRole("dashboard", s.dashboardId, otherIdStr, "editor")
      val preview = await(patchSetPreviewService.preview(patchSet(chartAndPanel(s, s.computeStepId)), otherUser))
      preview.isRight shouldBe true
      val response = await(patchSetApplyService.apply(patchSet(chartAndPanel(s, s.computeStepId)), otherUser)).getOrElse(fail("apply refused"))
      response.failure shouldBe None
    }

    "be refused when they only have viewer access" in {
      val s = seedStandings(suffix = " vw")
      grantRole("pipeline", s.pipelineId, otherIdStr, "viewer")
      await(patchSetPreviewService.preview(patchSet(chartAndPanel(s, s.computeStepId)), otherUser)) match {
        case Left(_: ServiceError.Forbidden) => succeed
        case other                           => fail(s"expected Forbidden, got $other")
      }
    }
  }

  "the node schema for an Output create (3.5a)" should {
    "keep a DISABLED step in the walk and treat it as transparent, as analyze does" in {
      val s = seedStandings(suffix = " ds")
      val pid = PipelineId(s.pipelineId)
      // disabled select: would drop display_name if it were applied; transparent means the Output still sees it
      val disabledSelect = await(pipelineService.addStep(pid, CreatePipelineStepRequest("select", JsObject("fields" -> JsArray(JsString("owner_id"))), enabled = Some(false), parentStepId = Some(s.computeStepId)), owner))
        .getOrElse(fail("select step failed"))
      val ok = chartAndPanel(s, disabledSelect.id)
      await(patchSetPreviewService.preview(patchSet(ok), owner)).isRight shouldBe true
      // an ENABLED select that drops display_name hides it
      val enabledSelect = await(pipelineService.addStep(pid, CreatePipelineStepRequest("select", JsObject("fields" -> JsArray(JsString("owner_id"))), parentStepId = Some(disabledSelect.id)), owner))
        .getOrElse(fail("select step failed"))
      previewError(owner, chartAndPanel(s, enabledSelect.id)) should include("display_name")
    }
  }
}
