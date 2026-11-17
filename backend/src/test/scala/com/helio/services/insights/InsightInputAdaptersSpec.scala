package com.helio.services.insights

import com.helio.domain.insights.InsightFixtures.{t0, t1}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.OutputHistoryPoint
import com.helio.services.pipelines.{OutputHistoryResolution, OutputHistoryService, ResolvedHistoryPoint, StoredMetricIdentity}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-1741 task 2.4: the existing history read maps onto the insight input types. */
class InsightInputAdaptersSpec extends AnyWordSpec with Matchers {

  private val output = Output(OutputId("o1"), "Revenue", UserId("u1"), NodeRef(PipelineId("p1"), None), OutputKind.Metric, t0, t0)

  private def point(at: Instant, summary: String): OutputHistoryPoint =
    OutputHistoryPoint(UUID.randomUUID(), "o1", "p1", None, None, None, "manual", at, 3, summary.parseJson.asJsObject)

  private def metric(v: Double) = s"""{"v":1,"metric":{"field":"revenue","agg":"sum","value":$v}}"""

  "fromResolution" should {
    "map a resolved compare and window points, oldest first, skipping points with no headline" in {
      val points = Vector(point(t1, metric(10)), point(t1.minusSeconds(60), "{}"), point(t0, metric(8)))
      val resolution = OutputHistoryResolution(
        Some("7d"),
        Some(ResolvedHistoryPoint(t1, 3, Some(10.0), Some(StoredMetricIdentity("revenue", Some("sum"))))),
        Some(ResolvedHistoryPoint(t0, 3, Some(8.0))),
        Some(2.0),
        Some(25.0),
        None,
        points
      )
      val out = InsightInputAdapters.fromResolution(output, resolution)
      val c   = out.compare.get
      (c.outputId, c.outputName, c.field, c.compare) shouldBe (("o1", "Revenue", "revenue", "7d"))
      (c.current, c.baseline, c.delta, c.pct) shouldBe ((Some(10.0), Some(8.0), Some(2.0), Some(25.0)))
      (c.currentAt, c.baselineAt) shouldBe ((Some(t1), Some(t0)))
      out.window.get.label shouldBe "7d"
      out.window.get.points shouldBe Vector(t0 -> 8.0, t1 -> 10.0)
      OutputHistoryService.headline(points(1).summary) shouldBe None
    }
    "give no compare without a configured compare or a metric field, and no window without points" in {
      val bare = OutputHistoryResolution(None, None, None, None, None, None, Vector.empty)
      InsightInputAdapters.fromResolution(output, bare) shouldBe InsightOutputInputs(None, None)
      val noMetric = bare.copy(compare = Some("7d"), current = Some(ResolvedHistoryPoint(t1, 1, Some(1.0))))
      InsightInputAdapters.fromResolution(output, noMetric).compare shouldBe None
    }
  }
}
