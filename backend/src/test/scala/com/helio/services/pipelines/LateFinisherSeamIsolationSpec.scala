package com.helio.services.pipelines

import com.helio.domain.engine.{NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome, SourceReadStats}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import spray.json.{JsObject, JsString}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

/** HEL-1565 -- a seam call that outlives its test must touch only the state of the test that STARTED it. Each test drives
 *  one [[LateFinisherSpecBase]] seam DIRECTLY, holds the call on a promise the test completes itself, simulates the test
 *  boundary with the same [[resetSeams]] `afterEach` runs, releases the call, and asserts the OLD state was driven and
 *  the NEW state was not. No sleeps: every wait is on a Future this spec completes.
 *
 *  This tests test infrastructure on purpose (the defect lives there). Limit: capture-at-start does NOT cover a call that
 *  a still-running chain STARTS after `afterEach` (the fold's next node write, or `HookOutputRepo` consuming the next
 *  test's hooks) -- such a call legitimately starts under the new test's state. */
class LateFinisherSeamIsolationSpec extends LateFinisherSpecBase {

  private val rows = Seq(JsObject("label" -> JsString("a")))

  private def heldWrite(repo: HookSnapshotRepo, fx: Fx, release: Promise[Unit]): Future[Unit] =
    repo.overwriteRowsWith(fx.pid.value, Some(fx.p.stepId.value), rows, None, DBIO.from(release.future))

  "a seam call that outlives its test" should {

    "complete its own test's terminalWritten, not the next test's (GatedRunRepo)" in {
      val fx      = seed()
      val oldDone = terminalWritten
      val gate    = Promise[Unit]()
      terminalGate = gate.future
      // an unknown run id: the write itself fails, which is fine -- the signal is raised on any completion
      val call = new GatedRunRepo(ctx).updateRunTerminal(
        PipelineRunId(UUID.randomUUID().toString), "succeeded", Instant.now(), None, None, AuthenticatedUser(UserId(fx.owner)), None
      )
      resetSeams()
      gate.success(())
      Await.ready(call, 20.seconds)
      oldDone.isCompleted shouldBe true
      terminalWritten.isCompleted shouldBe false
    }

    "run its own test's afterEngine hook, not the next test's (HookBackend)" in {
      val held = Promise[PipelineExecutionOutcome]()
      val stub = new PipelineExecutionBackend {
        override def execute(
            pipeline: Pipeline, roots: Vector[(String, DataSource)], steps: Vector[PipelineStep], dataSourceRepo: DataSourceRepository,
            assertionSink: AssertionSink, truncationSink: TruncationSink, onNodeProgress: (NodeKey, Long) => Unit,
            writeBackSink: WriteBackSink, ownerUserId: Option[String]
        )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = held.future
      }
      val oldHook = Promise[Unit]()
      afterEngine = () => { oldHook.trySuccess(()); Future.unit }
      val call = new HookBackend(stub).execute(null, Vector.empty, Vector.empty, null, null, null)
      resetSeams()
      val newHook = Promise[Unit]()
      afterEngine = () => { newHook.trySuccess(()); Future.unit }
      held.success(PipelineExecutionOutcome(Seq.empty, Map.empty, 0L, SourceReadStats(truncated = false, availableRowCount = None)))
      Await.result(call, 20.seconds)
      oldHook.isCompleted shouldBe true
      newHook.isCompleted shouldBe false
    }

    "advance its own test's node-write counter, not the next test's (HookSnapshotRepo counter)" in {
      val fx      = seed()
      val release = Promise[Unit]()
      val call    = heldWrite(new HookSnapshotRepo(ctx), fx, release)
      resetSeams()
      release.success(())
      Await.result(call, 20.seconds)
      nodeWrites.get shouldBe 0
    }

    "invoke its own test's afterNodeWrite hook, not the next test's (HookSnapshotRepo afterNodeWrite)" in {
      val fx      = seed()
      val oldHook = Promise[Unit]()
      afterNodeWrite = _ => { oldHook.trySuccess(()); Future.unit }
      val release = Promise[Unit]()
      val call    = heldWrite(new HookSnapshotRepo(ctx), fx, release)
      resetSeams()
      val newHook = Promise[Unit]()
      afterNodeWrite = _ => { newHook.trySuccess(()); Future.unit }
      release.success(())
      Await.result(call, 20.seconds)
      oldHook.isCompleted shouldBe true
      newHook.isCompleted shouldBe false
    }

    "complete its own test's foldDone, not the next test's (HookSnapshotRepo foldDone)" in {
      val fx      = seed()
      val oldFold = foldDone
      val repo    = new HookSnapshotRepo(ctx)
      // the OLD test's first write lands (n = 1) BEFORE the boundary; its second is the one held across it
      Await.result(heldWrite(repo, fx, { val p = Promise[Unit](); p.success(()); p }), 20.seconds)
      oldFold.isCompleted shouldBe false
      val release = Promise[Unit]()
      val call    = heldWrite(repo, fx, release)
      resetSeams()
      release.success(())
      Await.result(call, 20.seconds)
      oldFold.isCompleted shouldBe true
      foldDone.isCompleted shouldBe false
    }
  }
}
