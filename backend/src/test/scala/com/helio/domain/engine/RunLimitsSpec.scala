package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.model.PipelineStep
import com.helio.domain.steps.{ExtractHeadingsConfig, ExtractHeadingsStep, LimitLabel, SecondaryInput, SplitTextConfig, SplitTextStep, StepConfigError}
import spray.json.{JsString, JsValue}
import com.helio.testsupport.RunBackendFixture
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.concurrent.atomic.AtomicInteger
import scala.collection.immutable.AbstractMap
import scala.util.{Failure, Success}

/** HEL-1660 (owner rulings 2-5): every real run and the saved preview reach the engine through `InProcessExecutionBackend.execute`;
 *  this spec drives that entry over in-memory frames and asserts each kind's bound with its exact run wording.
 *
 *  Written red first: on the code before the fix none of these limits exists, so each case fails with what the unbounded run did
 *  (rows produced, or a swallowed OutOfMemoryError reported as "step execution failed"). The failure text of `limitOrFail` names that. */
class RunLimitsSpec extends AnyWordSpec with Matchers with RunBackendFixture {

  /** The owner-ruled caps, written as literals here so a changed constant cannot silently move the spec with it. */
  private val MaxRows  = 100000
  private val MaxChars = 1048576

  private def rows(n: Int)(f: Int => Row): Vector[Row] = Vector.tabulate(n)(f)
  private def oneKey(n: Int, extra: String = "c"): Vector[Row] = rows(n)(i => Map[String, Any]("k" -> 1, s"$extra$i" -> i))

  /** Runs `steps`; the run must fail at `stepId`/`kind` with a message containing `part`. A run that succeeds or fails otherwise
   *  reports what it did, which is the red evidence on unchanged code. */
  private def limitOrFail(frames: Map[String, Seq[Row]], steps: Vector[PipelineStep], stepId: String, kind: String, part: String): StepExecutionException =
    awaitRun(runOver(frames, steps)) match {
      case Success(o) =>
        fail(s"NO LIMIT FIRED: the run succeeded; step counts ${o.stepCounts}, trunk rows ${o.rows.size}, heap in use ${usedHeapAfterGcMb()} MB")
      case Failure(e: StepExecutionException) =>
        withClue(s"failed with: ${e.getMessage}; cause ${e.getCause}; ") {
          e.stepId shouldBe stepId
          e.stepKind shouldBe kind
          e.getMessage should include(part)
          e.getMessage should not include "draft preview"
          e.getMessage should not include "Draft preview"
        }
        e
      case Failure(other) => fail(s"failed outside a step: $other")
    }

  private final class CountingRow(underlying: Map[String, Any], val merges: AtomicInteger) extends AbstractMap[String, Any] {
    def get(key: String): Option[Any]                               = underlying.get(key)
    def iterator: Iterator[(String, Any)]                           = underlying.iterator
    def removed(key: String): Map[String, Any]                      = underlying.removed(key)
    def updated[V1 >: Any](key: String, value: V1): Map[String, V1] = underlying.updated(key, value)
    override def flatMap[K2, V2](f: ((String, Any)) => IterableOnce[(K2, V2)]): Map[K2, V2] = {
      merges.incrementAndGet()
      underlying.flatMap(f)
    }
  }

  "join" should {
    "refuse a 400 x 400 one-key fan-out (160,000 rows) before merging a single pair, naming the run limit" in {
      val merges = new AtomicInteger(0)
      val right  = Vector.tabulate(400)(i => new CountingRow(Map("k" -> 1, s"r$i" -> i), merges): Row)
      limitOrFail(Map(RootName -> oneKey(400), "right" -> right), Vector(joinStep("j", SecondaryInput.Source("right"))), "j", "join",
        "join would produce more than 100,000 rows (pipeline run limit)")
      merges.get shouldBe 0
    }

    "pass at the limit: 250 x 400 is exactly 100,000 rows" in {
      val out = awaitRun(runOver(Map(RootName -> oneKey(250), "right" -> oneKey(400, "r")), Vector(joinStep("j", SecondaryInput.Source("right"))))).get
      out.rows.size shouldBe MaxRows
    }
  }

