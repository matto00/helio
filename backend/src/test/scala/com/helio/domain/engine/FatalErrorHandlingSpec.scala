package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.domain.steps.{StringOpsConfig, StringOpsStep}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.testsupport.RunBackendFixture
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import java.util.concurrent.ExecutionException
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1660 (owner rulings 7 and 8, design.md D7): the engine converts a step's NonFatal failure and a StackOverflowError into a
 *  step error, and nothing else.
 *
 *  Each fatal error is injected through a named seam: [[ThrowingStep]] throws it from `evaluate` (the synchronous path), and
 *  [[ReturningStep]] returns `Future.failed(error)` (the asynchronous path, where Scala 2.13 boxes an Error into an
 *  `ExecutionException`). Node position does not decide which path a failure takes. Every case runs on the first node: an uncaught
 *  fatal error on a later node escapes a `transformWith` callback and the walk never completes, so no spec throws one there. */
class FatalErrorHandlingSpec extends AnyWordSpec with Matchers with RunBackendFixture {

  private final case class ThrowingStep(id: PipelineStepId, error: Throwable) extends PipelineStep {
    val pipelineId: PipelineId                   = fixturePid
    val position: Int                            = 0
    val kind: String                             = "throwingprobe"
    val createdAt: Instant                       = fixtureNow
    val updatedAt: Instant                       = fixtureNow
    val parentStepId: Option[PipelineStepId]     = None
    val enabled: Boolean                         = true
    def configValue: Any                         = ()
    def evaluate(rows: Seq[Row], ctx: PipelineExecutionContext)(implicit ec: ExecutionContext): Future[Seq[Row]] = throw error
  }

  private final case class ReturningStep(id: PipelineStepId, error: Throwable) extends PipelineStep {
    val pipelineId: PipelineId                   = fixturePid
    val position: Int                            = 0
    val kind: String                             = "returningprobe"
    val createdAt: Instant                       = fixtureNow
    val updatedAt: Instant                       = fixtureNow
    val parentStepId: Option[PipelineStepId]     = None
    val enabled: Boolean                         = true
    def configValue: Any                         = ()
    def evaluate(rows: Seq[Row], ctx: PipelineExecutionContext)(implicit ec: ExecutionContext): Future[Seq[Row]] = Future.failed(error)
  }

  private val frames = Map[String, Seq[Row]](RootName -> Vector(Map[String, Any]("a" -> 1)))

  private def walk(step: PipelineStep): Future[TreeWalkResult] =
    engineOver(frames).executeTree(Vector((RootName, frames(RootName))), Vector(step), new PipelineStepRepository(null),
      Map(step.id -> PipelineRootId(RootName)), repoOver(frames))

  "an OutOfMemoryError" should {
    "thrown by the first step escape executeTree itself, not become a step error" in {
      val thrown = intercept[OutOfMemoryError](walk(ThrowingStep(PipelineStepId("t"), new OutOfMemoryError("probe thrown"))))
      thrown.getMessage shouldBe "probe thrown"
    }

    "returned by the first step as a failed Future fail the walk without a step error" in {
      val failure = intercept[Throwable](Await.result(walk(ReturningStep(PipelineStepId("r"), new OutOfMemoryError("probe returned"))), 10.seconds))
      failure should not be a[StepExecutionException]
      failure shouldBe a[ExecutionException]
      failure.getCause shouldBe a[OutOfMemoryError]
    }
  }

  "a StackOverflowError" should {
    "thrown by a step stay a step error naming the step, with the overflow as its cause" in {
      val failure = intercept[StepExecutionException](Await.result(walk(ThrowingStep(PipelineStepId("t"), new StackOverflowError)), 10.seconds))
      failure.stepId shouldBe "t"
      failure.stepKind shouldBe "throwingprobe"
      failure.getCause shouldBe a[StackOverflowError]
    }

    "returned by a step as a failed Future (boxed by Scala) be unwrapped and stay the same step error" in {
      val failure = intercept[StepExecutionException](Await.result(walk(ReturningStep(PipelineStepId("r"), new StackOverflowError)), 10.seconds))
      failure.stepId shouldBe "r"
      failure.stepKind shouldBe "returningprobe"
      failure.getCause shouldBe a[StackOverflowError]
    }

    "raised by a user regex in a real stringops step stay a step error on the run path" in {
      val text    = "ab" * 50000
      val step    = StringOpsStep(PipelineStepId("x"), fixturePid, 0, StringOpsConfig("extractRegex", "body", "out", Some("((?:a|b)*)c"), None, None, None), fixtureNow, fixtureNow)
      val failure = awaitRun(runOver(Map(RootName -> Vector(Map[String, Any]("body" -> text))), Vector(step))).failed.get
      failure shouldBe a[StepExecutionException]
      failure.getCause shouldBe a[StackOverflowError]
    }
  }

  "a NonFatal failure" should {
    "stay a step error" in {
      val failure = intercept[StepExecutionException](Await.result(walk(ThrowingStep(PipelineStepId("t"), new IllegalStateException("ordinary"))), 10.seconds))
      failure.getCause shouldBe a[IllegalStateException]
    }
  }
}
