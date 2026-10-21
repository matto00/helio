package com.helio.api.routes.pipelines

import com.helio.services.pipelines.draftpreview.DraftPreviewConfig
import com.helio.testsupport.DraftPreviewBoundFixture
import org.apache.pekko.http.scaladsl.model.{HttpResponse, StatusCodes}
import org.apache.pekko.stream.scaladsl.Sink
import spray.json._

import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** HEL-1676: a catastrophic user regex in a draft no longer holds the instance's two draft-preview slots. Two such requests are in
 *  flight together (both slots); each ends with an `error` line naming the step, and afterwards two concurrent requests are both admitted. */
class DraftPreviewRegexTimeBoxSpec extends DraftPreviewBoundFixture {

  override protected def draftPreviewConfig: DraftPreviewConfig =
    DraftPreviewConfig(requestsPerWindow = 100000, maxInFlight = 2, maxInFlightPerPrincipal = 2)

  private val doomedRoot = rootOf("r", jobj("body" -> jstr("a" * 40 + "b")))
  private val doomed = draftBody(
    Vector(doomedRoot),
    Vector(stepJson("rx", "stringops", jobj("operation" -> jstr("extractRegex"), "field" -> jstr("body"), "outputColumn" -> jstr("out"), "pattern" -> jstr("^(.*a){12}$"))))
  )
  private val fine = draftBody(Vector(doomedRoot), Vector(limitStep("a", 9)))

  private def bodyText(r: HttpResponse): String =
    Await.result(r.entity.dataBytes.runWith(Sink.fold("")(_ + _.utf8String)), 30.seconds)

  "two catastrophic-regex draft previews" should {
    "each end with an error line naming the step, then leave both slots free" in {
      val seed    = seedPipeline()
      val started = System.nanoTime()
      val both    = Vector(post(seed, userA, doomed), post(seed, userA, doomed))
      val texts   = both.map(f => bodyText(Await.result(f, 30.seconds)))
      val elapsed = (System.nanoTime() - started) / 1000000L
      texts.foreach { t =>
        val err = t.linesIterator.filter(_.nonEmpty).map(_.parseJson.asJsObject).find(_.fields("type") == JsString("error"))
        withClue(t) { err.map(_.fields("step")) shouldBe Some(JsString("rx")) }
        err.get.fields("message").convertTo[String] should include("regex time budget")
      }
      elapsed should be < 15000L
      awaitOutcome(seed.pipeline)
      Thread.sleep(500)
      val next = Vector(post(seed, userA, fine), post(seed, userA, fine)).map(f => Await.result(f, 30.seconds))
      next.foreach(r => { r.status shouldBe StatusCodes.OK; r.discardEntityBytes() })
    }
  }
}
