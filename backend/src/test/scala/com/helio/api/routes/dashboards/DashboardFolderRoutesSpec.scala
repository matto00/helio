package com.helio.api.routes.dashboards

import com.helio.testsupport.TwoUserRlsApiFixture
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

/** HEL-1574: `/api/dashboard-folders` CRUD and `PUT /api/dashboards/:id/folder` over a non-BYPASSRLS app pool. */
class DashboardFolderRoutesSpec extends TwoUserRlsApiFixture {

  private def body: JsObject = responseAs[String].parseJson.asJsObject

  private def create(user: String, name: String): String =
    req(HttpMethods.POST, "/api/dashboard-folders", user, Some(s"""{"name":${JsString(name)}}""")) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      body.fields("id").convertTo[String]
    }

  private def list(user: String): JsObject =
    req(HttpMethods.GET, "/api/dashboard-folders", user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      body
    }

  private def folderNames(user: String): Vector[String] =
    list(user).fields("folders").convertTo[Vector[JsObject]].map(_.fields("name").convertTo[String])

  private def assignments(user: String): Map[String, String] =
    list(user).fields("assignments").convertTo[Vector[JsObject]]
      .map(a => a.fields("dashboardId").convertTo[String] -> a.fields("folderId").convertTo[String]).toMap

  private def move(user: String, dashboardId: String, folderId: Option[String]) =
    req(HttpMethods.PUT, s"/api/dashboards/$dashboardId/folder", user, Some(s"""{"folderId":${folderId.fold("null")(f => s""""$f"""")}}"""))

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE dashboard_folders, dashboards CASCADE"))

  "dashboard folders" should {

    "create, rename and list a folder, newest last, trimming the name" in {
      reset()
      val a = create(userA, "  Daily ")
      create(userA, "Work")
      folderNames(userA) shouldBe Vector("Daily", "Work")
      req(HttpMethods.PATCH, s"/api/dashboard-folders/$a", userA, Some("""{"name":"Morning"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        body.fields("name") shouldBe JsString("Morning")
      }
      folderNames(userA) shouldBe Vector("Morning", "Work")
    }

    "reject a case-insensitive duplicate with 409 and create nothing" in {
      reset()
      create(userA, "Daily")
      req(HttpMethods.POST, "/api/dashboard-folders", userA, Some("""{"name":"daily"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Conflict
      }
      folderNames(userA) shouldBe Vector("Daily")
      // The same name is free for another user.
      create(userB, "Daily")
    }

    "reject invalid names with 400 and renaming onto an existing name with 409" in {
      reset()
      val a = create(userA, "A")
      create(userA, "B")
      for (bad <- Seq("", "   ", "x" * 81))
        req(HttpMethods.POST, "/api/dashboard-folders", userA, Some(s"""{"name":${JsString(bad)}}""")) ~> routes ~> check {
          status shouldBe StatusCodes.BadRequest
        }
      req(HttpMethods.PATCH, s"/api/dashboard-folders/$a", userA, Some("""{"name":"b"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Conflict
      }
      req(HttpMethods.PATCH, s"/api/dashboard-folders/$a", userA, Some("""{}""")) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "persist the collapsed flag" in {
      reset()
      val a = create(userA, "Work")
      req(HttpMethods.PATCH, s"/api/dashboard-folders/$a", userA, Some("""{"collapsed":true}""")) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        body.fields("collapsed") shouldBe JsBoolean(true)
      }
      list(userA).fields("folders").convertTo[Vector[JsObject]].head.fields("collapsed") shouldBe JsBoolean(true)
    }

    "return 404 for an unknown folder id and for another user's folder, and never expose it" in {
      reset()
      val a = create(userA, "Private")
      folderNames(userB) shouldBe Vector.empty
      req(HttpMethods.PATCH, s"/api/dashboard-folders/$a", userB, Some("""{"name":"hijack"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
      req(HttpMethods.DELETE, s"/api/dashboard-folders/$a", userB) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      req(HttpMethods.DELETE, "/api/dashboard-folders/not-a-uuid", userA) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      folderNames(userA) shouldBe Vector("Private")
    }

    "move a dashboard between folders, and unfile it" in {
      reset()
      val d     = seedDashboard(userA, "D1")
      val daily = create(userA, "Daily")
      val work  = create(userA, "Work")
      move(userA, d, Some(daily)) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      assignments(userA) shouldBe Map(d -> daily)
      move(userA, d, Some(work)) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      assignments(userA) shouldBe Map(d -> work)
      move(userA, d, None) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      assignments(userA) shouldBe Map.empty
    }

    "reject filing into another user's folder or an unknown folder with 404, and a missing key with 400" in {
      reset()
      val d      = seedDashboard(userA, "D1")
      val others = create(userB, "Theirs")
      move(userA, d, Some(others)) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      move(userA, d, Some("00000000-0000-0000-0000-000000000099")) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      req(HttpMethods.PUT, s"/api/dashboards/$d/folder", userA, Some("{}")) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      req(HttpMethods.PUT, s"/api/dashboards/$d/folder", userA, Some("""{"folderId":5}""")) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      assignments(userA) shouldBe Map.empty
    }

    "return 404 when filing a dashboard the caller cannot access" in {
      reset()
      val d = seedDashboard(userA, "Not yours")
      val f = create(userB, "Mine")
      move(userB, d, Some(f)) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      assignments(userB) shouldBe Map.empty
    }

    "let a viewer grantee file a shared dashboard without touching the owner's folders or the grant" in {
      reset()
      val d = seedDashboard(userA, "Shared")
      val ownerFolder = create(userA, "Owner folder")
      move(userA, d, Some(ownerFolder)) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      await(privilegedDb.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $d, $userB::uuid, 'viewer', now())"""
      ))
      val mine = create(userB, "Mine")
      move(userB, d, Some(mine)) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      assignments(userB) shouldBe Map(d -> mine)
      assignments(userA) shouldBe Map(d -> ownerFolder)
      await(privilegedDb.run(sql"SELECT count(*) FROM resource_permissions WHERE resource_id = $d".as[Int].head)) shouldBe 1
      // Revoking the grant: the filing stops appearing for the grantee.
      await(privilegedDb.run(sqlu"DELETE FROM resource_permissions WHERE resource_id = $d"))
      assignments(userB) shouldBe Map.empty
    }

    "delete a folder, unfiling its dashboards but keeping them" in {
      reset()
      val d1 = seedDashboard(userA, "D1")
      val d2 = seedDashboard(userA, "D2")
      val f  = create(userA, "Gone")
      move(userA, d1, Some(f)) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      move(userA, d2, Some(f)) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      req(HttpMethods.DELETE, s"/api/dashboard-folders/$f", userA) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      folderNames(userA) shouldBe Vector.empty
      assignments(userA) shouldBe Map.empty
      await(privilegedDb.run(sql"SELECT count(*) FROM dashboards WHERE id IN ($d1, $d2)".as[Int].head)) shouldBe 2
    }

    "cascade filings when the dashboard is deleted" in {
      reset()
      val d = seedDashboard(userA, "Temp")
      val f = create(userA, "F")
      move(userA, d, Some(f)) ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      await(privilegedDb.run(sqlu"DELETE FROM dashboards WHERE id = $d"))
      await(privilegedDb.run(sql"SELECT count(*) FROM dashboard_folder_assignments".as[Int].head)) shouldBe 0
    }
  }
}
