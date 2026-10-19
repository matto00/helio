package com.helio.api.routes.pipelines

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.services.pipelines.draftpreview.DraftPreviewConfig
import com.helio.testsupport.{DraftPreviewBoundFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.StatusCodes

import java.util.concurrent.CountDownLatch
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** HEL-1630 skeptic-final-2: a cancelled request's walk only stops at the next node boundary, so the stream ending is not the
 *  evaluation ending. The running and per-principal slots used to come back at stream termination, which let a superseded request's
 *  still-running node overlap two more evaluations on an instance sized for two (the heap bound of C5/C6).
 *
 *  Request 1 is reset (TCP RST) while its second node is mid-evaluation (a delayed node). Until its walk has logged its outcome, a
 *  second request of the same user is admitted (it is the user's second slot) and a third gets `429 Draft preview busy`, as does any
 *  other user (both running slots are held). Production slot counts: 2 in flight, 2 per principal. */
class DraftPreviewWalkSlotSpec extends DraftPreviewBoundFixture {

  override protected def draftPreviewConfig: DraftPreviewConfig =
    DraftPreviewConfig(requestsPerWindow = 100000, maxInFlight = 2, maxInFlightPerPrincipal = 2)

  private val body = draftBody(Vector(rootOf("r", jobj("a" -> intCell(1)))), Vector(limitStep("a", 9), limitStep("b", 9, parent = Some("a"))))

  /** Sends a POST over a raw socket and reads until the first step line (the walk is evaluating) or a refusal. */
  private def openUntilFirstStep(seed: DraftSaveSeed, user: String): (java.net.Socket, String) = {
    val bytes = body.compactPrint.getBytes("UTF-8")
    val s     = new java.net.Socket("127.0.0.1", new java.net.URI(url(seed)).getPort)
    s.getOutputStream.write(
      (s"POST /api/pipelines/${seed.pipeline}/draft-preview HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\n" +
        s"Cookie: ${SessionCookies.Name}=${tokenOf(user)}\r\n${AuthDirectives.CsrfHeaderName}: ${AuthDirectives.CsrfHeaderValue}\r\nConnection: close\r\n\r\n").getBytes("UTF-8"))
    s.getOutputStream.write(bytes); s.getOutputStream.flush()
    s.setSoTimeout(8000)
    val in = s.getInputStream; val buf = new StringBuilder; val chunk = new Array[Byte](4096)
    while (!buf.toString.contains("\"type\":\"step\"") && !buf.toString.startsWith("HTTP/1.1 4")) {
      val n = in.read(chunk); if (n < 0) return (s, buf.toString); buf.append(new String(chunk, 0, n, "UTF-8"))
    }
    (s, buf.toString)
  }

  private def statusOf(seed: DraftSaveSeed, user: String): Int = {
    val r = Await.result(post(seed, user, body), 10.seconds)
    r.discardEntityBytes()
    r.status.intValue
  }

  "a request reset while its node is mid-evaluation" should {
    "keep its slots until its walk has ended, so a third concurrent evaluation is refused with 429" in {
      val seed = seedPipeline()
      nodeDelayMs = 3000 // the second node evaluated overall (request 1's node b) takes 3 s: mid-node when the client goes
      val (s1, t1) = openUntilFirstStep(seed, userA)
      t1 should include("\"type\":\"step\"")
      Thread.sleep(200)
      s1.setSoLinger(true, 0); s1.close()
      Thread.sleep(300) // the server has seen the reset; the walk is still inside node b
      val hold = new CountDownLatch(1)
      holdLatch = Some(hold)
      try {
        val (s2, t2) = openUntilFirstStep(seed, userA)
        t2 should include("\"type\":\"step\"")
        val sameUser  = statusOf(seed, userA)
        val otherUser = statusOf(seed, userB)
        val outcomesWhenRefused = outcomes().filter(_.contains("outcome="))
        outcomesWhenRefused shouldBe empty // request 1's walk has not ended yet: both refusals were observed during it
        sameUser shouldBe StatusCodes.TooManyRequests.intValue
        otherUser shouldBe StatusCodes.TooManyRequests.intValue
        hold.countDown(); s2.close()
        awaitOutcome(seed.pipeline) should include("outcome=")
        Thread.sleep(3500) // request 1's node b has ended and logged; request 2 has been cancelled and has ended too
        statusOf(seed, userA) shouldBe StatusCodes.OK.intValue
      } finally { holdLatch = None; hold.countDown() }
    }
  }
}
