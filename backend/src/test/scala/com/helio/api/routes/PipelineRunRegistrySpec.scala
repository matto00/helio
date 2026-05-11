package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer}
import org.apache.pekko.stream.scaladsl.Sink
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
    with ScalatestRouteTest {

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
  }
}
