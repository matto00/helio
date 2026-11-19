package com.helio.domain.insights

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.{Duration, Instant}

/** HEL-1743 D3 (digest = data, not time) and D4/D5 (which candidates the tick pass renders). */
class InsightDigestAndScheduleSpec extends AnyWordSpec with Matchers {
  import InsightFixtures._

  private def digest(in: InsightInputs = inputs, spec: InsightRenderSpec = InsightFixtures.spec, model: String = "m", preset: InsightPreset = InsightPreset.Delta) =
    InsightDigest.compute(preset, spec, model, in)

  "InsightDigest" should {
    "ignore every timestamp" in {
      val shifted = inputs.copy(
        head = inputs.head.map(_.copy(capturedAt = t0)),
        compares = inputs.compares.map(_.copy(currentAt = Some(t0), baselineAt = None))
      )
      digest(shifted) shouldBe digest()
    }
    "treat an absent baseline and a zero delta as the same flat state" in {
      val none = inputs.copy(compares = inputs.compares.map(_.copy(baseline = None, delta = None, pct = None)))
      val zero = inputs.copy(compares = inputs.compares.map(_.copy(baseline = Some(1234.4), delta = Some(0.0), pct = Some(0.0))))
      digest(none) shouldBe digest(zero)
    }
    "collapse consecutive repeated window values" in {
      def w(vs: Double*) = inputs.copy(windows = Vector(InsightWindow("o1", "7d", vs.zipWithIndex.map { case (v, i) => t0.plusSeconds(i.toLong) -> v }.toVector)))
      digest(w(1, 1, 1, 2)) shouldBe digest(w(1, 2))
      digest(w(1, 2)) should not be digest(w(1, 3))
    }
    "change with a cell, the model, the prompt, the caps and the preset" in {
      val base = digest()
      val changedRow = inputs.copy(head = inputs.head.map(h => h.copy(rows = h.rows.updated(0, row("name" -> JsString("alpha"), "amount" -> JsString("9999"))))))
      Seq(
        digest(changedRow), digest(model = "other"), digest(spec = InsightFixtures.spec.copy(customPrompt = Some("why"))),
        digest(spec = InsightFixtures.spec.copy(maxChars = 301)), digest(preset = InsightPreset.Trend)
      ).foreach(_ should not be base)
    }
  }

  "InsightSchedule" should {
    val now = Instant.parse("2031-03-04T07:00:00Z")
    def cand(refresh: String, attempt: Option[Instant], model: Option[Instant], run: Option[Instant]) = InsightCandidate("o", "p", refresh, Instant.parse("2031-03-01T00:00:00Z"), attempt, model, run)
    "make a daily insight due once per UTC day at or after 06:00" in {
      InsightSchedule.dailyDue(cand("daily", Some(Instant.parse("2031-03-03T06:10:00Z")), None, None), now, 6) shouldBe true
      InsightSchedule.dailyDue(cand("daily", Some(Instant.parse("2031-03-04T06:00:00Z")), None, None), now, 6) shouldBe false
      InsightSchedule.dailyDue(cand("daily", None, None, None), Instant.parse("2031-03-04T05:59:00Z"), 6) shouldBe false
      InsightSchedule.dailyDue(cand("on_run", None, None, None), now, 6) shouldBe false
    }
    "catch up an on_run insight whose last model call is an hour old and whose pipeline ran at or after its newest attempt (less the grace)" in {
      val hour = Duration.ofHours(1); val grace = Duration.ofMinutes(10)
      val att  = Instant.parse("2031-03-04T05:00:00Z")
      InsightSchedule.catchUpDue(cand("on_run", Some(att), Some(att), Some(att.plusSeconds(1))), now, hour, grace) shouldBe true
      InsightSchedule.catchUpDue(cand("on_run", Some(att), Some(att), Some(att.minusSeconds(9 * 60))), now, hour, grace) shouldBe true
      InsightSchedule.catchUpDue(cand("on_run", Some(att), Some(att), Some(att.minusSeconds(11 * 60))), now, hour, grace) shouldBe false
      InsightSchedule.catchUpDue(cand("on_run", Some(att), Some(now.minusSeconds(60)), Some(att.plusSeconds(1))), now, hour, grace) shouldBe false
      InsightSchedule.catchUpDue(cand("on_run", Some(att), Some(att), None), now, hour, grace) shouldBe false
    }
    "not catch up an insight with no attempt for a pipeline run that predates the insight" in {
      val hour = Duration.ofHours(1); val grace = Duration.ofMinutes(10)
      InsightSchedule.catchUpDue(cand("on_run", None, None, Some(Instant.parse("2031-02-28T00:00:00Z"))), now, hour, grace) shouldBe false
      InsightSchedule.catchUpDue(cand("on_run", None, None, Some(Instant.parse("2031-03-01T00:00:01Z"))), now, hour, grace) shouldBe true
    }
  }
}
