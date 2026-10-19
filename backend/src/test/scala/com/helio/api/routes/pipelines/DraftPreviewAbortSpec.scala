package com.helio.api.routes.pipelines

import ch.qos.logback.classic.Level
import com.helio.services.pipelines.draftpreview.DraftPreviewConfig
import com.helio.testsupport.DraftPreviewBoundFixture
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.concurrent.{CountDownLatch, TimeUnit}
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

/** HEL-1630 task 5.9, and the in-flight gate of task 5.8: tests that need a REAL connection, so they run against a bound server
 *  rather than the route testkit (which cannot abort a response).
 *
 *  The evaluation count is read from a spy wrapped around every step the engine is given, so it is independent of anything the
 *  preview code reports about itself. The test-only `afterNode` hook holds the walk after the first node until the response
 *  stream has been cancelled, which makes "abort after the first line" deterministic instead of a race. */
class DraftPreviewAbortSpec extends DraftPreviewBoundFixture {

  override protected def draftPreviewConfig: DraftPreviewConfig = DraftPreviewConfig(requestsPerWindow = 120, maxInFlight = 2, maxInFlightPerPrincipal = 1)

  // Trunk a -> b -> c, plus an independent branch d at the root: four enabled steps, any of which could run second.
  private val draft = draftBody(
    Vector(rootOf("r", jobj("a" -> intCell(1)))),
    Vector(limitStep("a", 9), limitStep("b", 9, Some("a")), limitStep("c", 9, Some("b")), limitStep("d", 9, position = 1))
  )

  "a client that aborts the response" should {
    "stop the walk at the next node boundary: one node evaluated, outcome aborted" in {
      val seed = seedPipeline()
      evaluated.set(0); holdLatch = None; holdUntilCancelled = true; heldByCancel = false; holding.set(new CountDownLatch(1))
      val response = Await.result(post(seed, userA, draft), 10.seconds)
      response.status shouldBe StatusCodes.OK
      firstLine(response).fields("type") shouldBe jstr("step")
      response.discardEntityBytes() // the stream is already cancelled by take(1); this just releases the connection
      awaitOutcome(seed.pipeline) should include("outcome=aborted-after-1-of-4")
      heldByCancel shouldBe true
      evaluated.get shouldBe 1
      holdUntilCancelled = false
    }
  }

  "a client that aborts while a node is still running" should {
    "end the walk as aborted at INFO, with no WARN and no failed outcome (evaluation-1 CR2)" in {
      val seed = seedPipeline()
      evaluated.set(0); holdLatch = None; holdUntilCancelled = false; nodeDelayMs = 700
      val response = Await.result(post(seed, userA, draft), 10.seconds)
      firstLine(response).fields("type") shouldBe jstr("step")
      response.discardEntityBytes()
      val outcome = awaitOutcome(seed.pipeline)
      nodeDelayMs = 0
      outcome should include regex "outcome=aborted-after-\\d+-of-4"
      Thread.sleep(300)
      captured.list.asScala.filter(e => e.getFormattedMessage.contains(seed.pipeline) && e.getLevel.isGreaterOrEqual(Level.WARN)) shouldBe empty
    }
  }

  "the in-flight gate" should {
    "answer 429 Draft preview busy with Retry-After while the principal's slot is held, and free the slot when the first request ends" in {
      val seed = seedPipeline()
      evaluated.set(0); holdUntilCancelled = false
      val latch = new CountDownLatch(1)
      holdLatch = Some(latch); holding.set(new CountDownLatch(1))
      val first = post(seed, userA, draft)
      holding.get.await(10, TimeUnit.SECONDS) shouldBe true
      val second = Await.result(post(seed, userA, draft), 10.seconds)
      second.status shouldBe StatusCodes.TooManyRequests
      second.headers.exists(_.is("retry-after")) shouldBe true
      Await.result(second.entity.toStrict(5.seconds), 5.seconds).data.utf8String.parseJson shouldBe JsObject("message" -> JsString("Draft preview busy"))
      second.discardEntityBytes()
      latch.countDown(); holdLatch = None
      val done = Await.result(first, 10.seconds)
      Await.result(done.entity.toStrict(10.seconds), 10.seconds).data.utf8String should include("\"type\":\"rows\"")
      Thread.sleep(200)
      val third = Await.result(post(seed, userA, draft), 10.seconds)
      third.status shouldBe StatusCodes.OK
      Await.result(third.entity.toStrict(10.seconds), 10.seconds)
    }
  }
}
