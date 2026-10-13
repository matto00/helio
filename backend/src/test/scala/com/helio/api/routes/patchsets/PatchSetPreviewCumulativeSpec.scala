package com.helio.api.routes.patchsets

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1498 item 3: patch-set preview projects each edit against the state the EARLIER edits of the same set
 *  produce, exactly as apply executes them. Every case previews a set and then applies the very same set on the
 *  same fixture and compares preview's `after` with apply's `resultingState`, so the expectation is apply's
 *  behaviour, not a hand-built JSON.
 *
 *  Legend: `PROOF:` cases are RED on the code before the cumulative overlay (preview projected each edit in
 *  isolation) and prove the fix; `GUARD:` cases are green before and after and pin behaviour the overlay must NOT
 *  change (fingerprints and `before` stay pre-apply, unrelated multi-edit sets are untouched). */
class PatchSetPreviewCumulativeSpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private val Volatile = Set("createdAt", "lastUpdated", "updatedAt")

  /** Strips server-assigned timestamps (and, for a create, the server-assigned id) so preview and apply compare. */
  private def normalized(v: JsValue, dropId: Boolean): JsValue = v match {
    case JsObject(fields) =>
      JsObject(fields.collect { case (k, x) if !Volatile(k) && !(dropId && k == "id") => k -> normalized(x, dropId) })
    case JsArray(xs) => JsArray(xs.map(normalized(_, dropId)))
    case other       => other
  }

  private def set(edits: String*): String = s"""{"edits":[${edits.mkString(",")}]}"""

  private def panelDelete(id: String)                  = s"""{"target":{"kind":"panel","id":"$id"},"op":"delete"}"""
  private def panelCreate(dashboardId: String)         = s"""{"target":{"kind":"panel"},"op":"create","patch":{"dashboardId":"$dashboardId","type":"divider"}}"""
  private def panelUpdate(id: String, patch: String)    = s"""{"target":{"kind":"panel","id":"$id"},"op":"update","patch":$patch}"""
  private def dashboardUpdate(id: String, patch: String) = s"""{"target":{"kind":"dashboard","id":"$id"},"op":"update","patch":$patch}"""

  private def editsOf(body: String): Vector[JsObject] =
    body.parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]]

  private def preview(body: String): Vector[JsObject] =
    send(Post("/api/patch-sets/preview", json(body))) {
      status shouldBe StatusCodes.OK
      editsOf(responseAs[String])
    }

  private def applied(body: String): Vector[JsObject] =
    send(Post("/api/patch-sets/apply", json(body))) {
      status shouldBe StatusCodes.OK
      editsOf(responseAs[String])
    }

  private def previewStatus(body: String) = send(Post("/api/patch-sets/preview", json(body)))(status)
  private def applyStatus(body: String)   = send(Post("/api/patch-sets/apply", json(body)))(status)

  /** Apply reports a mid-set failure in a 200 body (`failure` plus `rolledBack` edits), not as an HTTP error. */
  private def applyFailure(body: String): Option[String] =
    send(Post("/api/patch-sets/apply", json(body))) {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields.get("failure").map(_.convertTo[String])
    }

  /** Preview's `after` and apply's `resultingState` of edit `i` for the same set, normalized. A created panel's
   *  server-assigned id is rewritten to the placeholder preview uses for it (`(pending:<editIndex>)`). */
  private def afterVsResult(body: String, i: Int, dropId: Boolean = false): (JsValue, JsValue) = {
    val after   = preview(body)(i).fields("after")
    val outcome = applied(body)
    val withPlaceholders = outcome.foldLeft(outcome(i).fields("resultingState").compactPrint) { (json, e) =>
      e.fields.get("newId").map(_.convertTo[String]).fold(json)(id => json.replace(id, s"(pending:${e.fields("index").convertTo[Int]})"))
    }
    (normalized(after, dropId), normalized(withPlaceholders.parseJson, dropId))
  }

  private def panelIdsIn(layout: JsValue, bp: String): Vector[String] =
    layout.asJsObject.fields(bp).convertTo[Vector[JsObject]].map(_.fields("panelId").convertTo[String])

  private def twoPanelDashboard(name: String): (String, String, String) = {
    val d = createDashboard(name)
    val Vector(a, b) = Vector.fill(2)(createPanel(d, "divider"))
    (d, a, b)
  }

  "PROOF: preview of a set" should {
    "drop a deleted panel's layout items from a later dashboard rename, matching apply" in {
      val (d, a, b) = twoPanelDashboard("cumulative-delete-rename")
      val body      = set(panelDelete(a), dashboardUpdate(d, """{"name":"renamed"}"""))
      val (after, result) = afterVsResult(body, 1)
      val layout = after.asJsObject.fields("layout")
      Bps.foreach(bp => panelIdsIn(layout, bp) shouldBe Vector(b))
      after shouldBe result
    }

    "include a created panel's placement in a later dashboard appearance update, matching apply" in {
      val (d, a, b) = twoPanelDashboard("cumulative-create-appearance")
      val body      = set(panelCreate(d), dashboardUpdate(d, """{"appearance":{"background":"#112233","gridBackground":"transparent"}}"""))
      val (after, result) = afterVsResult(body, 1)
      val layout = after.asJsObject.fields("layout")
      Bps.foreach(bp => panelIdsIn(layout, bp).toSet should (contain(a) and contain(b) and have size 3))
      after shouldBe result
    }

    "show an earlier update of the same panel in a later one, matching apply" in {
      val d    = createDashboard("cumulative-two-updates")
      val p    = createPanel(d, "divider")
      val body = set(panelUpdate(p, """{"title":"first"}"""), panelUpdate(p, """{"appearance":{"background":"#abcdef"}}"""))
      val (after, result) = afterVsResult(body, 1)
      after.asJsObject.fields("title") shouldBe JsString("first")
      after shouldBe result
    }

    "reject an update of a panel an earlier edit deleted, as apply fails" in {
      val d    = createDashboard("cumulative-delete-update")
      val p    = createPanel(d, "divider")
      val body = set(panelDelete(p), panelUpdate(p, """{"title":"gone"}"""))
      previewStatus(body) shouldBe StatusCodes.NotFound
      applyFailure(body) shouldBe defined
    }

    "reject a layout update whose expectedLayoutVersion an earlier edit already moved past, as apply fails" in {
      val (d, a, _) = twoPanelDashboard("cumulative-stale-version")
      val version = send(Get("/api/dashboards")) {
        responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
          .find(_.fields("id") == JsString(d)).get.fields("layoutVersion").convertTo[Long]
      }
      val lg   = storedLayoutJson(d).fields("lg")
      val body = set(panelCreate(d), dashboardUpdate(d, s"""{"layout":{"lg":${lg.compactPrint}},"expectedLayoutVersion":$version}"""))
      previewStatus(body) shouldBe StatusCodes.Conflict
      applyFailure(body) shouldBe Some("This dashboard's layout was changed elsewhere; the layout was not saved.")
      idsOf(d, "lg") should contain(a)
    }
  }

  "PROOF: preview of a dashboard delete" should {
    "count the panels earlier edits of the set created and deleted on that dashboard" in {
      val (d, a, _) = twoPanelDashboard("cumulative-impact")
      val dashboardDelete = s"""{"target":{"kind":"dashboard","id":"$d"},"op":"delete"}"""
      def hint(body: String): Vector[String] = preview(body)(1).fields("impact").convertTo[Vector[String]]
      hint(set(panelCreate(d), dashboardDelete)) shouldBe Vector("Cascades to 3 panel(s).")
      hint(set(panelDelete(a), dashboardDelete)) shouldBe Vector("Cascades to 1 panel(s).")
    }

    "reject an update of a panel on a dashboard an earlier edit deleted" in {
      val (d, a, _) = twoPanelDashboard("cumulative-dashboard-delete-update")
      val body      = set(s"""{"target":{"kind":"dashboard","id":"$d"},"op":"delete"}""", panelUpdate(a, """{"title":"gone"}"""))
      previewStatus(body) shouldBe StatusCodes.NotFound
      applyFailure(body) shouldBe defined
    }
  }

  "GUARD: preview of a set" should {
    "return the pre-apply fingerprint for both edits of one target and apply the set without a stale refusal" in {
      val d     = createDashboard("cumulative-fingerprints")
      val p     = createPanel(d, "divider")
      val body  = set(panelUpdate(p, """{"title":"first"}"""), panelUpdate(p, """{"title":"second"}"""))
      val edits = preview(body)
      val fps   = edits.map(_.fields("fingerprint"))
      fps.distinct should have size 1
      val stamped = JsObject("edits" -> JsArray(editsOf(body).zip(fps).map { case (e, fp) =>
        JsObject(e.fields + ("target" -> JsObject(e.fields("target").asJsObject.fields + ("fingerprint" -> fp))))
      })).compactPrint
      applyStatus(stamped) shouldBe StatusCodes.OK
    }

    "report the pre-apply state as `before` on every edit, equal to apply's priorState" in {
      val d    = createDashboard("cumulative-before")
      val p    = createPanel(d, "divider")
      val body = set(panelUpdate(p, """{"title":"first"}"""), panelUpdate(p, """{"title":"second"}"""))
      val before = preview(body).map(_.fields("before"))
      val prior  = applied(body).map(_.fields("priorState"))
      before.map(normalized(_, dropId = false)) shouldBe prior.map(normalized(_, dropId = false))
    }

    "leave a set of edits on unrelated targets exactly as apply produces them" in {
      val d1   = createDashboard("cumulative-unrelated-1")
      val d2   = createDashboard("cumulative-unrelated-2")
      val p    = createPanel(d1, "divider")
      val body = set(panelUpdate(p, """{"title":"renamed"}"""), dashboardUpdate(d2, """{"name":"other"}"""))
      val after  = preview(body).map(e => normalized(e.fields("after"), dropId = false))
      val result = applied(body).map(e => normalized(e.fields("resultingState"), dropId = false))
      after shouldBe result
    }
  }
}
