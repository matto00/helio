package com.helio.api.routes.panels

import com.helio.api.routes.LayoutRouteFixtures
import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1456 D3: deletes and creates on shared dashboards take their locks in one order (panel rows, then the
 *  dashboard row), so concurrent ones neither deadlock nor lose either effect. Its own spec, so its request volume
 *  gets its own per-principal rate-limit bucket instead of eating `PanelDeleteLayoutStripSpec`'s. */
class PanelDeleteLayoutStripConcurrencySpec extends ApplyProposalSpecBase with LayoutRouteFixtures {

  "concurrent create and delete on one dashboard" should {
    "keep both effects, with no deadlock, over repeated runs" in {
      implicit val pool: ExecutionContext = system.dispatcher
      (1 to 4).foreach { round =>
        val d    = createDashboard(s"strip-concurrent-$round")
        val keep = createPanel(d)
        val gone = createPanel(d)
        val results = Await.result(
          Future.sequence(Seq(Future(createPanel(d)), Future(createPanel(d)), Future { deleteOk(s"/api/panels/$gone"); "" })),
          60.seconds
        )
        val created = results.filter(_.nonEmpty)
        Bps.foreach { bp =>
          idsOf(d, bp).toSet shouldBe (created.toSet + keep)
          idsOf(d, bp) should have size 3
        }
      }
    }

    "keep both effects when a bulk Output delete and a pipeline-cascade delete share dashboards" in {
      implicit val pool: ExecutionContext = system.dispatcher
      (1 to 3).foreach { round =>
        val bulk    = createPipeline(s"strip-race-bulk-$round", withStep = false)
        val cascade = createPipeline(s"strip-race-cascade-$round", withStep = false)
        val ds      = Vector.tabulate(3)(i => createDashboard(s"strip-race-$round-$i"))
        val keeps   = ds.map(createPanel(_))
        ds.foreach { d => createPanel(d, "output", Some(bulk.outputId)); createPanel(d, "output", Some(cascade.outputId)) }
        Await.result(
          Future.sequence(Seq(
            Future(deleteOk(s"/api/outputs/${bulk.outputId}")),
            Future(deleteOk(s"/api/pipelines/${cascade.pipelineId}"))
          )),
          60.seconds
        )
        ds.zip(keeps).foreach { case (d, keep) => Bps.foreach(bp => idsOf(d, bp) shouldBe Vector(keep)) }
      }
    }
  }
}