  "unpivot" should {
    "refuse 20,001 rows x 5 value columns (100,005 rows) up front" in {
      limitOrFail(Map(RootName -> rows(20001)(i => Map[String, Any]("id" -> i, "v0" -> 1, "v1" -> 1, "v2" -> 1, "v3" -> 1, "v4" -> 1))),
        Vector(unpivotStep("u", 5)), "u", "unpivot", "unpivot would produce more than 100,000 rows (pipeline run limit)")
    }

    "pass at the limit: 50,000 rows x 2 value columns is exactly 100,000 rows" in {
      val out = awaitRun(runOver(Map(RootName -> rows(50000)(i => Map[String, Any]("id" -> i, "v0" -> 1, "v1" -> 1))), Vector(unpivotStep("u", 2)))).get
      out.rows.size shouldBe MaxRows
    }
  }

  private def paragraphs(n: Int): String = Vector.fill(n)("para").mkString("\n\n")

  "splittext, chunkbytokencount and extractheadings" should {
    "refuse a split past 100,000 rows while emitting" in {
      limitOrFail(Map(RootName -> rows(400)(i => Map[String, Any]("body" -> paragraphs(400)))), Vector(splitStep("s")), "s", "splittext",
        "splittext would produce more than 100,000 rows (pipeline run limit)")
    }

    "refuse chunking past 100,000 rows while emitting" in {
      limitOrFail(Map(RootName -> rows(400)(i => Map[String, Any]("body" -> Vector.fill(400)("word").mkString(" ")))), Vector(chunkStep("c")), "c", "chunkbytokencount",
        "chunkbytokencount would produce more than 100,000 rows (pipeline run limit)")
    }

    "refuse headings past 100,000 rows while emitting" in {
      limitOrFail(Map(RootName -> rows(400)(i => Map[String, Any]("body" -> Vector.tabulate(400)(h => s"# heading $h").mkString("\n")))), Vector(headingsStep("h")), "h", "extractheadings",
        "extractheadings would produce more than 100,000 rows (pipeline run limit)")
    }
  }

  "the engine backstop" should {
    "refuse a union that stacks 50,000 + 100,000 rows, a kind with no emit-time check of its own" in {
      val frames = Map(RootName -> rows(50000)(i => Map[String, Any]("id" -> i, "v0" -> 1, "v1" -> 1)))
      val steps  = Vector(unpivotStep("lane", 2), unionStep("u", "lane", position = 1))
      limitOrFail(frames, steps, "u", "union", "node produced 150000 rows, over the pipeline run limit of 100,000")
    }
  }

  "the live-cell budget" should {
    "refuse a join whose 90,000-row output would hold more cells than the budget, naming the pipeline run memory limit" in {
      // 300 x 300 = 90,000 rows, under the row cap; the columns make the node's cells pass the budget.
      val columns = (RunLimits.MaxLiveCells / 90000 / 2).toInt + 2
      def side(prefix: String) = rows(300)(i => Map[String, Any]("k" -> 1) ++ (0 until columns).map(c => s"$prefix$c" -> (i + c)).toMap)
      val e = limitOrFail(Map(RootName -> side("l"), "right" -> side("r")), Vector(joinStep("j", SecondaryInput.Source("right"))), "j", "join", "Pipeline run memory limit reached")
      e.getMessage should include(s"more than ${RunLimits.MaxLiveCells} cells at once")
    }
  }

  private def doublingChain(from: Int, count: Int): Vector[PipelineStep] =
    Vector.tabulate(count)(n => computeStep(s"d${n + 1}", s"d${n + 1}", if (n == 0) s"concat($$pad, $$pad)" else s"concat($$d$n, $$d$n)", if (n == 0) None else Some(s"d$n")))

