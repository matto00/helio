package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.model.{PipelineStep, PipelineStepId}
import com.helio.domain.steps.{AssertConfig, AssertRule, AssertStep, StringOpsConfig, StringOpsStep}
import com.helio.testsupport.RunBackendFixture
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.util.Try
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1676: a user regex (stringops extractRegex, assert regex) is time-boxed to a fixed 2 s per step evaluation, shared by all rows,
 *  and an expiry is a step error naming the step (never a rule result), on the real run path.
 *
 *  `^(.*a){12}$` on `a...ab` backtracks exponentially (about x2.4 per two characters; measured 4.7 s at 32 characters), so the 40 character
 *  inputs run for minutes unfixed. Each case is awaited with a bound on a separate thread so an unfixed engine fails the case instead of hanging it. */
class UserRegexTimeBoxSpec extends AnyWordSpec with Matchers with RunBackendFixture {

  private val Catastrophic = "^(.*a){12}$"
  private def doomed(n: Int): String = "a" * n + "b"

  private def stringops(id: String, pattern: String) =
    StringOpsStep(PipelineStepId(id), fixturePid, 0, StringOpsConfig("extractRegex", "body", "out", Some(pattern), None, None, None), fixtureNow, fixtureNow)

  private def assertStep(id: String, pattern: String): PipelineStep =
    AssertStep(PipelineStepId(id), fixturePid, 0, AssertConfig(Vector(AssertRule("regex", Some("body"), JsObject("pattern" -> JsString(pattern)), "error"))), fixtureNow, fixtureNow)

  /** Runs on a thread of its own and waits at most `bound`; returns the elapsed milliseconds and the run's outcome. */
  private def timedRun(step: PipelineStep, rows: Vector[Row], bound: Int = 10): (Long, Try[Any]) = {
    val started = System.nanoTime()
    val f       = Future(Await.result(runOver(Map(RootName -> rows), Vector(step)), 180.seconds))(ExecutionContext.global)
    val out     = Try(Await.result(f, bound.seconds))
    ((System.nanoTime() - started) / 1000000L, out)
  }

  "a catastrophic extractRegex" should {
    "end within the budget as a step error naming the step" in {
      val (ms, out) = timedRun(stringops("rx1", Catastrophic), Vector(Map[String, Any]("body" -> doomed(40))))
      withClue(s"outcome after $ms ms: $out") { out.failed.get shouldBe a[StepExecutionException] }
      val e = out.failed.get.asInstanceOf[StepExecutionException]
      e.stepId shouldBe "rx1"
      e.stepKind shouldBe "stringops"
      e.getMessage should include("regex time budget")
      ms should be < 5000L
    }

    "share one 2 s budget across all rows: rows that are each well under it still fail together" in {
      // 26 characters costs roughly 0.3 s a row; twenty of them are well over 2 s in total but each is far under it.
      val rows      = Vector.fill(20)(Map[String, Any]("body" -> doomed(26)))
      val (ms, out) = timedRun(stringops("rx2", Catastrophic), rows)
      withClue(s"outcome after $ms ms: $out") { out.failed.get shouldBe a[StepExecutionException] }
      ms should be < 5000L
    }

    "leave a pattern that finishes in time unaffected" in {
      val (_, out) = timedRun(stringops("rx3", "(\\d+)-x"), Vector(Map[String, Any]("body" -> "ab 123-x"), Map[String, Any]("body" -> "none")))
      out.isSuccess shouldBe true
    }
  }

  "a catastrophic assert regex rule" should {
    "end within the budget as a step error naming the step, not as a rule result" in {
      val (ms, out) = timedRun(assertStep("as1", Catastrophic), Vector(Map[String, Any]("body" -> doomed(40))))
      withClue(s"outcome after $ms ms: $out") { out.failed.get shouldBe a[StepExecutionException] }
      val e = out.failed.get.asInstanceOf[StepExecutionException]
      e.stepId shouldBe "as1"
      e.stepKind shouldBe "assert"
      e.getMessage should include("regex time budget")
      ms should be < 5000L
    }
  }

  "AssertStep.evaluateRules" should {
    "let a regex expiry propagate rather than record a failed rule" in {
      val rules = Vector(AssertRule("regex", Some("body"), JsObject("pattern" -> JsString(Catastrophic)), "error"))
      val f     = Future(Try(AssertStep.evaluateRules(Vector(Map[String, Any]("body" -> doomed(40))), rules)))(ExecutionContext.global)
      val out   = Try(Await.result(f, 10.seconds))
      withClue(s"$out") { out.get.failed.get shouldBe a[IllegalArgumentException] }
    }
  }
}
