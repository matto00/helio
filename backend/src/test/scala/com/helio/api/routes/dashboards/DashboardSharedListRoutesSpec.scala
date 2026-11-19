package com.helio.api.routes.dashboards

import com.helio.domain.model.{DashboardId, UserId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1773: `GET /api/dashboards?include=shared` lists owned + named-grant dashboards with the caller's `accessRole`,
 *  on the NOBYPASSRLS app pool (`helio_app_test`), and the RLS facts the client routing rests on, each statement
 *  labelled with the role it ran as (`[HEL-1773 RLS]` lines; captured to `.concertino/scratch/HEL-1773/rls-helio-app.txt`).
 *
 *  User roles in these specs: A owns, B and C are the grantees/strangers per case. */
class DashboardSharedListRoutesSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures {

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private val dashboardSchema = JsonSchemaValidation.compile("dashboards/dashboard.schema.json")

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE dashboards, pipelines, data_sources, resource_permissions CASCADE"))

  private def grant(dashboardId: String, grantee: Option[String], role: String): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashboardId, ${grantee}::uuid, $role, now())"""
    ))

  private def touch(dashboardId: String, secondsAgo: Int): Unit =
    await(privilegedDb.run(sqlu"UPDATE dashboards SET last_updated = now() - make_interval(secs => $secondsAgo) WHERE id = $dashboardId"))

  private def seedOutputPanel(dashboardId: String, owner: String, outputId: String): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($id, $dashboardId, 'P', $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', $outputId, $owner::uuid)"""
    ))
    id
  }

  private def list(user: String, query: String = ""): (StatusCodes.Success, JsObject) =
    req(HttpMethods.GET, s"/api/dashboards$query", user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      (status.asInstanceOf[StatusCodes.Success], responseAs[String].parseJson.asJsObject)
    }

  private def items(body: JsObject): Vector[JsObject] =
    body.fields("items").asInstanceOf[JsArray].elements.map(_.asJsObject)

  private def roles(body: JsObject): Map[String, Option[String]] =
    items(body).map(o => o.fields("name").convertTo[String] -> o.fields.get("accessRole").map(_.convertTo[String])).toMap

  "GET /api/dashboards?include=shared" should {

    "list owned and named-grant dashboards with the caller's accessRole, never a public-only or ungranted one" in {
      reset()
      seedDashboard(userB, "B owned")
      val viewerDash = seedDashboard(userA, "A to B viewer")
      val editorDash = seedDashboard(userA, "A to B editor")
      val publicOnly = seedDashboard(userA, "A public only")
      seedDashboard(userA, "A private")
      val toC = seedDashboard(userA, "A to C viewer")
      grant(viewerDash, Some(userB), "viewer")
      grant(editorDash, Some(userB), "editor")
      grant(publicOnly, None, "viewer")
      grant(toC, Some(userC), "viewer")

      val (_, body) = list(userB, "?include=shared")
      roles(body) shouldBe Map(
        "B owned"       -> Some("owner"),
        "A to B viewer" -> Some("viewer"),
        "A to B editor" -> Some("editor")
      )
      body.fields("total").convertTo[Int] shouldBe 3
    }

    "list a dashboard once, as owner, when its owner also holds a grant row on it" in {
      reset()
      val own = seedDashboard(userA, "A self-granted")
      grant(own, Some(userA), "viewer")
      val (_, body) = list(userA, "?include=shared")
      items(body).size shouldBe 1
      roles(body) shouldBe Map("A self-granted" -> Some("owner"))
      body.fields("total").convertTo[Int] shouldBe 1
    }

    "page and count over the owned + granted union, newest first" in {
      reset()
      val d1 = seedDashboard(userB, "B owned")
      val d2 = seedDashboard(userA, "A shared 1")
      val d3 = seedDashboard(userA, "A shared 2")
      grant(d2, Some(userB), "viewer")
      grant(d3, Some(userB), "editor")
      touch(d1, 30); touch(d2, 20); touch(d3, 10)

      val (_, first) = list(userB, "?include=shared&limit=2&offset=0")
      items(first).map(_.fields("name").convertTo[String]) shouldBe Vector("A shared 2", "A shared 1")
      first.fields("total").convertTo[Int] shouldBe 3
      val (_, second) = list(userB, "?include=shared&limit=2&offset=2")
      items(second).map(_.fields("name").convertTo[String]) shouldBe Vector("B owned")
      second.fields("total").convertTo[Int] shouldBe 3
    }

    "return 400 for an unknown include value" in {
      req(HttpMethods.GET, "/api/dashboards?include=everything", userB) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "put an accessRole on the wire that validates against the dashboard schema (seam)" in {
      reset()
      val shared = seedDashboard(userA, "A to B")
      grant(shared, Some(userB), "viewer")
      val (_, body) = list(userB, "?include=shared")
      items(body) should not be empty
      items(body).foreach { item =>
        val errors = JsonSchemaValidation.validationErrors(dashboardSchema, item.compactPrint)
        withClue(s"${item.compactPrint}: ") { errors shouldBe empty }
      }
    }
  }

  "GET /api/dashboards without include" should {
    "stay owner-only, every item marked owner" in {
      reset()
      seedDashboard(userB, "B owned")
      val shared = seedDashboard(userA, "A to B")
      grant(shared, Some(userB), "editor")
      val (_, body) = list(userB)
      roles(body) shouldBe Map("B owned" -> Some("owner"))
    }
  }

  "the RLS facts behind the client's routing" should {
    "hold as the NOBYPASSRLS app role, labelled by role" in {
      reset()
      val (_, outputId) = seedPipelineWithOutput(userA)
      val dash  = seedDashboard(userA, "Shared board")
      val panel = seedOutputPanel(dash, userA, outputId)
      grant(dash, Some(userB), "viewer")
      grant(dash, Some(userC), "editor")
      def log(line: String): Unit = println(s"[HEL-1773 RLS] $line")

      // (1) The visible-list query as helio_app_test (NOBYPASSRLS), per user.
      val viewerList   = items(list(userB, "?include=shared")._2).map(_.fields("name").convertTo[String])
      val editorList   = items(list(userC, "?include=shared")._2).map(_.fields("name").convertTo[String])
      val ownerList    = items(list(userA, "?include=shared")._2).map(_.fields("name").convertTo[String])
      log(s"(1) role=helio_app_test list include=shared viewer=$viewerList editor=$editorList owner=$ownerList")
      viewerList shouldBe Vector("Shared board")
      editorList shouldBe Vector("Shared board")
      ownerList shouldBe Vector("Shared board")

      // (2) pipelineFedDashboardIds for the shared id as the viewer (panels_select is grant-aware), helio_app_test.
      val fed = await(new DashboardRepository(ctx)(ExecutionContext.global)
        .pipelineFedDashboardIds(UserId(userB), Vector(DashboardId(dash))))
      log(s"(2) role=helio_app_test viewer pipelineFedDashboardIds=${fed.map(_.value)}")
      fed.map(_.value) shouldBe Set(dash)

      // (3) the bound Output row itself, as the dashboard-only viewer and editor (helio_app_test): 0 rows, which is why
      //     the client never calls /api/outputs/* for a non-owner. The owner of the pipeline sees 1.
      def outputRows(user: String): Int =
        await(ctx.withUserContext(user)(sql"SELECT count(*) FROM outputs WHERE id = $outputId".as[Int].head))
      val (v, e, o) = (outputRows(userB), outputRows(userC), outputRows(userA))
      log(s"(3) role=helio_app_test SELECT outputs WHERE id=<bound output>: viewer=$v editor=$e pipeline-owner=$o")
      v shouldBe 0
      e shouldBe 0
      o shouldBe 1

      // (4a) The per-panel route's gate (authorizeResourceWithSharing; its lookups run as helio_privileged):
      //      the named grant admits viewer and editor, a stranger gets 404.
      def statusOf(user: String, path: String) =
        req(HttpMethods.GET, path, user) ~> routes ~> check { (response.status, responseAs[String]) }
      val rowsPath = s"/api/dashboards/$dash/panels/$panel/rows"
      val metaPath = s"/api/dashboards/$dash/panels/$panel/output-meta"
      val statuses = Seq(userB -> "viewer", userC -> "editor", userA -> "owner").map { case (u, r) =>
        r -> (statusOf(u, rowsPath)._1.intValue, statusOf(u, metaPath)._1.intValue)
      }
      val strangerStatus = {
        // the fixture seeds three users; a user with no grant on this dashboard is any of them before the grant exists
        val lone = seedDashboard(userA, "Lonely"); val lonePanel = seedOutputPanel(lone, userA, outputId)
        (statusOf(userB, s"/api/dashboards/$lone/panels/$lonePanel/rows")._1.intValue,
         statusOf(userB, s"/api/dashboards/$lone/panels/$lonePanel/output-meta")._1.intValue)
      }
      log(s"(4a) GET per-panel rows / output-meta through the helio_app_test route tree (data reads as helio_privileged): " +
        s"${statuses.map { case (r, (a, b)) => s"$r=$a/$b" }.mkString(" ")} stranger=${strangerStatus._1}/${strangerStatus._2}")
      statuses.foreach { case (_, (a, b)) => (a, b) shouldBe ((200, 200)) }
      strangerStatus shouldBe ((404, 404))

      // (4b) The data statements of that route as helio_privileged (BYPASSRLS): the Output row is visible.
      val privOutputs = await(privilegedDb.run(sql"SELECT count(*) FROM outputs WHERE id = $outputId".as[Int].head))
      log(s"(4b) role=helio_privileged SELECT outputs WHERE id=<bound output>: rows=$privOutputs")
      privOutputs shouldBe 1
    }
  }
}
