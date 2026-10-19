package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, PipelineExecutionContext, PipelineId, PipelineRootId, PipelineStep, PipelineStepId, TruncationSink}
import com.helio.domain.steps.{ComputeConfig, ComputeStep, FilterCondition, FilterConfig, FilterStep, JoinConfig, JoinStep, RenameConfig, RenameStep, SecondaryInput, UnionConfig, UnionStep}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.collection.mutable.ArrayBuffer
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1630 task 2.1/2.2: the additive, defaulted seams `executeTree` gained for the draft preview, each proved to change
 *  nothing when left at its default and to do its one job when set. */
class InProcessPipelineEngineDraftSeamSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val engine     = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))
  private val stepRepo   = new PipelineStepRepository(null)(ec)
  private val dsRepo     = new DataSourceRepository(null)(ec)
  private val pipelineId = PipelineId("pipe-draft")
  private val rootId     = PipelineRootId("root")
  private val now        = Instant.now()

  private def rename(id: String, parent: Option[String], enabled: Boolean = true): RenameStep =
    RenameStep(PipelineStepId(id), pipelineId, 0, RenameConfig(Map("name" -> "n2")), now, now, parent.map(PipelineStepId(_)), enabled)

  private def keep(id: String, parent: Option[String]): FilterStep =
    FilterStep(PipelineStepId(id), pipelineId, 0, FilterConfig("and", Vector(FilterCondition("name", "=", Some("a")))), now, now, parent.map(PipelineStepId(_)))

  private def join(id: String, parent: Option[String], lane: String, joinType: String = "inner", position: Int = 0): JoinStep =
    JoinStep(PipelineStepId(id), pipelineId, position, JoinConfig(SecondaryInput.Lane(lane), "k", joinType), now, now, parent.map(PipelineStepId(_)))

  private def union(id: String, parent: Option[String], lane: String): UnionStep =
    UnionStep(PipelineStepId(id), pipelineId, 0, UnionConfig(SecondaryInput.Lane(lane), "byPosition"), now, now, parent.map(PipelineStepId(_)))

  private val frame: Seq[Map[String, Any]] = Seq(Map("name" -> "a", "k" -> 1), Map("name" -> "b", "k" -> 2))

  private type Hooks = (ArrayBuffer[String], ArrayBuffer[(String, String)])

  private def walk(
      steps: Vector[PipelineStep],
      externalLanes: Map[String, Seq[Map[String, Any]]] = Map.empty,
      onNodeError: Option[(PipelineStep, Throwable) => Unit] = None,
      onNodeFrame: (NodeKey, Seq[Map[String, Any]]) => Unit = (_, _) => (),
      shouldContinue: () => Boolean = () => true,
      contextTransform: PipelineExecutionContext => PipelineExecutionContext = identity,
      rootRows: Seq[Map[String, Any]] = frame
  ) = {
    val rootIdOfStep = steps.filter(_.parentStepId.isEmpty).map(_.id -> rootId).toMap
    engine.executeTree(
      Vector((rootId.value, rootRows)), steps, stepRepo, rootIdOfStep, dsRepo, new AssertionSink, new TruncationSink,
      contextTransform = contextTransform, externalLanes = externalLanes, onNodeFrame = onNodeFrame, onNodeError = onNodeError, shouldContinue = shouldContinue
    )
  }
  private def await[A](f: Future[A]): A = Await.result(f, 10.seconds)

  "dependentsClosure" should {
    "follow child and lane edges transitively and exclude the seeds" in {
      val steps = Vector(rename("a", None), rename("b", Some("a")), rename("c", None), join("d", Some("c"), lane = "b"), rename("e", Some("d")), rename("f", None))
      InProcessPipelineEngine.dependentsClosure(steps, Set("a")) shouldBe Set("b", "d", "e")
      InProcessPipelineEngine.dependentsClosure(steps, Set("b")) shouldBe Set("d", "e")
      InProcessPipelineEngine.dependentsClosure(steps, Set("f")) shouldBe Set.empty
    }
  }

  "externalLanes" should {
    "satisfy a lane reference to a step outside the walked steps, and without them the walk is rejected" in {
      val steps = Vector(join("j", None, lane = "outside"))
      val ext   = Map("outside" -> Seq(Map[String, Any]("k" -> 1, "extra" -> "x")))
      val out   = await(walk(steps, externalLanes = ext))
      out.nodeOutcomes(StepKey("j")).rows.map(_("extra")) shouldBe Seq("x")
      a[LaneReferenceError] should be thrownBy await(walk(steps))
    }
  }

  "onNodeFrame" should {
    "see every node in evaluation order, a disabled one included" in {
      val seen = ArrayBuffer.empty[String]
      await(walk(Vector(rename("a", None), rename("b", Some("a"), enabled = false), keep("c", Some("b"))), onNodeFrame = (k, _) => seen += k.toString))
      seen.toVector shouldBe Vector("StepKey(a)", "StepKey(b)", "StepKey(c)")
    }
  }

  "the walk order" should {
    // a (position 1, visited first by structuralRank: highest position first) has the child a1; b (position 0) is a leaf.
    // structuralRank runs a, a1, b; leaf-first runs b before a descends.
    val branching = Vector(
      RenameStep(PipelineStepId("a"), pipelineId, 1, RenameConfig(Map("name" -> "n2")), now, now, None),
      RenameStep(PipelineStepId("a1"), pipelineId, 0, RenameConfig(Map("n2" -> "n3")), now, now, Some(PipelineStepId("a"))),
      RenameStep(PipelineStepId("b"), pipelineId, 0, RenameConfig(Map("name" -> "n2")), now, now, None)
    )
    def orderOf(contextTransform: PipelineExecutionContext => PipelineExecutionContext): Vector[String] = {
      val seen = ArrayBuffer.empty[String]
      await(walk(branching, onNodeFrame = (k, _) => seen += k.toString, contextTransform = contextTransform))
      seen.toVector
    }

    "stay structuralRank for a run and the saved preview (no live-cell budget): leaf-first is draft-only" in {
      orderOf(identity) shouldBe Vector("StepKey(a)", "StepKey(a1)", "StepKey(b)")
    }

    "finish a leaf before descending for a draft (a live-cell budget set)" in {
      orderOf(_.copy(maxLiveCells = Some(1000000L))) shouldBe Vector("StepKey(b)", "StepKey(a)", "StepKey(a1)")
    }
  }

  "the node's text headroom" should {
    // 100 root rows, each a DISTINCT 100-character text: 2 cells a row (200) plus 4 text cells each (400) = 600 held. A compute
    // `concat($t)` writes a 100-character text per row (200 bytes each).
    val rootRows = Vector.tabulate(100)(i => Map[String, Any]("t" -> new String(("x" * 99 + (i % 10)).toCharArray), "i" -> i))
    val compute  = ComputeStep(PipelineStepId("c"), pipelineId, 0, ComputeConfig("o", "concat($t)", None), now, now, None)

    def errorOf(maxLiveCells: Long): Option[String] = {
      val errors = ArrayBuffer.empty[String]
      await(walk(Vector(compute), rootRows = rootRows, onNodeError = Some((_, ex) => errors += ex.getMessage),
        contextTransform = _.copy(maxLiveCells = Some(maxLiveCells), maxStringChars = Some(1000))))
      errors.headOption
    }

    "be what the request has left (budget minus what is held): 5 cells of room refuse the node inside it, with the text-limit message" in {
      // Held is 600; 605 leaves 5 cells = 230 bytes: the second 200-byte text is over. Were the headroom the whole budget (605 cells =
      // 27,830 bytes), all 100 texts (20,000 bytes) would fit, and only the post-node memory check would refuse the frame.
      val message = errorOf(605L).get
      message should include("Draft preview text limit")
      message should include("of new text at once")
    }

    "let the same node through the text budget when the request has room" in {
      // 600 held; room for the new frame (300 cells) and 100 new texts is well under 5,000 cells, so no limit is reached.
      errorOf(5000L) shouldBe None
    }
  }

  "onNodeError" should {
    // x fails (unsupported join type); y is its child; z is a lane dependent of x; w is an independent branch.
    val steps = Vector(
      join("x", None, lane = "ext", joinType = "full"), rename("y", Some("x")),
      rename("w", None), join("z", Some("w"), lane = "x", position = 1)
    )
    val ext = Map("ext" -> Seq(Map[String, Any]("k" -> 1)))

    "record the failure, prune its children and lane dependents, and keep walking independent branches" in {
      val failures = ArrayBuffer.empty[String]
      val frames   = ArrayBuffer.empty[String]
      val out = await(walk(steps, ext, onNodeError = Some((s, _) => failures += s.id.value), onNodeFrame = (k, _) => frames += k.toString))
      failures.toVector shouldBe Vector("x")
      frames.toVector shouldBe Vector("StepKey(w)")
      out.nodeOutcomes.keySet should contain(StepKey("w"))
      out.nodeOutcomes.keySet should not contain StepKey("y")
      out.nodeOutcomes.keySet should not contain StepKey("z")
    }

    "keep today's fail-fast behaviour when unset" in {
      val e = intercept[StepExecutionException](await(walk(steps, ext)))
      e.stepId shouldBe "x"
    }

    "never catch an exception thrown by onNodeFrame or shouldContinue" in {
      val ok = Vector(rename("a", None), rename("b", Some("a")))
      a[IllegalStateException] should be thrownBy await(
        walk(ok, onNodeError = Some((_, _) => ()), onNodeFrame = (_, _) => throw new IllegalStateException("hook"))
      )
      a[IllegalStateException] should be thrownBy await(
        walk(ok, onNodeError = Some((_, _) => ()), shouldContinue = () => throw new IllegalStateException("poll"))
      )
    }
  }

  "shouldContinue" should {
    "fail the walk with DraftPreviewCancelled before the next node starts" in {
      val evaluated = ArrayBuffer.empty[String]
      var go        = true
      a[DraftPreviewCancelled] should be thrownBy await(
        walk(
          Vector(rename("a", None), rename("b", Some("a")), rename("c", Some("b"))),
          onNodeError = Some((_, _) => ()),
          onNodeFrame = (k, _) => { evaluated += k.toString; go = false },
          shouldContinue = () => go
        )
      )
      evaluated.toVector shouldBe Vector("StepKey(a)")
    }
  }

  "contextTransform, maxNodeRows and frameGuard" should {
    val three = Seq(Map[String, Any]("name" -> "a", "k" -> 1), Map("name" -> "b", "k" -> 2), Map("name" -> "c", "k" -> 3))

    "fail a node over the row ceiling with the distinct backstop message, isolated when onNodeError is set" in {
      val steps    = Vector(union("u", None, lane = "ext"))
      val messages = ArrayBuffer.empty[String]
      await(walk(steps, Map("ext" -> three), Some((_, e) => messages += e.asInstanceOf[StepExecutionException].reason), contextTransform = _.copy(maxNodeRows = Some(4))))
      messages.toVector shouldBe Vector("node produced 5 rows, over the draft preview limit of 4")
      val e = intercept[StepExecutionException](await(walk(steps, Map("ext" -> three), contextTransform = _.copy(maxNodeRows = Some(4)))))
      e.reason shouldBe "node produced 5 rows, over the draft preview limit of 4"
    }

    "leave a node at exactly the ceiling alone" in {
      val out = await(walk(Vector(union("u", None, lane = "ext")), Map("ext" -> three), contextTransform = _.copy(maxNodeRows = Some(5))))
      out.nodeOutcomes(StepKey("u")).rows.size shouldBe 5
    }

    "fail a node whose frame the guard refuses" in {
      val messages = ArrayBuffer.empty[String]
      await(walk(Vector(rename("a", None)), onNodeError = Some((_, e) => messages += e.asInstanceOf[StepExecutionException].reason), contextTransform = _.copy(frameGuard = Some(_ => Some("value type not previewable")))))
      messages.toVector shouldBe Vector("value type not previewable")
    }
  }
}
