package com.helio.api.routes.panels

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1485 item 3: auto-layout packs against, and writes back, only the dashboard's live panels. A ghost is a
 *  layout item for a panel no longer on the dashboard; V122 stops a delete creating one, so SQL plants them. */
class AutoLayoutGhostSpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private val ghost = "00000000-0000-0000-0000-00000000dead"

  private def item(id: String, x: Int, y: Int, w: Int = 4, h: Int = 5): JsObject =
    JsObject("panelId" -> JsString(id), "x" -> JsNumber(x), "y" -> JsNumber(y), "w" -> JsNumber(w), "h" -> JsNumber(h))

  private def autoLayout(dashboardId: String, body: String): Unit =
    send(Post(s"/api/dashboards/$dashboardId/auto-layout", json(body))) { status shouldBe StatusCodes.OK }

  "auto-layout" should {
    "not keep a stored ghost in a packed breakpoint, nor push the packed offset below it" in {
      val d       = createDashboard("auto-ghost-targeted")
      val Vector(kept, packed) = Vector.fill(2)(createPanel(d, "divider"))
      overwriteStoredLayout(d, JsObject(Bps.map(bp => bp -> JsArray(item(kept, 0, 0), item(ghost, 4, 20, h = 8))).toMap).compactPrint)
      autoLayout(d, s"""{"breakpoint":"lg","items":[{"panelId":"$packed","w":4,"h":5}]}""")
      idsOf(d, "lg") should not contain ghost
      idsOf(d, "lg").toSet shouldBe Set(kept, packed)
      itemsOf(d, "lg").find(_.fields("panelId") == JsString(packed)).get.fields("y") shouldBe JsNumber(5)
    }

    "not write a stored ghost back in a breakpoint it does not pack" in {
      val d       = createDashboard("auto-ghost-untargeted")
      val Vector(kept, packed) = Vector.fill(2)(createPanel(d, "divider"))
      overwriteStoredLayout(d, JsObject(Bps.map(bp => bp -> JsArray(item(kept, 0, 0), item(ghost, 4, 0))).toMap).compactPrint)
      autoLayout(d, s"""{"breakpoint":"lg","items":[{"panelId":"$packed","w":4,"h":5}]}""")
      Seq("md", "sm", "xs").foreach(bp => idsOf(d, bp) shouldBe Vector(kept))
    }
  }
}
