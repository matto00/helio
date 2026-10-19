package com.helio.api.routes.pipelines

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.testsupport.DraftPreviewApiFixture
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import org.slf4j.{LoggerFactory, Logger => Slf4jLogger}
import spray.json._

import com.helio.api.http.{AuthDirectives, SessionCookies}
import scala.jdk.CollectionConverters._

/** HEL-1630 task 5.8: the request caps (a JSON 413, never a 500), the per-node row ceiling with each kind's own guard message,
 *  and request cells never reaching a log. */
class DraftPreviewCapsSpec extends DraftPreviewApiFixture {

  private val ceilingMessage = (kind: String) => s"$kind would produce more than 20,000 rows (draft preview limit)"

  private def oneRoot = rootOf("r", jobj("a" -> intCell(1)))
  private def errorsOf(res: Preview) = res.ofType("error").map(l => l.fields("step").convertTo[String] -> l.fields("message").convertTo[String]).toMap

  "an oversize or over-cap request" should {
    "be refused 413 with a JSON message when the body is 5 MiB, whether or not its length is announced" in {
      val seed = seedPipeline()
      val huge = JsObject("roots" -> JsArray(rootOf("r", jobj("pad" -> jstr("x" * (5 * 1024 * 1024))))), "steps" -> JsArray.empty).compactPrint
      huge.length should be > 4 * 1024 * 1024
      val strict = previewRaw(seed, userA, huge)
      strict.status shouldBe StatusCodes.RequestEntityTooLarge
      strict.contentType should startWith("application/json")
      strict.body.parseJson shouldBe JsObject("message" -> JsString("Draft preview body exceeds 4194304 bytes"))

      val chunks  = huge.getBytes("UTF-8").grouped(1024 * 1024).map(ByteString(_)).toList
      val chunked = HttpEntity.Chunked.fromData(ContentTypes.`application/json`, Source(chunks))
      HttpRequest(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview", entity = chunked)
        .addHeader(Cookie(SessionCookies.Name -> tokenOf(userA))).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)) ~> routes ~> check {
        response.status shouldBe StatusCodes.RequestEntityTooLarge
        responseAs[String].parseJson shouldBe JsObject("message" -> JsString("Draft preview body exceeds 4194304 bytes"))
      }
    }

    "be refused 413 naming the cap: 10,001 rows, 9 sources, 51 steps" in {
      val seed = seedPipeline()
      val frame = Vector.tabulate(10001)(i => jobj("i" -> intCell(i)))
      val rows = preview(seed, userA, draftBody(Vector(rootOf("r", frame: _*)), Vector.empty))
      rows.status shouldBe StatusCodes.RequestEntityTooLarge
      rows.body should include("10000 rows")
      val nine = JsObject((0 until 9).map(i => s"s$i" -> jobj("rows" -> jrows(), "complete" -> JsTrue)).toMap)
      val sources = preview(seed, userA, draftBody(Vector(oneRoot), Vector.empty, "sources" -> nine))
      sources.status shouldBe StatusCodes.RequestEntityTooLarge
      sources.body should include("8 entries in sources")
      val steps = preview(seed, userA, draftBody(Vector(oneRoot), Vector.tabulate(51)(i => limitStep(s"s$i", 1, position = i))))
      steps.status shouldBe StatusCodes.RequestEntityTooLarge
      steps.body should include("50 steps")
    }

