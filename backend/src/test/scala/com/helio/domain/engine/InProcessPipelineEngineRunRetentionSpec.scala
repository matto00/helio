package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.model.{AssertionSink, PipelineId, PipelineRootId, PipelineStep, PipelineStepId, TruncationSink}
import com.helio.domain.steps.{RenameConfig, RenameStep, UpsertMode, UpsertSourceConfig, UpsertSourceStep, UpsertTarget}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1660 (design.md D3/D3a): what `runRetention` keeps. Each effect is its own case with its own mutation (evidence/mutations.md):
 *  dropping terminal retention, root pinning or write-back pinning turns exactly its case red.
 *
 *  The live-cell tally is private, so the pinning cases observe it through the budget: a frame the tally still counts makes a later
 *  node pass the cell budget, a frame it released does not. Every frame here is `n` rows x 1 cell. */
class InProcessPipelineEngineRunRetentionSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val engine   = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))
  private val stepRepo = new PipelineStepRepository(null)(ec)
  private val dsRepo   = new DataSourceRepository(null)(ec)
  private val pid      = PipelineId("p")
  private val now      = Instant.now()

  private def rename(id: String, parent: Option[String]): PipelineStep =
    RenameStep(PipelineStepId(id), pid, 0, RenameConfig(Map("v" -> "v")), now, now, parent.map(PipelineStepId(_)))

  private def upsert(id: String, parent: Option[String], enabled: Boolean = true): PipelineStep =
    UpsertSourceStep(PipelineStepId(id), pid, 0, UpsertSourceConfig(UpsertTarget.NewSource("out"), UpsertMode.Append), now, now, parent.map(PipelineStepId(_)), enabled)

  private def frame(n: Int): Seq[Row] = Vector.tabulate(n)(i => Map[String, Any]("v" -> i))

  private def walk(roots: Vector[(String, Seq[Row])], steps: Vector[PipelineStep], rootOf: Map[String, String], retain: Set[NodeKey], maxLiveCells: Long,
                   runRetention: Boolean = true): Future[TreeWalkResult] =
    engine.executeTree(roots, steps, stepRepo, steps.filter(_.parentStepId.isEmpty).map(s => s.id -> PipelineRootId(rootOf(s.id.value))).toMap, dsRepo,
      new AssertionSink, new TruncationSink, contextTransform = RunLimits.contextTransform.andThen(_.copy(maxLiveCells = Some(maxLiveCells))),
      retainOnly = Some(retain), runRetention = runRetention)

  private def await[A](f: Future[A]): A = Await.result(f, 10.seconds)
  private def memoryRefusal(f: Future[TreeWalkResult]): StepExecutionException = intercept[StepExecutionException](await(f))

  "the trunk terminal" should {
    "stay in nodeOutcomes, and be the result rows, even when the retain set names only an earlier node" in {
      val steps = Vector(rename("a", None), rename("b", Some("a")), rename("c", Some("b")))
      val out   = await(walk(Vector(("r", frame(5))), steps, Map("a" -> "r"), Set(StepKey("a")), maxLiveCells = 1000))
      out.rows.size shouldBe 5
      out.nodeOutcomes.keySet should contain(StepKey("c"))
      out.nodeOutcomes.keySet should contain(StepKey("a"))
      out.nodeOutcomes.keySet should not contain StepKey("b")
    }

    "fall back to the lowest root, and keep it, when that root has no trunk steps" in {
      val steps = Vector(rename("a", None))
      val out   = await(walk(Vector(("r1", frame(3)), ("r2", frame(7))), steps, Map("a" -> "r2"), Set(StepKey("a")), maxLiveCells = 1000))
      out.rows.size shouldBe 3
      out.nodeOutcomes.keySet should contain(RootKey("r1"))
    }

    "be dropped by a draft-style walk (no runRetention), which is why the flag is run-only" in {
      val steps = Vector(rename("a", None), rename("b", Some("a")))
      val out   = await(walk(Vector(("r", frame(5))), steps, Map("a" -> "r"), Set(StepKey("a")), maxLiveCells = 1000, runRetention = false))
      out.rows shouldBe empty
    }
  }

  "a root frame" should {
    "stay charged after release drops it: R(40) + a(40) + b(40) = 120 is refused by a budget of 100" in {
      val steps = Vector(rename("a", None), rename("b", Some("a")))
      val e     = memoryRefusal(walk(Vector(("r", frame(40))), steps, Map("a" -> "r"), Set.empty, maxLiveCells = 100))
      e.stepId shouldBe "b"
      e.getMessage should include("Pipeline run memory limit reached")
    }

    "not stay charged in a walk without runRetention (control: the same walk fits when the root is released)" in {
      val steps = Vector(rename("a", None), rename("b", Some("a")))
      await(walk(Vector(("r", frame(40))), steps, Map("a" -> "r"), Set.empty, maxLiveCells = 100, runRetention = false)).stepCounts.keySet should contain("b")
    }
  }

  "an enabled upsertsource step's frame" should {
    // R(40) + u(40) + c1(40) + c2(40) = 160 while u is pinned for its pending write-back; 120 once it is released.
    val chain = Vector(upsert("u", None), rename("c1", Some("u")), rename("c2", Some("c1")))

    "stay charged after release, because the write-back sink still holds its input until applyWriteBacks" in {
      val e = memoryRefusal(walk(Vector(("r", frame(40))), chain, Map("u" -> "r"), Set.empty, maxLiveCells = 140))
      e.stepId shouldBe "c2"
      e.getMessage should include("Pipeline run memory limit reached")
    }

    "not stay charged when the upsertsource step is disabled (it records no write)" in {
      val disabled = Vector(upsert("u", None, enabled = false), rename("c1", Some("u")), rename("c2", Some("c1")))
      await(walk(Vector(("r", frame(40))), disabled, Map("u" -> "r"), Set.empty, maxLiveCells = 140)).rows.size shouldBe 40
    }
  }
}
