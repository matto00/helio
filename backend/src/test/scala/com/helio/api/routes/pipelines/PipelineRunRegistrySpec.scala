package com.helio.api.routes.pipelines

import com.helio.api.routes.pipelines.RunStatusEvent
import com.helio.api.routes.pipelines.PipelineRunRegistry
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer}
import org.apache.pekko.stream.scaladsl.Sink
import org.scalatest.concurrent.Eventually
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** Unit tests for PipelineRunRegistry publish/subscribe behaviour.
  * These tests exercise the registry in isolation (no HTTP layer).
  */
class PipelineRunRegistrySpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with Eventually {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  "PipelineRunRegistry" should {

    "publish events to a subscriber in the order they were sent" in {
      val registry = new PipelineRunRegistry()
      val pid      = "pipe-registry-order"

      // Subscribe BEFORE publishing so the actor ref is stored.
      val eventsFuture = registry
        .subscribe(pid)
        .take(3)
        .runWith(Sink.seq)(Materializer(system))

      // Publish three events; the third is terminal and completes the source.
      registry.publish(pid, RunStatusEvent("queued"))
      registry.publish(pid, RunStatusEvent("running"))
      registry.publish(pid, RunStatusEvent("succeeded", rowCount = Some(7)))

      val events = Await.result(eventsFuture, 5.seconds)

      events should have size 3
      events(0).status   shouldBe "queued"
      events(1).status   shouldBe "running"
      events(2).status   shouldBe "succeeded"
      events(2).rowCount shouldBe Some(7)
    }

    "complete the source stream when a terminal event is published" in {
      val registry = new PipelineRunRegistry()
      val pid      = "pipe-registry-terminal"

      val eventsFuture = registry
        .subscribe(pid)
        .runWith(Sink.seq)(Materializer(system))

      registry.publish(pid, RunStatusEvent("queued"))
      registry.publish(pid, RunStatusEvent("failed", errorLog = Some("boom")))

      val events = Await.result(eventsFuture, 5.seconds)

      events should have size 2
      events(1).status   shouldBe "failed"
      events(1).errorLog shouldBe Some("boom")
    }

    "be a no-op when publishing to a pipeline with no subscriber" in {
      val registry = new PipelineRunRegistry()
      // Should not throw
      registry.publish("no-subscriber", RunStatusEvent("queued"))
    }

    // HEL-1168 task 3.2: closes the pre-fix red (single-slot `put` overwrite silently starved
    // the first of two concurrent subscribers -- demonstrated separately, see files-modified.md,
    // by reverting this file's `refs` map to the old `ConcurrentHashMap[String, ActorRef]` shape
    // and re-running this exact test).
    "deliver a published event to BOTH of two concurrently subscribed clients for the same pipeline" in {
      val registry = new PipelineRunRegistry()
      val pid      = "pipe-registry-multi-subscriber"

      val firstFuture  = registry.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))
      val secondFuture = registry.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))

      registry.publish(pid, RunStatusEvent("running"))

      Await.result(firstFuture, 5.seconds).map(_.status)  shouldBe Seq("running")
      Await.result(secondFuture, 5.seconds).map(_.status) shouldBe Seq("running")
    }

    // HEL-1168 task 1.3: a terminal event must reach EVERY current subscriber, not just one,
    // before the pipeline's map entry is cleared.
    "deliver a terminal event to both of two subscribed clients before clearing the pipeline entry" in {
      val registry = new PipelineRunRegistry()
      val pid      = "pipe-registry-multi-subscriber-terminal"

      val firstFuture  = registry.subscribe(pid).runWith(Sink.seq)(Materializer(system))
      val secondFuture = registry.subscribe(pid).runWith(Sink.seq)(Materializer(system))

      registry.publish(pid, RunStatusEvent("queued"))
      registry.publish(pid, RunStatusEvent("succeeded", rowCount = Some(4)))

      val firstEvents  = Await.result(firstFuture, 5.seconds)
      val secondEvents = Await.result(secondFuture, 5.seconds)
      firstEvents.map(_.status)  shouldBe Seq("queued", "succeeded")
      secondEvents.map(_.status) shouldBe Seq("queued", "succeeded")
    }

    // HEL-1168 task 1.2: a subscriber whose stream has terminated (client disconnect --
    // simulated here via `take(1)`'s well-established cancel-after-first-element semantics,
    // already relied on elsewhere in this file) must be removed from the pipeline's subscriber
    // set, and its removal must not affect delivery to a still-live subscriber of the same
    // pipeline.
    "remove a disconnected subscriber from the set, without affecting a still-connected one" in {
      val registry = new PipelineRunRegistry()
      val pid      = "pipe-registry-disconnect-cleanup"

      // `take(1)` completes (and so cancels) the "disconnecting" subscriber's stream right after
      // its first element -- this test's simulated client disconnect. `take(2)` keeps the
      // "still-connected" subscriber alive across BOTH publishes below, so it is genuinely still
      // live (not itself completed) at the point the second publish happens.
      val disconnectingFuture  = registry.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))
      val stillConnectedFuture = registry.subscribe(pid).take(2).runWith(Sink.seq)(Materializer(system))

      // Both subscribers receive this one.
      registry.publish(pid, RunStatusEvent("queued"))
      Await.result(disconnectingFuture, 5.seconds).map(_.status) shouldBe Seq("queued")

      // Wait deterministically for watchTermination's async removal callback to have actually
      // run, rather than racing it with a fixed sleep -- otherwise this test could pass even
      // with a broken cleanup, purely by timing luck.
      eventually(timeout(2.seconds)) {
        registry.subscriberCountForTest(pid) shouldBe 1
      }

      registry.publish(pid, RunStatusEvent("running"))

      Await.result(stillConnectedFuture, 5.seconds).map(_.status) shouldBe Seq("queued", "running")
    }
  }
}
