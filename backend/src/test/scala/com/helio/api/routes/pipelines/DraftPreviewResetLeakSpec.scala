package com.helio.api.routes.pipelines

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.services.pipelines.draftpreview.DraftPreviewConfig
import com.helio.testsupport.{DraftPreviewBoundFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.util.concurrent.CountDownLatch
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** HEL-1630 skeptic-final-1: a client that resets its connection (TCP RST) after sending a complete request, while `service.start`
 *  is still working, used to leak its in-flight permit for the life of the process: pekko-http dropped the response without ever
 *  materializing its entity, so the only release (the stream's `watchTermination`) never ran, and three such requests put the whole
 *  instance on 429.
 *
 *  The window is deterministic: the access check is held on a latch, so the reset is delivered while the route is certainly still
 *  waiting for `service.start`, and released only after the server has seen the reset. Runs against a bound server with the
 *  production slot counts (2 in flight, 2 per principal); a short materialize grace keeps the spec fast. */
class DraftPreviewResetLeakSpec extends DraftPreviewBoundFixture {

  override protected def draftPreviewConfig: DraftPreviewConfig =
    DraftPreviewConfig(requestsPerWindow = 100000, maxInFlight = 2, maxInFlightPerPrincipal = 2, materializeGraceMillis = 300)

  private val body = draftBody(Vector(rootOf("r", jobj("a" -> intCell(1)))), Vector(limitStep("a", 9)))

  private def resetAfterSending(seed: DraftSaveSeed, user: String): Unit = {
    val bytes = body.compactPrint.getBytes("UTF-8")
    val s     = new java.net.Socket("127.0.0.1", new java.net.URI(url(seed)).getPort)
    s.getOutputStream.write(
      (s"POST /api/pipelines/${seed.pipeline}/draft-preview HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\n" +
        s"Cookie: ${SessionCookies.Name}=${tokenOf(user)}\r\n${AuthDirectives.CsrfHeaderName}: ${AuthDirectives.CsrfHeaderValue}\r\n\r\n").getBytes("UTF-8"))
    s.getOutputStream.write(bytes)
    s.getOutputStream.flush()
    s.setSoLinger(true, 0)
    s.close()
  }

  private def statusOf(seed: DraftSaveSeed, user: String): Int = {
    val r = Await.result(post(seed, user, body), 10.seconds)
    r.discardEntityBytes()
    r.status.intValue
  }

  "requests reset before their response is produced" should {
    "give every slot back: the same principal gets 200 and another principal is admitted (not 429) afterwards" in {
      val seed  = seedPipeline()
      val latch = new CountDownLatch(1)
      accessCheckHold = Some(latch)
      try {
        (1 to 3).foreach { _ => resetAfterSending(seed, userA); Thread.sleep(100) }
        Thread.sleep(300) // the server has read the resets; each request is still parked on the held access check
      } finally { accessCheckHold = None; latch.countDown() }
      Thread.sleep(1500) // past the materialize grace: the dropped responses' permits must be back
      statusOf(seed, userA) shouldBe StatusCodes.OK.intValue
      // userB has no access to the pipeline, so the route answers 404 once it is ADMITTED; a leaked slot answers 429 before that.
      statusOf(seed, userB) shouldBe StatusCodes.NotFound.intValue
    }
  }
}
