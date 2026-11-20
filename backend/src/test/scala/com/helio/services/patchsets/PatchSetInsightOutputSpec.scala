package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.PatchSet
import com.helio.api.protocols.pipelines.CreateOutputRequest
import com.helio.domain.model.{AuthenticatedUser, OutputId, OutputKind, PipelineId}
import com.helio.testsupport.AssistantStandingsFixture
import spray.json._

/** HEL-1779: an `insight` Output in a patch set. Preview must reject anything apply would reject (output create AND
 *  output update, including a read of an Output the same set deletes), and a valid insight previews and applies with
 *  its kind and config stored.
 *
 *  RED on main (before the change): every test labelled RED. Probed finding: on main a patch-set create runs
 *  `OutputFieldMappingCheck`, whose new-pipeline rule refuses ANY `reads.outputs`, so a valid insight read is refused at
 *  preview although apply would accept it, and a bad id is refused with the wrong (node-suffixed) message. GUARDS (green on
 *  main, labelled as such): the valid reads-update test. */
class PatchSetInsightOutputSpec extends AssistantStandingsFixture {

  private def patchSet(json: String): PatchSet = json.parseJson.convertTo[PatchSet]

  private def previewError(user: AuthenticatedUser, json: String): String =
    await(patchSetPreviewService.preview(patchSet(json), user)) match {
      case Left(err) => err.message
      case Right(_)  => fail("expected the preview to be refused")
    }

  private def insightCreate(s: Standings, config: String, ref: String = "brief"): String =
    s"""{"target":{"kind":"output","parentId":"${s.pipelineId}","ref":"$ref"},"op":"create",
         "patch":{"name":"Brief","kind":"insight","nodeStepId":"${s.computeStepId}","config":$config}}"""

  private def seedInsight(s: Standings, config: String = """{"refresh":"manual"}"""): OutputId =
    await(outputService.create(
      PipelineId(s.pipelineId),
      CreateOutputRequest(Some(s.computeStepId), "insight", "Seed brief", Some(config.parseJson.asJsObject)),
      owner, backfill = false
    )).getOrElse(fail("seed insight failed"))._1.id

  "an insight output create" should {

    "RED: preview and apply a valid insight (refresh manual, reads a stored table Output), storing kind and config" in {
      val s = seedStandings(suffix = " ic")
      val cfg = s"""{"preset":"auto","prompt":"Summarise","refresh":"manual","reads":{"outputs":["${s.tableOutputId}"],"windows":["7d"]}}"""
      val json = s"""{"summary":"insight","edits":[${insightCreate(s, cfg)}]}"""
      await(patchSetPreviewService.preview(patchSet(json), owner)) match { case Left(e) => fail(s"preview refused: ${e.message}"); case Right(_) => }
      val response = await(patchSetApplyService.apply(patchSet(json), owner)).getOrElse(fail("apply refused"))
      response.failure shouldBe None
      val id = OutputId(response.edits.head.newId.getOrElse(fail("no output id")))
      await(outputRepo.findByIdInternal(id)).getOrElse(fail("missing")).kind shouldBe OutputKind.Insight
      val stored = await(outputRepo.findConfigById(id, owner)).get
      stored.fields("refresh") shouldBe JsString("manual")
      stored.fields("reads").asJsObject.fields("outputs") shouldBe JsArray(JsString(s.tableOutputId))
    }

    "RED: reject at preview a reads.outputs id that is not an Output of that pipeline" in {
      val s = seedStandings(suffix = " ib")
      val msg = previewError(owner, s"""{"edits":[${insightCreate(s, """{"refresh":"manual","reads":{"outputs":["no-such-output"]}}""")}]}""")
      msg should include("edit 0")
      msg should include("reads.outputs must name other non-insight Outputs of this pipeline")
      msg should include("no-such-output")
      // main refuses ANY reads.outputs here through OutputFieldMappingCheck's new-pipeline rule (it carries a "(node ...)"
      // suffix); the stored-id check must be the one that judges it.
      msg should not include "(node '"
    }

    "RED: reject at preview a reads.outputs id of an Output the same set deletes" in {
      val s = seedStandings(suffix = " id")
      val extra = await(outputService.create(
        PipelineId(s.pipelineId), CreateOutputRequest(Some(s.computeStepId), "table", "Extra", None), owner, backfill = false
      )).getOrElse(fail("seed table failed"))._1.id
      val json =
        s"""{"edits":[
          {"target":{"kind":"output","id":"${extra.value}"},"op":"delete"},
          ${insightCreate(s, s"""{"refresh":"manual","reads":{"outputs":["${extra.value}"]}}""")}
        ]}"""
      val msg = previewError(owner, json)
      msg should include("reads.outputs must name other non-insight Outputs of this pipeline")
      msg should include(extra.value)
      msg should not include "(node '"
    }
  }

  "an insight output update" should {
    "RED: reject at preview a reads.outputs id that is not an Output of that pipeline" in {
      val s = seedStandings(suffix = " iu")
      val id = seedInsight(s)
      val json = s"""{"edits":[{"target":{"kind":"output","id":"${id.value}"},"op":"update","patch":{"config":{"reads":{"outputs":["no-such-output"]}}}}]}"""
      val msg = previewError(owner, json)
      msg should include("edit 0")
      msg should include("reads.outputs must name other non-insight Outputs of this pipeline")
    }

    "GUARD: preview and apply a valid reads update" in {
      val s = seedStandings(suffix = " iv")
      val id = seedInsight(s)
      val json = s"""{"edits":[{"target":{"kind":"output","id":"${id.value}"},"op":"update","patch":{"config":{"reads":{"outputs":["${s.tableOutputId}"]}}}}]}"""
      await(patchSetPreviewService.preview(patchSet(json), owner)).isRight shouldBe true
      await(patchSetApplyService.apply(patchSet(json), owner)).getOrElse(fail("apply refused")).failure shouldBe None
    }

    "GUARD: reject at preview an out-of-range insight config value (already green on main: the preview projection validates the update)" in {
      val s = seedStandings(suffix = " ir")
      val id = seedInsight(s)
      val json = s"""{"edits":[{"target":{"kind":"output","id":"${id.value}"},"op":"update","patch":{"config":{"maxSentences":99}}}]}"""
      previewError(owner, json) should include("maxSentences must be a whole number from 1 to 6")
    }
  }
}
