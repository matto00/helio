package com.helio.services.pipelines

import com.helio.services.ServiceError

import java.util.UUID
import scala.concurrent.{Future, Promise}
import scala.util.Success

/** HEL-1544 / HEL-1564 -- the run's own `succeeded` terminal write COMMITS FIRST, then its pipeline is deleted: whatever the
 *  timing the run answers success and publishes exactly one `succeeded` (owner ruling). Also the narrowness control (the
 *  same failure with the pipeline present still fails) and D1b (a LOST write plus a post-fold failure answers 404).
 *  Orderings are forced through the seams in [[LateFinisherSpecBase]], never sleeps. */
class LateFinisherDeleteAfterWonSpec extends LateFinisherSpecBase {
  // ── The run's own terminal write COMMITS FIRST (HEL-1544): the delete lands after it, anywhere, and the answer is success (HEL-1564; before it, a lost write, is D7) ──

  "a run whose own succeeded terminal write committed before its pipeline was deleted (HEL-1544)" should {

    "answer success and publish succeeded when the delete also landed before the Output list was read, so no node guard runs" in {
      val fx = seed()
      val written = terminalWritten
      beforeOutputList = () => written.future.flatMap(_ => deletePipeline(fx)) // the delete is forced AFTER the run's own write
      val (res, _) = submit(fx)
      res.isRight shouldBe true
      awaitSucceeded(fx) shouldBe true
      eventsOf(fx).count(_ == "succeeded") shouldBe 1
    }

    "answer success and publish succeeded when the delete landed after the Output list was read, although a node guard then sees the run Missing (HEL-1564)" in {
      val fx = seed()
      val written = terminalWritten
      beforeNodeFold = () => written.future.flatMap(_ => deletePipeline(fx)) // after the list, and after the run's own write
      val (res, _) = submit(fx)
      res.isRight shouldBe true
      awaitSucceeded(fx) shouldBe true
      eventsOf(fx).count(_ == "succeeded") shouldBe 1
      nothingWritten(fx) // the first node's guard already saw the deletion
    }

    "answer success, keeping the node already written, when the delete landed between two node writes (HEL-1564)" in {
      val fx = seed()
      val written = terminalWritten
      afterNodeWrite = n => if (n == 1) written.future.flatMap(_ => deletePipeline(fx)) else Future.unit
      val res = submitWith(fx, binary = false)
      res.map(_.isRight) shouldBe Success(true)
      awaitSucceeded(fx) shouldBe true
      eventsOf(fx).count(_ == "succeeded") shouldBe 1
      count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe 3 // exactly one of the two nodes (which one is Set order)
      scalar(s"SELECT count(DISTINCT coalesce(node_step_id, root_id)) FROM node_snapshots WHERE pipeline_id = '${fx.pid.value}'").toInt shouldBe 1
      count("output_snapshot_history", "pipeline_id", fx.pid.value) shouldBe 0 // cascaded
      count("node_payload_history", "pipeline_id", fx.pid.value) shouldBe 0
    }

    "answer success when a post-fold binary-reference write fails because the pipeline was deleted after the run's own write won (HEL-1564)" in {
      val fx = seed()
      val written = terminalWritten
      val done    = foldDone
      binaryTarget = (fx.pid.value, fx.p.stepId.value)
      beforeBinaryWrite = () => written.future.flatMap(_ => done.future).flatMap { _ =>
        require(count("node_snapshots", "pipeline_id", fx.pid.value) == 6, "every node must be written before the delete")
        deletePipeline(fx)
      }
      val res = submitWith(fx)
      res.map(_.isRight) shouldBe Success(true)
      awaitSucceeded(fx) shouldBe true
      eventsOf(fx).count(_ == "succeeded") shouldBe 1
    }
  }

  // ── Narrowness control: the same failure with the pipeline still present is NOT recovered ──

  "a binary-reference write that fails while the pipeline still exists (HEL-1564 narrowness control)" should {

    "still fail the submit and still publish succeeded, exactly as before" in {
      val fx = seed()
      val written = terminalWritten
      val done    = foldDone
      binaryTarget = (UUID.randomUUID().toString, UUID.randomUUID().toString) // FK violation against a pipeline that never existed
      beforeBinaryWrite = () => written.future.flatMap(_ => done.future)
      val res = submitWith(fx)
      res.isFailure shouldBe true
      awaitSucceeded(fx) shouldBe true
      eventsOf(fx).count(_ == "succeeded") shouldBe 1
      count("pipelines", "id", fx.pid.value) shouldBe 1
    }
  }

  "a run whose terminal write lost to a delete that landed after the fold (HEL-1564 D1b)" should {

    "answer 404, publish no succeeded and leave no run row when a post-fold binary-reference write then fails on the deleted pipeline" in {
      val fx = seed()
      val deleted = Promise[Unit]()
      terminalGate = deleted.future // the run's own write must lose: it is held until the delete finished
      val done = foldDone
      binaryTarget = (fx.pid.value, fx.p.stepId.value)
      beforeBinaryWrite = () => done.future.flatMap(_ => deletePipeline(fx)).andThen { case _ => deleted.trySuccess(()) }
      val res = submitWith(fx)
      res shouldBe Success(Left(ServiceError.NotFound(s"Pipeline not found: ${fx.pid.value}")))
      eventsOf(fx) should not contain "succeeded"
      count("pipeline_runs", "pipeline_id", fx.pid.value) shouldBe 0
    }
  }
}
