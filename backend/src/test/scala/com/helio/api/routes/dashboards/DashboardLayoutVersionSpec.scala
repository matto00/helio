package com.helio.api.routes.dashboards

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1457: the `layoutVersion` wire field, what moves it, and the 400 / 409 contract of `expectedLayoutVersion`. */
class DashboardLayoutVersionSpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private def dashboardJson(id: String): JsObject =
    send(Get("/api/dashboards?limit=500")) {
      responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]].find(_.fields("id") == JsString(id)).get
    }

  private def versionOf(id: String): Long = dashboardJson(id).fields("layoutVersion").convertTo[Long]

  private def lgItem(id: String, panelId: String): JsObject = itemsOf(id, "lg").find(_.fields("panelId") == JsString(panelId)).get

  private def movedLg(id: String, panelId: String, y: Int): String = {
    val i = lgItem(id, panelId).fields
    s"""{"panelId":"$panelId","x":${i("x")},"y":$y,"w":${i("w")},"h":${i("h")}}"""
  }

  private def patchLg(id: String, panelId: String, y: Int, extra: String) =
    Patch(s"/api/dashboards/$id", json(s"""{"layout":{"lg":[${movedLg(id, panelId, y)}]}$extra}"""))

  private def superuserExec(sql: String): Unit = {
    val c = superuserConnection()
    try { val st = c.createStatement(); try st.execute(sql) finally st.close() } finally c.close()
  }

  "layoutVersion" should {
    "start at 0 on a created dashboard and appear on every authenticated dashboard response" in {
      val d = createDashboard("ver-start")
      versionOf(d) shouldBe 0L
    }

    "increase when a panel is created or deleted, and stay put on a rename or an appearance change" in {
      val d      = createDashboard("ver-moves")
      val before = versionOf(d)
      val p      = createPanel(d)
      val afterCreate = versionOf(d)
      afterCreate should be > before

      send(Patch(s"/api/dashboards/$d", json("""{"name":"ver-moves-renamed"}"""))) { status shouldBe StatusCodes.OK }
      send(Patch(s"/api/dashboards/$d", json("""{"appearance":{"background":"transparent","gridBackground":"transparent"}}"""))) { status shouldBe StatusCodes.OK }
      versionOf(d) shouldBe afterCreate

      deleteOk(s"/api/panels/$p")
      versionOf(d) should be > afterCreate
    }

    "not be settable by writing it with an unchanged layout" in {
      val d = createDashboard("ver-unforgeable")
      createPanel(d)
      val v = versionOf(d)
      superuserExec(s"UPDATE dashboards SET layout_version = 999 WHERE id = '$d'")
      versionOf(d) shouldBe v
    }

    "be 0 on a duplicate and on an import of a dashboard whose own version is above 0" in {
      val d = createDashboard("ver-copy")
      createPanel(d)
      versionOf(d) should be > 0L
      val copyId = send(Post(s"/api/dashboards/$d/duplicate")) {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("id").convertTo[String]
      }
      versionOf(copyId) shouldBe 0L
      val exported = send(Get(s"/api/dashboards/$d/export")) { status shouldBe StatusCodes.OK; responseAs[String] }
      val importedId = send(Post("/api/dashboards/import", json(exported))) {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject.fields("dashboard").asJsObject.fields("id").convertTo[String]
      }
      versionOf(importedId) shouldBe 0L
    }
  }

  "a layout PATCH with expectedLayoutVersion" should {
    "save when the version matches, and answer with a greater layoutVersion" in {
      val d = createDashboard("ver-match")
      val p = createPanel(d)
      val n = versionOf(d)
      send(patchLg(d, p, 40, s""","expectedLayoutVersion":$n""")) {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("layoutVersion").convertTo[Long] should be > n
      }
      lgItem(d, p).fields("y") shouldBe JsNumber(40)
    }

    "answer 409 with the current dashboard, and write nothing, not even a name sent with it" in {
      val d  = createDashboard("ver-stale")
      val p1 = createPanel(d)
      val n  = versionOf(d)
      val p2 = createPanel(d)
      val body = s"""{"name":"must-not-land","layout":{"lg":[${movedLg(d, p1, 40)}]},"expectedLayoutVersion":$n}"""
      send(Patch(s"/api/dashboards/$d", json(body))) {
        status shouldBe StatusCodes.Conflict
        val fields = responseAs[String].parseJson.asJsObject.fields
        fields("message").convertTo[String] should include("layout was changed elsewhere")
        val current = fields("dashboard").asJsObject
        current.fields("layoutVersion").convertTo[Long] shouldBe versionOf(d)
        current.fields("layout").asJsObject.fields("lg").convertTo[Vector[JsObject]].map(_.fields("panelId").convertTo[String]) should contain(p2)
        current.fields("name") shouldBe JsString("ver-stale")
      }
      dashboardJson(d).fields("name") shouldBe JsString("ver-stale")
      lgItem(d, p1).fields("y") should not be JsNumber(40)
    }

    "answer 409 on the batch /update route too" in {
      val d  = createDashboard("ver-stale-batch")
      val p1 = createPanel(d)
      val n  = versionOf(d)
      createPanel(d)
      val body = s"""{"fields":["layout"],"dashboard":{"layout":{"lg":[${movedLg(d, p1, 40)}]},"expectedLayoutVersion":$n}}"""
      send(Patch(s"/api/dashboards/$d/update", json(body))) { status shouldBe StatusCodes.Conflict }
    }

    "answer 400 without a layout, and for a negative version" in {
      val d = createDashboard("ver-400")
      val p = createPanel(d)
      send(Patch(s"/api/dashboards/$d", json("""{"name":"x","expectedLayoutVersion":0}"""))) { status shouldBe StatusCodes.BadRequest }
      send(patchLg(d, p, 40, ""","expectedLayoutVersion":-1""")) { status shouldBe StatusCodes.BadRequest }
      dashboardJson(d).fields("name") shouldBe JsString("ver-400")
    }
  }

  "a PATCH that supplies only some fields" should {
    "leave the layout, and its version, alone when it sends only an appearance" in {
      val d = createDashboard("ver-fields")
      createPanel(d)
      val v      = versionOf(d)
      val layout = itemsOf(d, "lg")
      send(Patch(s"/api/dashboards/$d", json("""{"appearance":{"background":"#112233","gridBackground":"transparent"}}"""))) { status shouldBe StatusCodes.OK }
      itemsOf(d, "lg") shouldBe layout
      versionOf(d) shouldBe v
    }
  }

  "auto-layout with expectedLayoutVersion" should {
    "pack when the version matches and answer 409 when it is stale" in {
      val d  = createDashboard("ver-auto")
      val p1 = createPanel(d)
      val n  = versionOf(d)
      val body = (v: Long) => s"""{"items":[{"panelId":"$p1","w":6,"h":4}],"expectedLayoutVersion":$v}"""
      send(Post(s"/api/dashboards/$d/auto-layout", json(body(n)))) {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("layoutVersion").convertTo[Long] should be >= n
      }
      createPanel(d)
      send(Post(s"/api/dashboards/$d/auto-layout", json(body(n)))) { status shouldBe StatusCodes.Conflict }
    }
  }
}
