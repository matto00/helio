package com.helio.api.routes.patchsets

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1485 item 1: a patch-set preview of a dashboard update shows the layout the apply will store, ghost
 *  layout items (panels no longer on the dashboard) dropped exactly as `DashboardWrites.applyUpdate` drops
 *  them. Each case previews and then applies the same patch set on the same dashboard and compares the two
 *  layouts, so the expectation is apply's behaviour, not a hand-built JSON. Ghosts are planted by SQL.
 *
 *  Legend: `GUARD:` cases pin behaviour that already held and must keep holding (green before and after the
 *  fix, not proofs of it); the unlabelled cases were RED before HEL-1485's fix. */
class PatchSetPreviewGhostLayoutSpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private val ghost = "00000000-0000-0000-0000-00000000dead"

  private def item(id: String, x: Int, y: Int, w: Int = 2, h: Int = 2): JsObject =
    JsObject("panelId" -> JsString(id), "x" -> JsNumber(x), "y" -> JsNumber(y), "w" -> JsNumber(w), "h" -> JsNumber(h))

  private def ghostBearingDashboard(name: String): (String, String, String) = {
    val d = createDashboard(name)
    val Vector(a, b) = Vector.fill(2)(createPanel(d, "divider"))
    val stored = JsObject(Bps.map(bp => bp -> JsArray(item(a, 0, 0), item(b, 2, 0), item(ghost, 4, 0))).toMap)
    overwriteStoredLayout(d, stored.compactPrint)
    (d, a, b)
  }

  private def body(dashboardId: String, patch: String): String =
    s"""{"edits":[{"target":{"kind":"dashboard","id":"$dashboardId"},"op":"update","patch":$patch}]}"""

  private def layoutOf(state: JsValue): JsObject = state.asJsObject.fields("layout").asJsObject

  private def previewLayout(dashboardId: String, patch: String): JsObject =
    send(Post("/api/patch-sets/preview", json(body(dashboardId, patch)))) {
      status shouldBe StatusCodes.OK
      layoutOf(responseAs[String].parseJson.asJsObject.fields("edits").convertTo[Vector[JsValue]].head.asJsObject.fields("after"))
    }

  private def applyLayout(dashboardId: String, patch: String): JsObject =
    send(Post("/api/patch-sets/apply", json(body(dashboardId, patch)))) {
      status shouldBe StatusCodes.OK
      layoutOf(responseAs[String].parseJson.asJsObject.fields("edits").convertTo[Vector[JsValue]].head.asJsObject.fields("resultingState"))
    }

  private def ghostIn(layout: JsObject): Boolean =
    Bps.exists(bp => layout.fields(bp).convertTo[Vector[JsObject]].exists(_.fields("panelId") == JsString(ghost)))

  "POST /api/patch-sets/preview of a dashboard update" should {
    "drop a stored ghost on an appearance-only update, matching apply" in {
      val (d, _, _) = ghostBearingDashboard("preview-ghost-appearance")
      val patch     = """{"appearance":{"background":"#112233","gridBackground":"transparent"}}"""
      val previewed = previewLayout(d, patch)
      ghostIn(previewed) shouldBe false
      previewed shouldBe applyLayout(d, patch)
    }

    "drop a supplied breakpoint item naming a non-live panel, matching apply" in {
      val (d, a, b) = ghostBearingDashboard("preview-ghost-supplied")
      val patch     = s"""{"layout":{"lg":${JsArray(item(a, 0, 2), item(b, 2, 0), item(ghost, 4, 0)).compactPrint}}}"""
      val previewed = previewLayout(d, patch)
      previewed.fields("lg") shouldBe JsArray(item(a, 0, 2), item(b, 2, 0))
      ghostIn(previewed) shouldBe false
      previewed shouldBe applyLayout(d, patch)
    }

    "not reject a layout that overlaps only a ghost, as apply does not" in {
      val (d, a, b) = ghostBearingDashboard("preview-ghost-overlap")
      val patch     = s"""{"layout":{"lg":${JsArray(item(a, 0, 0), item(b, 4, 0), item(ghost, 4, 0)).compactPrint}}}"""
      val previewed = previewLayout(d, patch)
      previewed.fields("lg") shouldBe JsArray(item(a, 0, 0), item(b, 4, 0))
      previewed shouldBe applyLayout(d, patch)
    }

    "GUARD: still reject a layout that overlaps two live panels" in {
      val (d, a, b) = ghostBearingDashboard("preview-live-overlap")
      val patch     = s"""{"layout":{"lg":${JsArray(item(a, 0, 0), item(b, 1, 0)).compactPrint}}}"""
      send(Post("/api/patch-sets/preview", json(body(d, patch)))) { status shouldBe StatusCodes.BadRequest }
    }

    "GUARD: leave the layout unfiltered on a rename-only update, as apply's rename-only write does" in {
      val (d, _, _) = ghostBearingDashboard("preview-ghost-rename-only")
      val patch     = """{"name":"renamed-only"}"""
      val previewed = previewLayout(d, patch)
      ghostIn(previewed) shouldBe true
      previewed shouldBe applyLayout(d, patch)
    }
  }
}
