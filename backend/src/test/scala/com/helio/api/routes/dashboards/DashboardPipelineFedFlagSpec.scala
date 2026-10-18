package com.helio.api.routes.dashboards

import com.helio.testsupport.{OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID

/** HEL-1646: `GET /api/dashboards` carries `hasPipelineFedPanels` (list route only), on the NOBYPASSRLS app pool. */
class DashboardPipelineFedFlagSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures {

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private def seedPanel(dashboardId: String, owner: String, kind: String, outputId: Option[String]): Unit = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($id, $dashboardId, 'P', $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', $kind, $outputId, $owner::uuid)"""
    ))
  }

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE dashboards, pipelines, data_sources, resource_permissions CASCADE"))

  private def listFlags(user: String): Map[String, Option[JsValue]] =
    req(HttpMethods.GET, "/api/dashboards", user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("items").asInstanceOf[JsArray].elements.map { e =>
        val o = e.asJsObject
        o.fields("name").convertTo[String] -> o.fields.get("hasPipelineFedPanels")
      }.toMap
    }

  "GET /api/dashboards" should {

    "flag exactly the dashboards with a bound output panel" in {
      reset()
      val (_, o1) = seedPipelineWithOutput(userA)
      val fed       = seedDashboard(userA, "Fed")
      val markdown  = seedDashboard(userA, "Markdown")
      val form      = seedDashboard(userA, "Form")
      seedDashboard(userA, "Empty")
      val mixed     = seedDashboard(userA, "Mixed")
      seedPanel(fed, userA, "output", Some(o1))
      seedPanel(markdown, userA, "text", None)
      seedPanel(form, userA, "form", None)
      seedPanel(mixed, userA, "text", None)
      seedPanel(mixed, userA, "output", Some(o1))

      listFlags(userA) shouldBe Map(
        "Fed"      -> Some(JsTrue),
        "Markdown" -> Some(JsFalse),
        "Form"     -> Some(JsFalse),
        "Empty"    -> Some(JsFalse),
        "Mixed"    -> Some(JsTrue)
      )
    }

    "not report another user's panels" in {
      reset()
      val (_, o1) = seedPipelineWithOutput(userA)
      val a = seedDashboard(userA, "A")
      seedDashboard(userB, "B")
      seedPanel(a, userA, "output", Some(o1))
      listFlags(userB) shouldBe Map("B" -> Some(JsFalse))
    }

    "omit the flag on create and rename responses" in {
      reset()
      val created = req(HttpMethods.POST, "/api/dashboards", userA, Some("""{"name":"Fresh"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject
      }
      created.fields.contains("hasPipelineFedPanels") shouldBe false
      val id = created.fields("id").convertTo[String]
      req(HttpMethods.PATCH, s"/api/dashboards/$id", userA, Some("""{"name":"Renamed"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields.contains("hasPipelineFedPanels") shouldBe false
      }
    }
  }
}
