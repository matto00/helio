package com.helio.api.routes.pipelines

import com.helio.services.pipelines.draftpreview.DraftPreviewConfig
import com.helio.testsupport.DraftPreviewBoundFixture
import org.apache.pekko.http.scaladsl.model.{HttpResponse, StatusCodes}
import spray.json._

import java.util.concurrent.{CountDownLatch, TimeUnit}
import scala.concurrent.duration.DurationInt
import scala.concurrent.Await

/** HEL-1630 evaluation-1 CR1: admission under the PRODUCTION default config (`DraftPreviewConfig.fromLookup(_ => None)`), on a bound
 *  server. A single drag must not lock out other users, and must not lock out itself. */
class DraftPreviewAdmissionSpec extends DraftPreviewBoundFixture {

  override protected def draftPreviewConfig: DraftPreviewConfig = DraftPreviewConfig.fromLookup(_ => None)

  private val draft = draftBody(Vector(rootOf("r", jobj("a" -> intCell(1)))), Vector(limitStep("a", 9), limitStep("b", 9, Some("a"))))

  private def finish(r: HttpResponse): String =
    Await.result(r.entity.toStrict(10.seconds), 10.seconds).data.utf8String

  "the default admission" should {
    "admit a second principal while the first holds a running slot" in {
      val seed  = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val latch = new CountDownLatch(1)
      holdLatch = Some(latch); holding.set(new CountDownLatch(1)); holdUntilCancelled = false
      val first = post(seed, userA, draft)
      holding.get.await(10, TimeUnit.SECONDS) shouldBe true
      holdLatch = None // later requests do not hold
      val second = Await.result(post(seed, userB, draft), 10.seconds)
      second.status shouldBe StatusCodes.OK
      finish(second) should include("\"type\":\"rows\"")
      latch.countDown()
      finish(Await.result(first, 10.seconds)) should include("\"type\":\"rows\"")
    }

    "admit one user's superseded request together with their next request" in {
      val seed  = seedPipeline()
      val latch = new CountDownLatch(1)
      holdLatch = Some(latch); holding.set(new CountDownLatch(1)); holdUntilCancelled = false
      val superseded = post(seed, userA, draft) // still running: its abort has not been observed
      holding.get.await(10, TimeUnit.SECONDS) shouldBe true
      holdLatch = None
      val next = Await.result(post(seed, userA, draft), 10.seconds)
      next.status shouldBe StatusCodes.OK
      finish(next)
      latch.countDown()
      finish(Await.result(superseded, 10.seconds))
    }

    "answer a third concurrent evaluation at once with 429 Draft preview busy and Retry-After 1, never queueing it" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor")); exec(seed.grant(userC, "editor"))
      val latch = new CountDownLatch(1)
      holdLatch = Some(latch); holding.set(new CountDownLatch(2)); holdUntilCancelled = false
      val a = post(seed, userA, draft)
      val b = post(seed, userB, draft)
      holding.get.await(10, TimeUnit.SECONDS) shouldBe true // both running slots are held, bodies long since read
      val t0    = System.nanoTime()
      val third = Await.result(post(seed, userC, draft), 10.seconds)
      ((System.nanoTime() - t0) / 1e9) should be < 2.0
      third.status shouldBe StatusCodes.TooManyRequests
      third.headers.exists(h => h.is("retry-after") && h.value == "1") shouldBe true
      finish(third).parseJson shouldBe JsObject("message" -> JsString("Draft preview busy"))
      holdLatch = None
      latch.countDown()
      finish(Await.result(a, 10.seconds)); finish(Await.result(b, 10.seconds))
      finish(Await.result(post(seed, userC, draft), 10.seconds)) should include("\"type\":\"rows\"")
    }

    "not let clients trickling their bodies starve another principal, even when they outnumber the running slots" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor")); exec(seed.grant(userC, "editor"))
      holdLatch = None; holdUntilCancelled = false
      // Two slow readers (A's per-principal bound) are as many as there are running slots.
      val slowOnes = Vector(new SlowPost(seed, userA, draft), new SlowPost(seed, userA, draft))
      Thread.sleep(500) // both are mid-read
      (1 to 3).foreach { _ =>
        val r = Await.result(post(seed, userB, draft), 10.seconds)
        r.status shouldBe StatusCodes.OK
        finish(r)
      }
      slowOnes.foreach(_.finish() should include("\"type\":\"rows\""))
    }
  }
}
