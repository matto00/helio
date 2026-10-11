package com.helio.api.routes.panels

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1456: every route that removes a panel row also removes its items from every breakpoint of the
 *  dashboard's stored layout (V122's trigger), so a later create or auto-layout starts at the real bottom.
 *  The base fixture runs the full route tree over a non-BYPASSRLS app pool. */
class PanelDeleteLayoutStripSpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  private def yOf(o: JsObject): Int = o.fields("y").convertTo[Int]
  private def bottomOf(o: JsObject): Int = yOf(o) + o.fields("h").convertTo[Int]

  "DELETE /api/panels/:id" should {
    "remove the panel's items from lg, md, sm and xs and leave the others untouched" in {
      val d  = createDashboard("strip-single")
      val Vector(a, b, c) = Vector.fill(3)(createPanel(d))
      val before = Bps.map(bp => bp -> itemsOf(d, bp)).toMap
      deleteOk(s"/api/panels/$b")
      Bps.foreach { bp =>
        idsOf(d, bp) shouldBe Vector(a, c)
        itemsOf(d, bp) shouldBe before(bp).filterNot(_.fields("panelId") == JsString(b))
      }
    }

    "leave empty arrays, not null, after deleting the only panel" in {
      val d = createDashboard("strip-only")
      deleteOk(s"/api/panels/${createPanel(d)}")
      storedLayoutJson(d) shouldBe JsObject(Bps.map(_ -> JsArray()).toMap)
    }

    "let the next create start at the remaining panel's bottom on every breakpoint (no gap)" in {
      val d = createDashboard("strip-no-gap")
      val a = createPanel(d)
      val b = createPanel(d)
      deleteOk(s"/api/panels/$b")
      val c = createPanel(d)
      Bps.foreach { bp =>
        val aItem = itemsOf(d, bp).find(_.fields("panelId") == JsString(a)).get
        val cItem = itemsOf(d, bp).find(_.fields("panelId") == JsString(c)).get
        yOf(cItem) shouldBe bottomOf(aItem)
      }
    }

    "let auto-layout pack a panel at the remaining panel's bottom, with no offset below the deleted one" in {
      val d = createDashboard("strip-auto-layout")
      val a = createPanel(d)
      val b = createPanel(d)
      val c = createPanel(d)
      deleteOk(s"/api/panels/$b")
      send(Post(s"/api/dashboards/$d/auto-layout", json(s"""{"items":[{"panelId":"$c","w":4,"h":5}]}"""))) { status shouldBe StatusCodes.OK }
      Bps.foreach { bp =>
        val aItem = itemsOf(d, bp).find(_.fields("panelId") == JsString(a)).get
        val cItem = itemsOf(d, bp).find(_.fields("panelId") == JsString(c)).get
        yOf(cItem) shouldBe bottomOf(aItem)
        idsOf(d, bp) should not contain b
      }
    }
  }

  "an Output delete" should {
    "strip every panel bound to it from every dashboard it appears on, and nothing else" in {
      val pl     = createPipeline("strip-out", withStep = false)
      val d1     = createDashboard("strip-out-1")
      val d2     = createDashboard("strip-out-2")
      val keep1  = createPanel(d1)
      val bound1 = createPanel(d1, "output", Some(pl.outputId))
      val bound2 = createPanel(d2, "output", Some(pl.outputId))
      deleteOk(s"/api/outputs/${pl.outputId}")
      Bps.foreach { bp =>
        idsOf(d1, bp) shouldBe Vector(keep1)
        idsOf(d2, bp) shouldBe empty
      }
      Vector(bound1, bound2).foreach(id => Bps.foreach(bp => (idsOf(d1, bp) ++ idsOf(d2, bp)) should not contain id))
    }
  }

  "a database cascade" should {
    "strip the panels removed by a pipeline delete" in {
      val pl = createPipeline("strip-pipeline", withStep = false)
      val d  = createDashboard("strip-pipeline-d")
      val keep = createPanel(d)
      createPanel(d, "output", Some(pl.outputId))
      deleteOk(s"/api/pipelines/${pl.pipelineId}")
      Bps.foreach(bp => idsOf(d, bp) shouldBe Vector(keep))
    }

    "strip the panels removed by a pipeline-step delete" in {
      val pl = createPipeline("strip-step", withStep = true)
      val d  = createDashboard("strip-step-d")
      val keep = createPanel(d)
      createPanel(d, "output", Some(pl.outputId))
      deleteOk(s"/api/pipeline-steps/${pl.stepId.get}")
      Bps.foreach(bp => idsOf(d, bp) shouldBe Vector(keep))
    }
  }

  "PUT /api/dashboards/:id/contents" should {
    "leave no item for a replaced panel (guard: replaceContents already writes its own final layout)" in {
      val d   = createDashboard("strip-replace")
      val old = createPanel(d)
      send(Put(s"/api/dashboards/$d/contents", json("""{"panels":[]}"""))) { status shouldBe StatusCodes.OK }
      Bps.foreach(bp => idsOf(d, bp) should not contain old)
    }
  }

  "DELETE /api/dashboards/:id" should {
    "still succeed with panels on it (guard)" in {
      val d = createDashboard("strip-dashboard-delete")
      createPanel(d); createPanel(d)
      deleteOk(s"/api/dashboards/$d")
      panelTitlesForDashboard(d) shouldBe empty
    }
  }

}