  "text-creating steps" should {
    "stop a doubling concat before it builds a text past 1,048,576 characters" in {
      val frames = Map(RootName -> rows(1)(_ => Map[String, Any]("pad" -> ("x" * 1000))))
      // d10 is 1000 x 2^10 = 1,024,000 characters and fits; d11 doubles it to 2,048,000.
      limitOrFail(frames, doublingChain(1000, 12), "d11", "compute", s"text value of more than $MaxChars characters")
    }

    def fanOut(text: String): Map[String, Seq[Row]] =
      Map(RootName -> rows(1)(_ => Map[String, Any]("k" -> 1, "i" -> 0, "pad" -> text)), "lane" -> rows(10000)(i => Map[String, Any]("k" -> 1, "side" -> i)))
    val fanOutJoin = joinStep("s0", SecondaryInput.Source("lane"))

    "refuse a concat or a + that would build a text past 1,048,576 characters BEFORE building it (the expression guard, apart from the post-step charge)" in {
      val row = Map[String, JsValue]("t" -> JsString("x" * 600000))
      Seq("concat($t, $t)", "$t + $t").foreach { expression =>
        val e = intercept[StepConfigError](ExpressionEvaluator.compile(expression).toOption.get.eval(row, MaxChars, LimitLabel.Run))
        e.getMessage shouldBe s"Pipeline run text limit reached: this step would create a text value of more than $MaxChars characters. Shorten the expression or the text it joins."
      }
    }

    "refuse one splittext segment past 1,048,576 characters, the per-value cap that is separate from the node's running total" in {
      limitOrFail(Map(RootName -> rows(1)(_ => Map[String, Any]("body" -> ("y" * (MaxChars + 1))))), Vector(splitStep("s")), "s", "splittext",
        s"text value of more than $MaxChars characters")
    }

    "stop a compute that copies a 100,000-character text across a 10,000-row fan-out inside the node (4 GB unbounded)" in {
      limitOrFail(fanOut("x" * 100000), Vector(fanOutJoin, computeStep("t1", "t1", "concat($pad, $pad)", Some("s0"))), "t1", "compute",
        "which is what this run has left")
    }

    "stop splittext over the same fan-out inside the node" in {
      limitOrFail(fanOut("x" * 99999 + " "), Vector(fanOutJoin, splitStepOn("t1", "pad", Some("s0"))), "t1", "splittext", "which is what this run has left")
    }

    "stop extractheadings over the same fan-out inside the node" in {
      limitOrFail(fanOut("# " + "x" * 99998), Vector(fanOutJoin, headingsStepOn("t1", "pad", Some("s0"))), "t1", "extractheadings", "which is what this run has left")
    }

    "stop pivot column names (a fresh copy of the pivot value per group) inside the node" in {
      limitOrFail(fanOut("x" * 100000), Vector(fanOutJoin, pivotStep("t1", Some("s0"))), "t1", "pivot", "which is what this run has left")
    }
  }

  private def splitStepOn(id: String, field: String, parent: Option[String]): PipelineStep =
    SplitTextStep(sid(id), fixturePid, 0, SplitTextConfig(field, "paragraph"), fixtureNow, fixtureNow, parent.map(sid))

  private def headingsStepOn(id: String, field: String, parent: Option[String]): PipelineStep =
    ExtractHeadingsStep(sid(id), fixturePid, 0, ExtractHeadingsConfig(field), fixtureNow, fixtureNow, parent.map(sid))

  "a pipeline under every limit" should {
    "produce the rows and step counts the unbounded flat walk produces" in {
      val frames = Map(RootName -> rows(200)(i => Map[String, Any]("k" -> (i % 7), "name" -> s"n$i", "v" -> i)))
      val steps  = Vector(computeStep("a", "w", "v + 1"), computeStep("b", "x", "concat($name, $w)", Some("a")))
      val tree   = awaitRun(runOver(frames, steps)).get
      val flat   = awaitRun(engineOver(frames).executeWithStepCounts(frames(RootName), steps, repoOver(frames))).get
      tree.rows shouldBe flat._1
      tree.stepCounts shouldBe flat._2
    }
  }
}
