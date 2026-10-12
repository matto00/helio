package com.helio.api.routes.dashboards

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import spray.json._

import java.sql.Connection
import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/** HEL-1457: layout writers must not overwrite a layout they did not read, nor revert a concurrent rename.
 *
 *  The interleave is real, not simulated: a second superuser transaction holds the dashboard row lock, the route
 *  request runs on the NOSUPERUSER / NOBYPASSRLS app pool (the `ApplyProposalSpecBase` harness), and the second
 *  transaction commits only after `pg_stat_activity` shows the request's backend waiting on a `Lock`. By then the
 *  request has read and resolved against the pre-commit row, which is the race. */
class DashboardLayoutConcurrencySpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private def exec(c: Connection, sql: String): Unit = { val st = c.createStatement(); try st.execute(sql) finally st.close() }

  private def scalar(c: Connection, sql: String): String = {
    val st = c.createStatement()
    try { val rs = st.executeQuery(sql); rs.next(); rs.getString(1) } finally st.close()
  }

  private def awaitRequestLockWait(holderPid: String): Unit = {
    val observer = superuserConnection()
    val deadline = System.nanoTime() + 20.seconds.toNanos
    try while (scalar(observer,
        s"""SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres' AND wait_event_type = 'Lock'
           |AND pid <> $holderPid AND pid <> pg_backend_pid()""".stripMargin).toInt == 0) {
        require(System.nanoTime() < deadline, "the request never waited on the dashboard row lock: the interleave did not form")
        Thread.sleep(20)
      }
    finally observer.close()
  }

  /** Holds the dashboard row lock, starts `request`, waits for it to block, runs `competing` in the lock-holding
   *  transaction, commits, and returns the request's status and body. */
  private def raceWith(dashboardId: String, request: HttpRequest)(competing: Connection => Unit): (Int, String) = {
    val holder = superuserConnection()
    try {
      holder.setAutoCommit(false)
      exec(holder, s"SELECT id FROM dashboards WHERE id = '$dashboardId' FOR UPDATE")
      val holderPid = scalar(holder, "SELECT pg_backend_pid()")
      val pending = Future {
        request.addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check((status.intValue, responseAs[String]))
      }(system.dispatcher)
      awaitRequestLockWait(holderPid)
      competing(holder)
      holder.commit()
      Await.result(pending, 30.seconds)
    } finally holder.close()
  }

  private def versionOf(dashboardId: String): Long =
    send(Get("/api/dashboards?limit=500")) {
      val item = responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]].find(_.fields("id") == JsString(dashboardId)).get
      item.fields.get("layoutVersion").fold(0L)(_.convertTo[Long])
    }

  private def nameOf(dashboardId: String): String =
    send(Get("/api/dashboards?limit=500")) {
      responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]].find(_.fields("id") == JsString(dashboardId)).get.fields("name").convertTo[String]
    }

  private def itemJson(panelId: String, x: Int, y: Int, w: Int = 4, h: Int = 3): String =
    s"""{"panelId":"$panelId","x":$x,"y":$y,"w":$w,"h":$h}"""

  private def patchBody(lg: Seq[String], expected: Option[Long]): String =
    s"""{"layout":{"lg":[${lg.mkString(",")}]}${expected.fold("")(v => s""","expectedLayoutVersion":$v""")}}"""

  private def setBpSql(dashboardId: String, bp: String, items: Seq[String]): String =
    s"""UPDATE dashboards SET layout = jsonb_set(layout, '{$bp}', '[${items.mkString(",")}]'::jsonb) WHERE id = '$dashboardId'"""

  private def ysOf(dashboardId: String, bp: String): Vector[Int] = itemsOf(dashboardId, bp).map(_.fields("y").convertTo[Int])

  "a layout PATCH carrying expectedLayoutVersion" should {

    "be refused with 409 when a panel was created after the client read the version, keeping the new panel's items" in {
      val d  = createDashboard("conc-stale-tab")
      val p1 = createPanel(d)
      val n  = versionOf(d)
      val p2 = createPanel(d)
      val moved = itemsOf(d, "lg").find(_.fields("panelId") == JsString(p1)).get.fields
      val body  = patchBody(Seq(itemJson(p1, 0, moved("y").convertTo[Int] + 20)), Some(n))
      send(Patch(s"/api/dashboards/$d", json(body))) { status shouldBe StatusCodes.Conflict }
      Bps.foreach(bp => idsOf(d, bp) should contain(p2))
    }

    "be refused with 409 when another transaction commits a layout change while it waits, keeping that layout" in {
      val d  = createDashboard("conc-inflight")
      val p1 = createPanel(d)
      val p2 = createPanel(d)
      val n  = versionOf(d)
      val (code, _) = raceWith(d, Patch(s"/api/dashboards/$d", json(patchBody(Seq(itemJson(p1, 0, 40), itemJson(p2, 4, 40)), Some(n))))) { holder =>
        exec(holder, setBpSql(d, "lg", Seq(itemJson(p1, 0, 0), itemJson(p2, 4, 0))))
      }
      code shouldBe 409
      ysOf(d, "lg") should contain only 0
    }
  }

  "a layout save racing a rename" should {

    "keep the rename (with an expectedLayoutVersion)" in {
      val d  = createDashboard("conc-rename-before")
      val p1 = createPanel(d)
      val n  = versionOf(d)
      val (code, _) = raceWith(d, Patch(s"/api/dashboards/$d", json(patchBody(Seq(itemJson(p1, 0, 30)), Some(n))))) { holder =>
        exec(holder, s"UPDATE dashboards SET name = 'renamed-meanwhile' WHERE id = '$d'")
      }
      code shouldBe 200
      nameOf(d) shouldBe "renamed-meanwhile"
      ysOf(d, "lg") shouldBe Vector(30)
    }

    "keep the rename (without a precondition)" in {
      val d  = createDashboard("conc-rename-bare")
      val p1 = createPanel(d)
      val (code, _) = raceWith(d, Patch(s"/api/dashboards/$d", json(patchBody(Seq(itemJson(p1, 0, 30)), None)))) { holder =>
        exec(holder, s"UPDATE dashboards SET name = 'renamed-bare' WHERE id = '$d'")
      }
      code shouldBe 200
      nameOf(d) shouldBe "renamed-bare"
    }
  }

  "a layout PATCH with no precondition racing a placement" should {

    "keep the placement in a breakpoint the request did not supply and still apply its own breakpoint" in {
      val d  = createDashboard("conc-unsent-bp")
      val p1 = createPanel(d)
      val p2 = createPanel(d)
      val p3 = createPanel(d)
      val own = Seq(itemJson(p1, 0, 50), itemJson(p2, 4, 50), itemJson(p3, 8, 50))
      val (code, _) = raceWith(d, Patch(s"/api/dashboards/$d", json(patchBody(own, None)))) { holder =>
        exec(holder, setBpSql(d, "md", Seq(itemJson(p3, 0, 70, 1, 3))))
        exec(holder, setBpSql(d, "xs", Seq(itemJson(p3, 0, 71, 1, 3))))
      }
      code shouldBe 200
      ysOf(d, "md") shouldBe Vector(70)
      ysOf(d, "xs") shouldBe Vector(71)
      ysOf(d, "lg") should contain only 50
    }
  }

  "auto-layout racing a placement" should {

    "keep the placed panel's items, either recomputed against the new layout or refused" in {
      val d  = createDashboard("conc-autolayout")
      val p1 = createPanel(d)
      val p2 = createPanel(d)
      val p3 = createPanel(d)
      val body = s"""{"items":[{"panelId":"$p1","w":4,"h":3}]}"""
      val (code, _) = raceWith(d, Post(s"/api/dashboards/$d/auto-layout", json(body))) { holder =>
        Bps.foreach(bp => exec(holder, setBpSql(d, bp, Seq(itemJson(p1, 0, 0, 1, 3), itemJson(p2, 0, 3, 1, 3), itemJson(p3, 0, 99, 1, 3)))))
      }
      Set(200, 409) should contain(code)
      Bps.foreach(bp => ysOf(d, bp) should contain(99))
    }
  }
}
