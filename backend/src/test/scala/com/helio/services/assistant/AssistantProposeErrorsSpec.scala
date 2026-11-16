package com.helio.services.assistant

import com.helio.api.protocols.assistant.AssistantProtocol
import com.helio.testsupport.AssistantStandingsFixture
import spray.json._

/** HEL-1639 D3/D4 (task 3.3): the transcript's failing `propose_*` calls, replayed through the real executor on the
 *  Standings fixture, now fail (or pass) with errors that name the fix. */
class AssistantProposeErrorsSpec extends AssistantStandingsFixture {

  private lazy val st = seedStandings()

  private def run(tool: String, input: String): Either[String, String] = await(newExecutor().execute(tool, input.parseJson))

  private def pipelineWith(stepsJson: String, root: String): String =
    s"""{"pipelineName":"P","roots":[{"sourceId":"$root"}],"steps":[$stepsJson],"outputs":[]}"""

  private def errorOf(tool: String, input: String): String =
    run(tool, input) match {
      case Left(err) => err
      case Right(ok) => fail(s"expected an error, got: ${ok.take(200)}")
    }

  "propose_pipeline" should {
    "reject an unknown step type (passthrough) listing only the valid, authorable ones" in {
      val err = errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"passthrough","config":{}}""", st.rostersSourceId))
      err should include("invalid type 'passthrough'")
      err should include("Valid step types:")
      err should include("lookup")
      err should include("compute")
      err should not include "groupby" // legacy, not authorable
    }

    "reject an empty lookup config naming the missing keys (taxonomy 3)" in {
      val err = errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"lookup","config":{}}""", st.rostersSourceId))
      err should include("step 1 ('lookup')")
      err should include("secondaryInput")
      err should include("sourceKey")
      err should include("lookupKey")
    }

    "reject an aggregate with no aggregations and a select with no fields" in {
      errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"aggregate","config":{}}""", st.rostersSourceId)) should include("aggregations")
      errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"select","config":{}}""", st.rostersSourceId)) should include("fields")
    }

    "reject the invented compute grammars the model tried" in {
      errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"compute","config":{"column":"x","expression":"record.settings.fpts_decimal"}}""", st.rostersSourceId)) should include("compute")
      errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"compute","config":{"column":"x","expression":"'settings.fpts_decimal'"}}""", st.rostersSourceId)) should include("invalid expression")
    }

    "accept a complete lookup + compute proposal built from the transcript's real columns" in {
      val steps =
        s"""{"clientId":"lk","type":"lookup","config":{"secondaryInput":{"kind":"source","dataSourceId":"${st.usersSourceId}"},"sourceKey":"owner_id","lookupKey":"user_id","columns":["display_name"]}},""" +
          """{"clientId":"pf","type":"compute","parentStepId":"lk","config":{"column":"points_for","expression":"round($settings.fpts + $settings.fpts_decimal / 100, 2)"}}"""
      run("propose_pipeline", pipelineWith(steps, st.rostersSourceId)).isRight shouldBe true
    }

    "tell the model an Output id is not a data source and name the pipeline to extend (taxonomy 5)" in {
      val err = errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"select","config":{"fields":["display_name"]}}""", st.tableOutputId))
      err should include("is an Output, not a data source")
      err should include(st.pipelineId)
      err should include("propose_patch_set")
    }

    "not reveal another tenant's Output: an Output the caller cannot read is just an unknown data source" in {
      val foreign = seedStandings(otherUser, suffix = " (other)")
      val err = errorOf("propose_pipeline", pipelineWith("""{"clientId":"s1","type":"select","config":{"fields":["a"]}}""", foreign.tableOutputId))
      err should include("data source not found")
      err should not include "is an Output"
    }

    "give the Output-as-root hint to a pipeline grantee who can read the Output, and only to them" in {
      val shared = seedStandings(suffix = " grant")
      val input = pipelineWith("""{"clientId":"s1","type":"select","config":{"fields":["a"]}}""", shared.tableOutputId)
      def asOther: String = await(newExecutor(otherUser).execute("propose_pipeline", input.parseJson)).left.getOrElse(fail("expected an error"))
      asOther should include("data source not found")
      grantRole("pipeline", shared.pipelineId, otherIdStr, "viewer")
      asOther should include("is an Output, not a data source")
    }

    "keep the root-shape error for sourceId plus type clear" in {
      errorOf("propose_pipeline", s"""{"pipelineName":"P","roots":[{"sourceId":"${st.rostersSourceId}","type":"dataset"}],"steps":[],"outputs":[]}""") should include("either sourceId or an inline type, not both")
    }
  }

  "propose_dashboard" should {
    "still validate a proposal that reuses an existing dashboard's name (it proposes a NEW dashboard, which the tool description now says)" in {
      run("propose_dashboard", s"""{"dashboardName":"Standings","panels":[{"title":"T","type":"output","outputId":"${st.tableOutputId}"}]}""").isRight shouldBe true
      val description = AssistantProtocol.assistantTools.find(_.name == "propose_dashboard").get.description
      description should include("ALWAYS creates a new dashboard")
      description should include("propose_patch_set")
    }
  }
}