    "be refused 400 for a body that is not JSON, without echoing it" in {
      val seed = seedPipeline()
      val res = previewRaw(seed, userA, "{\"roots\": SENTINEL-NOT-JSON")
      res.status shouldBe StatusCodes.BadRequest
      res.body should not include "SENTINEL"
    }
  }

  "the 20,000-row node ceiling" should {
    "refuse a 150 x 150 one-key join with the join pre-check message, promptly, and let the rest of the draft carry on" in {
      val seed  = seedPipeline()
      val left  = Vector.tabulate(150)(i => jobj("k" -> intCell(1), "l" -> intCell(i)))
      val right = Vector.tabulate(150)(i => jobj("k" -> intCell(1), "r" -> intCell(i)))
      val join = stepJson("j", "join", jobj("secondaryInput" -> jobj("kind" -> jstr("lane"), "stepId" -> jstr("rl")), "joinKey" -> jstr("k"), "joinType" -> jstr("inner")))
      val body = draftBody(Vector(rootOf("r", left: _*)), Vector(join, limitStep("after", 1, Some("j")), limitStep("side", 1, root = "r", position = 1)), "lanes" -> jobj("rl" -> jobj("rows" -> JsArray(right))))
      val t0   = System.nanoTime()
      val res  = preview(seed, userA, body)
      ((System.nanoTime() - t0) / 1e9) should be < 5.0
      errorsOf(res) shouldBe Map("j" -> ceilingMessage("join"))
      res.ofType("unavailable").map(_.fields("step").convertTo[String]) shouldBe Vector("after")
      res.ofType("step").map(_.fields("step").convertTo[String]) shouldBe Vector("side")
    }

    "refuse each other multiplying kind just over the ceiling with its own message" in {
      val seed = seedPipeline()
      def run(kind: String, config: JsObject, rows: Vector[JsObject]) =
        errorsOf(preview(seed, userA, draftBody(Vector(rootOf("r", rows: _*)), Vector(stepJson("m", kind, config)))))("m")
      val paras  = Vector.fill(60)("para").mkString("\n\n")
      val heads  = Vector.tabulate(60)(i => s"# h$i").mkString("\n")
      val words  = Vector.fill(60)("word").mkString(" ")
      def text(s: String) = Vector.fill(400)(jobj("body" -> jstr(s)))
      run("unpivot", jobj("idVars" -> JsArray(jstr("id")), "valueVars" -> JsArray(jstr("a"), jstr("b"), jstr("c")), "varName" -> jstr("v"), "valueName" -> jstr("x")),
        Vector.tabulate(7000)(i => jobj("id" -> intCell(i), "a" -> intCell(1), "b" -> intCell(2), "c" -> intCell(3)))) shouldBe ceilingMessage("unpivot")
      run("splittext", jobj("field" -> jstr("body"), "mode" -> jstr("paragraph")), text(paras)) shouldBe ceilingMessage("splittext")
      run("chunkbytokencount", jobj("field" -> jstr("body"), "targetTokenCount" -> JsNumber(1)), text(words)) shouldBe ceilingMessage("chunkbytokencount")
      run("extractheadings", jobj("field" -> jstr("body")), text(heads)) shouldBe ceilingMessage("extractheadings")
    }

    "refuse a node over the ceiling that no step guards with the distinct backstop message" in {
      val seed = seedPipeline()
      val ten  = Vector.tabulate(10000)(i => jobj("i" -> intCell(i)))
      def union(id: String, parent: Option[String], lane: String) =
        stepJson(id, "union", jobj("secondaryInput" -> jobj("kind" -> jstr("lane"), "stepId" -> jstr(lane)), "mode" -> jstr("byPosition")), parent)
      val lane = jobj("rows" -> JsArray(ten))
      val res  = preview(seed, userA, draftBody(Vector(rootOf("r", ten: _*)), Vector(union("u1", None, "l1"), union("u2", Some("u1"), "l2")), "lanes" -> jobj("l1" -> lane, "l2" -> lane)))
      errorsOf(res) shouldBe Map("u2" -> "node produced 30000 rows, over the draft preview limit of 20,000")
    }
  }

  "logging" should {
    "never carry a request cell, however the request ends" in {
      val seed   = seedPipeline()
      val root   = Slf4jLogger.ROOT_LOGGER_NAME
      val logger = LoggerFactory.getLogger(root).asInstanceOf[Logger]
      val log    = new ListAppender[ILoggingEvent]()
      log.start(); logger.addAppender(log)
      try {
        val sentinel = "SENTINEL-CELL-5f1c9a"
        val rows     = rootOf("r", jobj("secret" -> jstr(sentinel)), jobj("n" -> jstr(sentinel)))
        val bad      = jobj("field" -> jstr("secret"), "from" -> jstr("csv"), "to" -> jstr("json"), "outputField" -> jstr("o"))
        preview(seed, userA, draftBody(Vector(rows), Vector(limitStep("a", 1)))).status shouldBe StatusCodes.OK
        preview(seed, userA, draftBody(Vector(rows), Vector(stepJson("b", "convertformat", bad)))).ofType("error") should not be empty
        preview(seed, userA, draftBody(Vector(rows), Vector(stepJson("c", "teleport", JsObject.empty)))).status shouldBe StatusCodes.BadRequest
        val outcomes = log.list.asScala.map(_.getFormattedMessage).filter(_.startsWith("draft-preview"))
        outcomes.size should be >= 2
        log.list.asScala.map(_.getFormattedMessage).filter(_.contains(sentinel)) shouldBe empty
      } finally logger.detachAppender(log)
    }
  }
}
