package com.helio.services.alerts

import com.helio.infrastructure.persistence.pipelines.OutputHistoryPoint
import com.helio.services.alerts.HistoryBaseline._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-1278: pure parsing / selection / delta semantics, no DB. */
class HistoryBaselineSpec extends AnyWordSpec with Matchers {

  private def cond(fields: (String, JsValue)*): JsObject =
    JsObject((Seq("comparator" -> JsString("gt"), "threshold" -> JsNumber(1)) ++ fields).toMap)

  private def summaryOf(metric: String, sum: JsValue, rowCount: Int = 2): JsObject =
    JsObject(
      "v" -> JsNumber(1), "rowCount" -> JsNumber(rowCount),
      "columns" -> JsObject(metric -> JsObject("count" -> JsNumber(rowCount), "sum" -> sum, "min" -> JsNumber(0), "max" -> JsNumber(0)))
    )

  private def point(runId: Option[String], summary: JsObject): OutputHistoryPoint =
    OutputHistoryPoint(UUID.randomUUID(), "o", "p", None, None, runId, "manual", Instant.now(), 1, summary)

  "HistoryBaseline.parse" should {
    "return None for a plain threshold condition" in {
      parse(cond()) shouldBe Right(None)
    }
    "accept previous and rolling_avg" in {
      parse(cond("baseline" -> JsString("previous"), "mode" -> JsString("abs"))) shouldBe Right(Some(Baseline(Previous, Abs)))
      parse(cond("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(5), "mode" -> JsString("pct"))) shouldBe Right(Some(Baseline(RollingAvg(5), Pct)))
    }
    "reject every malformed shape" in {
      val bad = Seq(
        cond("baseline" -> JsString("median"), "mode" -> JsString("abs")),
        cond("baseline" -> JsNull, "mode" -> JsString("abs")),
        cond("baseline" -> JsString("previous")),
        cond("baseline" -> JsString("previous"), "mode" -> JsString("rel")),
        cond("baseline" -> JsString("rolling_avg"), "mode" -> JsString("abs")),
        cond("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(0), "mode" -> JsString("abs")),
        cond("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(101), "mode" -> JsString("abs")),
        cond("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(2.5), "mode" -> JsString("abs")),
        cond("baseline" -> JsString("rolling_avg"), "n" -> JsString("3"), "mode" -> JsString("abs")),
        cond("baseline" -> JsString("previous"), "n" -> JsNumber(2), "mode" -> JsString("abs")),
        cond("n" -> JsNumber(3)),
        cond("mode" -> JsString("abs"))
      )
      bad.foreach(c => withClue(c.compactPrint)(parse(c).isLeft shouldBe true))
    }
    "accept the n bounds 1 and 100" in {
      parse(cond("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(1), "mode" -> JsString("abs"))).isRight shouldBe true
      parse(cond("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(100), "mode" -> JsString("abs"))).isRight shouldBe true
    }
  }

  "HistoryBaseline.summaryValue" should {
    "read rowCount for * and the column sum otherwise" in {
      val s = summaryOf("amount", JsNumber(30), rowCount = 7)
      summaryValue(s, "*") shouldBe Some(7.0)
      summaryValue(s, "amount") shouldBe Some(30.0)
    }
    "be None for an absent column or a null (non-finite) sum" in {
      summaryValue(summaryOf("amount", JsNumber(30)), "other") shouldBe None
      summaryValue(summaryOf("amount", JsNull), "amount") shouldBe None
    }
  }

  "HistoryBaseline.currentValue" should {
    "coerce numeric strings exactly like the stored summary does" in {
      val rows = Seq(Map[String, Any]("amount" -> "10"), Map[String, Any]("amount" -> "20"))
      currentValue(rows, "amount") shouldBe Some(30.0)
      currentValue(rows, "*") shouldBe Some(2.0)
    }
    "be None for a mixed (non-numeric) column and for a missing column" in {
      currentValue(Seq(Map[String, Any]("amount" -> "10"), Map[String, Any]("amount" -> "n/a")), "amount") shouldBe None
      currentValue(Seq(Map[String, Any]("a" -> 1)), "amount") shouldBe None
    }
  }

  "HistoryBaseline.eligible" should {
    "drop the triggering run's point and take the k newest others" in {
      val pts = Seq(point(Some("cur"), JsObject.empty), point(Some("r2"), JsObject.empty), point(Some("r1"), JsObject.empty))
      eligible(pts, "cur", 2).flatMap(_.runId) shouldBe Vector("r2", "r1")
      eligible(pts.tail, "cur", 1).flatMap(_.runId) shouldBe Vector("r2")
    }
  }

  "HistoryBaseline.baselineValue" should {
    val s = (v: Double) => point(Some(UUID.randomUUID().toString), summaryOf("m", JsNumber(v)))
    "use the newest point for previous" in {
      baselineValue(Previous, Seq(s(100), s(5)), "m") shouldBe Some(100.0)
    }
    "average exactly n points for rolling_avg" in {
      baselineValue(RollingAvg(3), Seq(s(100), s(110), s(90)), "m") shouldBe Some(100.0)
    }
    "be None on insufficient points or any valueless point" in {
      baselineValue(RollingAvg(3), Seq(s(100), s(110)), "m") shouldBe None
      baselineValue(Previous, Seq.empty, "m") shouldBe None
      baselineValue(RollingAvg(2), Seq(s(1), point(None, summaryOf("m", JsNull))), "m") shouldBe None
    }
  }

  "HistoryBaseline.delta" should {
    "compute abs and pct" in {
      delta(Abs, 120, 100) shouldBe Some(20.0)
      delta(Pct, 70, 100) shouldBe Some(-30.0)
      delta(Pct, 50, -100) shouldBe Some(150.0)
    }
    "be None for a zero baseline in pct mode but defined in abs mode" in {
      delta(Pct, 5, 0) shouldBe None
      delta(Abs, 5, 0) shouldBe Some(5.0)
    }
  }
}
