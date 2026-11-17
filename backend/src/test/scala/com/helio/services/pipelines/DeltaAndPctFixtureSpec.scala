package com.helio.services.pipelines

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.{Files, Paths}

/** HEL-1705 D4: `shared-test-fixtures/delta-and-pct.json` is asserted here on `OutputHistoryService.deltaAndPct` and in
 *  `deltaAndPct.test.ts` on its client port, so the draft metric comparison cannot drift from the server's arithmetic. */
class DeltaAndPctFixtureSpec extends AnyWordSpec with Matchers {

  private val cases = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/delta-and-pct.json"))).asJsObject.fields("cases").asInstanceOf[JsArray].elements

  private def opt(v: JsValue): Option[Double] = v match {
    case JsNull      => None
    case JsNumber(n) => Some(n.toDouble)
    case other       => fail(s"unexpected fixture value $other")
  }

  "OutputHistoryService.deltaAndPct" should {
    "agree with every case of the shared fixture" in {
      cases should not be empty
      cases.foreach { c =>
        val o = c.asJsObject.fields
        withClue(o("name").convertTo[String]) {
          val (delta, pct) = OutputHistoryService.deltaAndPct(opt(o("current")), opt(o("baseline")))
          delta shouldBe opt(o("delta"))
          pct shouldBe opt(o("pct"))
        }
      }
    }
  }
}
