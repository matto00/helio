package com.helio.api.routes.pipelines

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.services.pipelines.draftpreview.DraftPreviewConfig
import com.helio.testsupport.DraftPreviewBoundFixture
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.settings.ConnectionPoolSettings
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest, StatusCodes}
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.Await

/** HEL-1630: the reading pool's own bound. With `maxInFlight = 1` the pool is 4 bodies; once four are mid-read, a fifth request is
 *  refused at once with the same 429 `Draft preview busy`, before its body is read, so bodies in flight never exceed
 *  4 x maxInFlight x 4 MiB. */
class DraftPreviewReadingPoolSpec extends DraftPreviewBoundFixture {

  override protected def draftPreviewConfig: DraftPreviewConfig = DraftPreviewConfig(requestsPerWindow = 120, maxInFlight = 1, maxInFlightPerPrincipal = 2)

  private val draft = draftBody(Vector(rootOf("r", jobj("a" -> intCell(1)))), Vector(limitStep("a", 9)))

  "the reading pool" should {
    "refuse a request beyond 4 x maxInFlight bodies mid-read with 429 Draft preview busy" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor")); exec(seed.grant(userC, "editor"))
      holdLatch = None; holdUntilCancelled = false
      val slowOnes = Vector(new SlowPost(seed, userA, draft), new SlowPost(seed, userA, draft), new SlowPost(seed, userB, draft), new SlowPost(seed, userB, draft))
      Thread.sleep(1000) // all four bodies are mid-read before anything else asks
      // Its own connection pool: the default one (4 connections) is full of the slow bodies above. Poll until the four bodies are
      // all mid-read (a request that gets in earlier simply completes), then the next one must be refused.
      def probe() = {
        val r = Await.result(
          Http().singleRequest(
            HttpRequest(HttpMethods.POST, url(seed), entity = HttpEntity(ContentTypes.`application/json`, draft.compactPrint))
              .addHeader(Cookie(SessionCookies.Name -> tokenOf(userC))).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)),
            settings = ConnectionPoolSettings(system).withMaxConnections(8)
          ),
          10.seconds
        )
        r
      }
      var refused = probe()
      var tries   = 0
      while (refused.status != StatusCodes.TooManyRequests && tries < 60) {
        Await.result(refused.entity.toStrict(5.seconds), 5.seconds)
        Thread.sleep(250); tries += 1
        refused = probe()
      }
      refused.status shouldBe StatusCodes.TooManyRequests
      refused.headers.exists(h => h.is("retry-after") && h.value == "1") shouldBe true
      Await.result(refused.entity.toStrict(5.seconds), 5.seconds).data.utf8String.parseJson shouldBe JsObject("message" -> JsString("Draft preview busy"))
      // They finish together; one running slot serves one, the rest are refused at startRunning. None hangs.
      val results = slowOnes.map(_.finish())
      results.count(_.startsWith("HTTP/1.1 200")) should be >= 1
      results.forall(r => r.startsWith("HTTP/1.1 200") || r.startsWith("HTTP/1.1 429")) shouldBe true
    }
  }
}
