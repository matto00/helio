package com.helio.domain.steps

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStepId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import scala.collection.immutable.{AbstractMap, AbstractSeq}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1630 task 2.3 (owner ruling `row-budget`, constraint C4): each row-multiplying kind refuses to exceed the draft ceiling,
 *  with its own exact message, and does so BEFORE or WHILE materialising rather than after.
 *
 *  The early-stop proofs are external to the step: the input is wrapped so that every element read is counted, and the assertion
 *  is on the counter, never on a value the step reports about itself. Fixtures are far past the bound well before the last
 *  input row (400 rows x 100 pieces against a bound of 20,000), never "just over", so reading all of them cannot pass for an
 *  early stop. */
class RowBudgetSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val now = Instant.now()
  private val pid = PipelineId("p")

  private def ctxWith(max: Int, lanes: Map[String, Seq[Row]] = Map.empty): PipelineExecutionContext =
    PipelineExecutionContext(dataSourceRepo = new DataSourceRepository(null)(ec), loadSource = _ => Future.successful(Seq.empty),
      resolveLane = lanes.get, maxNodeRows = Some(max))

  /** Counts every element read through `iterator`/`apply`; `length` is free, as for any Seq. */
  private final class CountingSeq[A](underlying: Vector[A]) extends AbstractSeq[A] {
    val reads = new AtomicInteger(0)
    def iterator: Iterator[A] = underlying.iterator.map { a => reads.incrementAndGet(); a }
    def apply(i: Int): A      = { reads.incrementAndGet(); underlying(i) }
    def length: Int           = underlying.length
  }

  /** A right-side join row whose `flatMap` calls are counted: `JoinColumnNaming.renameRightRow` is `row.flatMap`, and every
   *  merged pair goes through it, so this counts the merges that actually happened. */
  private final class CountingRow(underlying: Map[String, Any], val renames: AtomicInteger) extends AbstractMap[String, Any] {
    def get(key: String): Option[Any]               = underlying.get(key)
    def iterator: Iterator[(String, Any)]           = underlying.iterator
    def removed(key: String): Map[String, Any]      = underlying.removed(key)
    def updated[V1 >: Any](key: String, value: V1): Map[String, V1] = underlying.updated(key, value)
    override def flatMap[K2, V2](f: ((String, Any)) => IterableOnce[(K2, V2)]): Map[K2, V2] = {
      renames.incrementAndGet()
      underlying.flatMap(f)
    }
  }

  private def messageOf(f: => Any): String = intercept[StepConfigError](f).getMessage
  private def await[A](f: Future[A]): A = Await.result(f, 10.seconds)

  "join" should {
    def join(joinType: String = "inner") =
      JoinStep(PipelineStepId("j"), pid, 0, JoinConfig(SecondaryInput.Lane("r"), "k", joinType), now, now)
    def sameKey(n: Int): Vector[Row] = Vector.tabulate(n)(i => Map[String, Any]("k" -> 1, s"c$i" -> i))

    "pass at exactly the ceiling and refuse one pair over, naming the limit" in {
      await(join().evaluate(sameKey(10), ctxWith(100, Map("r" -> sameKey(10))))).size shouldBe 100
      messageOf(await(join().evaluate(sameKey(11), ctxWith(100, Map("r" -> sameKey(10)))))) shouldBe
        "join would produce more than 100 rows (draft preview limit)"
    }

    "count a left join's unmatched rows as one output row each" in {
      val left  = Vector.tabulate(5)(i => Map[String, Any]("k" -> (100 + i)))
      val right = sameKey(3)
      await(join("left").evaluate(left, ctxWith(5, Map("r" -> right)))).size shouldBe 5
      messageOf(await(join("left").evaluate(left, ctxWith(4, Map("r" -> right))))) should include("more than 4 rows")
    }

    "refuse a 150 x 150 one-key join (22,500 rows) against the real ceiling without merging a single pair" in {
      val renames = new AtomicInteger(0)
      val right   = Vector.tabulate(150)(i => new CountingRow(Map("k" -> 1, s"c$i" -> i), renames): Row)
      messageOf(await(join().evaluate(sameKey(150), ctxWith(RowBudget.DraftMaxNodeRows, Map("r" -> right))))) shouldBe
        "join would produce more than 20,000 rows (draft preview limit)"
      renames.get shouldBe 0
    }

    "merge every pair when under the ceiling, which is what makes the renames counter above mean something" in {
      val renames = new AtomicInteger(0)
      val right   = Vector.tabulate(10)(i => new CountingRow(Map("k" -> 1, s"c$i" -> i), renames): Row)
      await(join().evaluate(sameKey(10), ctxWith(1000, Map("r" -> right)))).size shouldBe 100
      renames.get shouldBe 100
    }
  }

  "unpivot" should {
    def unpivot(vars: Int) = UnpivotStep(PipelineStepId("u"), pid, 0, UnpivotConfig(Vector("id"), Vector.tabulate(vars)(i => s"v$i"), "var", "val"), now, now)

    "pass at exactly the ceiling and refuse above it before reading any input row" in {
      val ok = new CountingSeq(Vector.fill(10)(Map[String, Any]("id" -> 1)))
      await(unpivot(10).evaluate(ok, ctxWith(100))).size shouldBe 100
      val over = new CountingSeq(Vector.fill(400)(Map[String, Any]("id" -> 1)))
      messageOf(await(unpivot(100).evaluate(over, ctxWith(RowBudget.DraftMaxNodeRows)))) shouldBe
        "unpivot would produce more than 20,000 rows (draft preview limit)"
      over.reads.get shouldBe 0
      messageOf(await(unpivot(10).evaluate(new CountingSeq(Vector.fill(11)(Map[String, Any]("id" -> 1))), ctxWith(100)))) should include("more than 100 rows")
    }
  }

  private def text(piece: String, pieces: Int): String = Vector.fill(pieces)(piece).mkString("\n\n")

  "splittext" should {
    def split = SplitTextStep(PipelineStepId("s"), pid, 0, SplitTextConfig("body", "paragraph"), now, now)

    "stop reading input once past the ceiling, with its own message" in {
      val rows = new CountingSeq(Vector.fill(400)(Map[String, Any]("body" -> text("para", 100))))
      messageOf(await(split.evaluate(rows, ctxWith(RowBudget.DraftMaxNodeRows)))) shouldBe "splittext would produce more than 20,000 rows (draft preview limit)"
      rows.reads.get should be < 400
    }

    "pass at exactly the ceiling" in {
      await(split.evaluate(Vector.fill(2)(Map[String, Any]("body" -> text("para", 5))), ctxWith(10))).size shouldBe 10
      messageOf(await(split.evaluate(Vector.fill(2)(Map[String, Any]("body" -> text("para", 5))), ctxWith(9)))) should include("more than 9 rows")
    }
  }

  "chunkbytokencount" should {
    def chunk = ChunkByTokenCountStep(PipelineStepId("c"), pid, 0, ChunkByTokenCountConfig("body", targetTokenCount = 1), now, now)

    "stop reading input once past the ceiling, with its own message" in {
      val rows = new CountingSeq(Vector.fill(400)(Map[String, Any]("body" -> Vector.fill(100)("word").mkString(" "))))
      messageOf(await(chunk.evaluate(rows, ctxWith(RowBudget.DraftMaxNodeRows)))) shouldBe "chunkbytokencount would produce more than 20,000 rows (draft preview limit)"
      rows.reads.get should be < 400
    }
  }

  "extractheadings" should {
    def headings = ExtractHeadingsStep(PipelineStepId("h"), pid, 0, ExtractHeadingsConfig("body"), now, now)

    "stop reading input once past the ceiling, with its own message" in {
      val rows = new CountingSeq(Vector.fill(400)(Map[String, Any]("body" -> Vector.tabulate(100)(i => s"# heading $i").mkString("\n"))))
      messageOf(await(headings.evaluate(rows, ctxWith(RowBudget.DraftMaxNodeRows)))) shouldBe "extractheadings would produce more than 20,000 rows (draft preview limit)"
      rows.reads.get should be < 400
    }
  }

  "a run (maxNodeRows = None)" should {
    "stay unbounded for every guarded kind" in {
      val unbounded = ctxWith(1).copy(maxNodeRows = None)
      val rows      = Vector.fill(5)(Map[String, Any]("id" -> 1, "body" -> text("para", 5)))
      await(SplitTextStep(PipelineStepId("s"), pid, 0, SplitTextConfig("body", "paragraph"), now, now).evaluate(rows, unbounded)).size shouldBe 25
      await(UnpivotStep(PipelineStepId("u"), pid, 0, UnpivotConfig(Vector("id"), Vector("a", "b"), "var", "val"), now, now).evaluate(rows, unbounded)).size shouldBe 10
    }
  }
}
