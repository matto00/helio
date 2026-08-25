package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStepId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-639: tests for the timezone-less-timestamp parsing fix in
 *  `DateBucketStep.parseToUtcDate` and the zero-parse-rate execution-failure
 *  guard in `DateBucketStep.evaluate`. Direct unit tests — no engine
 *  plumbing required (mirrors `AggregateStepSpec`/`AssertStepSpec`). */
class DateBucketStepSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def step(field: String = "ts", granularity: String = "day", outputColumn: Option[String] = None) =
    DateBucketStep(
      id           = PipelineStepId("step-1"),
      pipelineId   = PipelineId("pipe-1"),
      position     = 0,
      config       = DateBucketConfig(field, granularity, outputColumn),
      createdAt    = Instant.now(),
      updatedAt    = Instant.now()
    )

  private val ctx = PipelineExecutionContext(
    dataSourceRepo = null,
    loadSource     = _ => Future.successful(Seq.empty)
  )

  private def evaluate(rows: Seq[Map[String, Any]], s: DateBucketStep): Seq[Map[String, Any]] =
    Await.result(s.evaluate(rows, ctx), 5.seconds)

  // ── §1.1 / §2.3 accepted-shape parsing (RED then GREEN) ────────────────────

  "DateBucketStep.evaluate — accepted timezone-less shapes" should {

    "buckets a T-separated tz-less timestamp (2026-03-14T22:08:39) to the correct month" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-03-14T22:08:39"))
      val result = evaluate(rows, step(granularity = "month"))
      result.head("ts") shouldBe "2026-03-01"
    }

    "buckets a T-separated tz-less timestamp with 3-digit fractional seconds" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-03-14T22:08:39.123"))
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-03-14"
    }

    "buckets a space-separated tz-less timestamp (2026-07-01 12:00:00) to the correct month" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-07-01 12:00:00"))
      val result = evaluate(rows, step(granularity = "month"))
      result.head("ts") shouldBe "2026-07-01"
    }

    "buckets a space-separated tz-less timestamp with no seconds (2026-07-01 12:00)" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-07-01 12:00"))
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-07-01"
    }

    "buckets a space-separated tz-less timestamp with 1-digit fractional seconds (variable-width fraction, not a fixed [.SSS] pattern)" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-07-01 12:00:00.1"))
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-07-01"
    }

    "buckets a space-separated tz-less timestamp with 6-digit (microsecond, Postgres/pandas default) fractional seconds" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-07-01 12:00:00.123456"))
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-07-01"
    }

    "the two months from the ticket's own repro land in two distinct buckets (no all-null collapse)" in {
      val rows = Seq(
        Map[String, Any]("ts" -> "2026-03-14T22:08:39"),
        Map[String, Any]("ts" -> "2026-04-02T11:30:00")
      )
      val result = evaluate(rows, step(granularity = "month"))
      result.map(_ ("ts")).toSet shouldBe Set("2026-03-01", "2026-04-01")
      result.count(r => r("ts") == null) shouldBe 0
    }

    "an already-offset-bearing string still takes the OffsetDateTime/Instant branch unchanged" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-03-17T00:00:00Z"))
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-03-17"
    }

    "a bare yyyy-MM-dd LocalDate still matches, not short-circuited by the new LocalDateTime branches" in {
      val rows   = Seq(Map[String, Any]("ts" -> "2026-03-17"))
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-03-17"
    }

    "a partially-parseable input nulls only the unparseable row, without failing the step (discriminate parser, per-row null-on-failure preserved)" in {
      val rows = Seq(
        Map[String, Any]("ts" -> "2026-03-17T00:00:00Z"),
        Map[String, Any]("ts" -> "not-a-date")
      )
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-03-17"
      result(1)("ts").asInstanceOf[AnyRef] shouldBe null
    }
  }

  // ── §3 zero-parse-rate execution-failure guard ──────────────────────────────

  "DateBucketStep.evaluate — zero-parse-rate guard" should {

    "fails execution when every row's field value is present but unparseable (single-row case)" in {
      val rows = Seq(Map[String, Any]("ts" -> "not-a-date"))
      val ex = intercept[IllegalArgumentException] {
        evaluate(rows, step(granularity = "day"))
      }
      ex.getMessage should not be empty
    }

    "fails execution when every row's field value is present but unparseable (multi-row, all-unparseable case)" in {
      val rows = Seq(
        Map[String, Any]("ts" -> "not-a-date"),
        Map[String, Any]("ts" -> "also-not-a-date")
      )
      intercept[IllegalArgumentException] {
        evaluate(rows, step(granularity = "day"))
      }
    }

    "does not fail on empty input (nothing to bucket, nothing silently lost)" in {
      val result = evaluate(Seq.empty, step(granularity = "day"))
      result shouldBe empty
    }

    "does not fail when every row's field value is absent/null/blank (nothing to bucket)" in {
      val rows = Seq(
        Map[String, Any]("other" -> "x"),
        Map[String, Any]("ts"    -> null),
        Map[String, Any]("ts"    -> "")
      )
      val result = evaluate(rows, step(granularity = "day"))
      result should have size 3
    }

    "does not fail on a partially-parseable input — still nulls the unparseable row, doesn't fail the step" in {
      val rows = Seq(
        Map[String, Any]("ts" -> "2026-03-17T00:00:00Z"),
        Map[String, Any]("ts" -> "not-a-date")
      )
      val result = evaluate(rows, step(granularity = "day"))
      result.head("ts") shouldBe "2026-03-17"
      result(1)("ts").asInstanceOf[AnyRef] shouldBe null
    }
  }
}
