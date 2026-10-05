package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.sql.DriverManager
import java.util.UUID

/** HEL-1265: `POST /api/pipelines/apply-proposal` funnels an `upsertsource` step through the same
 *  save-time target check as the step routes, and a refusal rolls the whole apply back. */
class PipelineApplyProposalUpsertTargetSpec extends PipelineApplyProposalSpecBase {

  private def seedSourceRow(kind: String): (String, String) = {
    val id   = UUID.randomUUID().toString
    val name = s"upsert-target-$kind-$id"
    val conn = DriverManager.getConnection(s"jdbc:postgresql://localhost:$sqlPort/postgres", "postgres", "postgres")
    try {
      val st = conn.prepareStatement(
        s"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
           |VALUES (?, ?, ?, ?::jsonb, ?::uuid, now(), now())""".stripMargin
      )
      st.setString(1, id); st.setString(2, name); st.setString(3, kind)
      st.setString(4, if (kind == "csv") """{"path":"csv/x.csv"}""" else "{}")
      st.setString(5, userId)
      st.executeUpdate(); st.close()
    } finally conn.close()
    (id, name)
  }

  private def proposalWithUpsertTarget(targetId: String): String =
    s"""{"pipelineName":"Upsert Target Pipeline","roots":[{"sourceId":"$existingSourceId"}],
       |"steps":[{"clientId":"u1","type":"upsertsource","config":
       |{"target":{"kind":"existingSource","dataSourceId":"$targetId"},"mode":"append"}}]}""".stripMargin

  "POST /api/pipelines/apply-proposal with an upsertsource step" should {

    "reject a CSV target with a 422 naming it, creating nothing" in {
      val (csvId, csvName) = seedSourceRow("csv")
      val before = dataSourceCount() + pipelineCount() + pipelineStepCount()
      apply(proposalWithUpsertTarget(csvId)) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should (include(csvId) and include(csvName))
      }
      dataSourceCount() + pipelineCount() + pipelineStepCount() shouldBe before
    }

    "accept a dataset target" in {
      val (dsId, _) = seedSourceRow("dataset")
      apply(proposalWithUpsertTarget(dsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
    }
  }
}
