package com.helio.services.pipelines.draftpreview

import com.helio.api.protocols.pipelines.DraftPreviewLine.DraftPreviewUnavailableLine
import com.helio.domain.model.PipelineId
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.services.ServiceError
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1630 task 3.1 (and the request-decoder 400/413 cases of D1/D7): the pure half of the draft preview. */
class DraftPreviewPlannerSpec extends AnyWordSpec with Matchers {

  private val stepRepo = new PipelineStepRepository(null)(ExecutionContext.global)

  private def obj(fields: (String, JsValue)*) = JsObject(fields.toMap)
  private def str(s: String): JsValue         = JsString(s)
  private val limitCfg                        = obj("count" -> JsNumber(5))
  private def joinCfg(secondary: JsValue)     = obj("secondaryInput" -> secondary, "joinKey" -> str("k"), "joinType" -> str("inner"))
  private def unionCfg(secondary: JsValue)    = obj("secondaryInput" -> secondary, "mode" -> str("byPosition"))
  private def source(id: String)              = obj("kind" -> str("source"), "dataSourceId" -> str(id))
  private def lane(id: String)                = obj("kind" -> str("lane"), "stepId" -> str(id))
  private val aiCfg                           = obj("inputField" -> str("a"), "instruction" -> str("do"), "outputField" -> str("b"))

  private def step(id: String, kind: String, config: JsObject = limitCfg, parent: Option[String] = None, enabled: Boolean = true, position: Int = 0, root: String = "r"): JsObject =
    obj(
      "id" -> str(id), "kind" -> str(kind), "enabled" -> JsBoolean(enabled), "position" -> JsNumber(position), "config" -> config
    ).copy() match {
      case o => JsObject(o.fields ++ parent.map(p => "parentStepId" -> str(p)).orElse(Some("rootId" -> str(root))))
    }

  private def request(steps: Vector[JsObject], extra: (String, JsValue)*): JsObject =
    obj(Seq("roots" -> JsArray(obj("id" -> str("r"), "rows" -> JsArray(obj("k" -> JsNumber(1))))), "steps" -> JsArray(steps)) ++ extra: _*)

  private def plan(body: JsObject): Either[ServiceError, DraftPreviewPlan] =
    for {
      req     <- DraftPreviewRequestDecoder.decode(body)
      decoded <- DraftPreviewStepDecoder.decode(stepRepo, PipelineId("p"), req)
      planned <- DraftPreviewPlanner.plan(req, decoded)
    } yield planned

  private def planned(body: JsObject): DraftPreviewPlan = plan(body).fold(e => fail(e.toString), identity)
  private def lines(p: DraftPreviewPlan): Vector[(String, String)] = p.unavailable.map { case DraftPreviewUnavailableLine(s, r) => s -> r }
  private def badRequest(body: JsObject): String = plan(body).left.map { case ServiceError.BadRequest(m) => m; case other => fail(s"not a 400: $other") }.swap.getOrElse(fail("expected a 400"))
  private def tooLarge(body: JsObject): String   = plan(body).left.map { case ServiceError.PayloadTooLarge(m) => m; case other => fail(s"not a 413: $other") }.swap.getOrElse(fail("expected a 413"))
  private val supplied = "sources" -> obj("ds" -> obj("rows" -> JsArray(), "complete" -> JsTrue))

  "the planner" should {
    "mark an AI step aiStep and everything below it downstreamOfAiStep, walking none of them" in {
      val p = planned(request(Vector(step("a", "limit"), step("ai", "generatetext", aiCfg, Some("a")), step("c", "limit", limitCfg, Some("ai")))))
      lines(p) shouldBe Vector("ai" -> "aiStep", "c" -> "downstreamOfAiStep")
      p.walkSteps.map(_.id.value) shouldBe Vector("a")
    }

    "mark a join whose source secondary is absent, or supplied complete:false, sourceNotSupplied, and its subtree downstreamOfUnavailable" in {
      val steps = Vector(step("j", "join", joinCfg(source("ds"))), step("below", "limit", limitCfg, Some("j")))
      lines(planned(request(steps))) shouldBe Vector("j" -> "sourceNotSupplied", "below" -> "downstreamOfUnavailable")
      lines(planned(request(steps, "sources" -> obj("ds" -> obj("rows" -> JsArray(), "complete" -> JsFalse))))) shouldBe
        Vector("j" -> "sourceNotSupplied", "below" -> "downstreamOfUnavailable")
      lines(planned(request(steps, supplied))) shouldBe empty
    }

    "treat a union and a lookup like a join for source secondaries" in {
      val lookup = obj("secondaryInput" -> source("ds"), "sourceKey" -> str("k"), "lookupKey" -> str("k"), "columns" -> JsArray(str("x")))
      val steps  = Vector(step("u", "union", unionCfg(source("ds"))), step("l", "lookup", lookup, root = "r", position = 1))
      lines(planned(request(steps))) shouldBe Vector("u" -> "sourceNotSupplied", "l" -> "sourceNotSupplied")
    }

    "mark a lane that is neither a step in the request nor in lanes laneNotSupplied, and accept it once supplied" in {
      val steps = Vector(step("u", "union", unionCfg(lane("ghost"))))
      lines(planned(request(steps))) shouldBe Vector("u" -> "laneNotSupplied")
      lines(planned(request(steps, "lanes" -> obj("ghost" -> obj("rows" -> JsArray()))))) shouldBe empty
    }

    "propagate over lane edges: a union whose lane is a join on an unsupplied source is downstreamOfUnavailable" in {
      val steps = Vector(step("j", "join", joinCfg(source("ds"))), step("t", "limit", limitCfg, root = "r", position = 1), step("u", "union", unionCfg(lane("j")), Some("t")))
      lines(planned(request(steps))) shouldBe Vector("j" -> "sourceNotSupplied", "u" -> "downstreamOfUnavailable")
    }

    "propagate an AI step's reach over a lane edge as downstreamOfAiStep" in {
      val steps = Vector(step("ai", "analyzewithai", obj("inputField" -> str("a"), "instruction" -> str("do"), "outputFields" -> JsArray()), None), step("t", "limit", limitCfg, root = "r", position = 1), step("u", "union", unionCfg(lane("ai")), Some("t")))
      lines(planned(request(steps))) should contain("u" -> "downstreamOfAiStep")
    }

    "rank aiStep and downstreamOfAiStep ahead of an own sourceNotSupplied" in {
      val steps = Vector(step("ai", "generatetext", aiCfg), step("j", "join", joinCfg(source("ds")), Some("ai")))
      lines(planned(request(steps))) shouldBe Vector("ai" -> "aiStep", "j" -> "downstreamOfAiStep")
    }

    "leave a disabled AI step transparent: no line, and the enabled step below it is walked" in {
      val p = planned(request(Vector(step("ai", "generatetext", aiCfg, enabled = false), step("f", "limit", limitCfg, Some("ai")))))
      lines(p) shouldBe empty
      p.walkSteps.map(s => s.id.value -> s.enabled) shouldBe Vector("ai" -> false, "f" -> true)
    }

    "mark the enabled step below AI -> disabled -> enabled as downstreamOfAiStep and name the disabled one nowhere" in {
      val p = planned(request(Vector(step("ai", "generatetext", aiCfg), step("off", "limit", limitCfg, Some("ai"), enabled = false), step("on", "limit", limitCfg, Some("off")))))
      lines(p) shouldBe Vector("ai" -> "aiStep", "on" -> "downstreamOfAiStep")
      p.excluded should contain("off")
      p.walkSteps shouldBe empty
    }

    "not fail, mark or lane-check a disabled join whose lane is not supplied, and walk its children" in {
      val p = planned(request(Vector(step("j", "join", joinCfg(lane("ghost")), enabled = false), step("c", "limit", limitCfg, Some("j")))))
      lines(p) shouldBe empty
      p.walkSteps.map(_.id.value) shouldBe Vector("j", "c")
    }

    "swap a disabled step for a disabled identity and an enabled upsertsource for an enabled one" in {
      val upsert = obj("target" -> obj("kind" -> str("newSource"), "name" -> str("out")), "mode" -> str("append"))
      val p      = planned(request(Vector(step("up", "upsertsource", upsert), step("d", "limit", limitCfg, Some("up"), enabled = false))))
      p.walkSteps.map(s => (s.id.value, s.kind, s.enabled)) shouldBe Vector(("up", "draftidentity", true), ("d", "draftidentity", false))
    }
  }

  "the default rows step" should {
    "be the trunk terminal of roots[0]: the lowest-position child at every level" in {
      val steps = Vector(
        step("a", "limit"), step("branch", "limit", limitCfg, Some("a"), position = 3), step("b", "limit", limitCfg, Some("a"), position = 1),
        step("c", "limit", limitCfg, Some("b")), step("other", "limit", limitCfg, root = "r", position = 2)
      )
      planned(request(steps)).rowsStepId shouldBe Some("c")
    }

    "be absent when roots[0] has no step, and explicit when given" in {
      planned(request(Vector.empty)).rowsStepId shouldBe None
      planned(request(Vector(step("a", "limit"), step("b", "limit", limitCfg, Some("a"))), "rowsStepId" -> str("a"))).rowsStepId shouldBe Some("a")
    }
  }

  "the request checks" should {
    "refuse with a 400 a parent cycle, a self lane, an ancestor lane, a duplicate id, a dangling parent or root" in {
      badRequest(request(Vector(step("a", "limit", limitCfg, Some("b")), step("b", "limit", limitCfg, Some("a"))))) should include("cycle")
      badRequest(request(Vector(step("a", "union", unionCfg(lane("a")))))) should include("lane")
      badRequest(request(Vector(step("a", "limit"), step("b", "union", unionCfg(lane("a")), Some("a"))))) should include("ancestor")
      badRequest(request(Vector(step("a", "limit"), step("a", "limit", limitCfg, root = "r", position = 1)))) should include("unique")
      badRequest(request(Vector(step("a", "limit", limitCfg, Some("zzz"))))) should include("parentStepId")
      badRequest(request(Vector(step("a", "limit", root = "nope")))) should include("rootId")
    }

    "refuse a parentless step with no rootId, a rootId on a parented step, a lane key equal to a step id, an unknown rowsStepId" in {
      val rootless = JsObject(step("a", "limit").fields - "rootId")
      badRequest(request(Vector(rootless))) should include("rootId")
      val both = JsObject(step("b", "limit", limitCfg, Some("a")).fields + ("rootId" -> str("r")))
      badRequest(request(Vector(step("a", "limit"), both))) should include("cannot also")
      badRequest(request(Vector(step("a", "limit")), "lanes" -> obj("a" -> obj("rows" -> JsArray())))) should include("lane")
      badRequest(request(Vector(step("a", "limit")), "rowsStepId" -> str("nope"))) should include("rowsStepId")
    }

    "name a step with an unknown kind or a config that does not decode, without echoing the config" in {
      badRequest(request(Vector(step("a", "teleport")))) should (include("'a'") and include("unknown kind"))
      val msg = badRequest(request(Vector(step("a", "limit", obj("count" -> str("SENTINEL-CONFIG-TEXT"))))))
      msg should include("'a'")
      msg should not include "SENTINEL"
    }

    "refuse a malformed cell by row index only, never echoing it" in {
      val body = obj("roots" -> JsArray(obj("id" -> str("r"), "rows" -> JsArray(obj("c" -> obj("nested" -> str("SENTINEL-CELL")))))), "steps" -> JsArray())
      val msg  = badRequest(body)
      msg should include("roots[0].rows[0]")
      msg should not include "SENTINEL"
    }

    "refuse with a 413 naming the cap: 51 steps, 9 roots, 9 sources, 9 lanes, a 65-character id, a 10,001-row frame" in {
      tooLarge(request(Vector.tabulate(51)(i => step(s"s$i", "limit", root = "r", position = i)))) should include("50 steps")
      tooLarge(obj("roots" -> JsArray(Vector.tabulate(9)(i => obj("id" -> str(s"r$i"), "rows" -> JsArray()))), "steps" -> JsArray())) should include("8 root")
      def many(key: String) = request(Vector.empty, key -> JsObject((0 until 9).map(i => s"k$i" -> obj("rows" -> JsArray(), "complete" -> JsTrue)).toMap))
      tooLarge(many("sources")) should include("8 entries in sources")
      tooLarge(many("lanes")) should include("8 entries in lanes")
      tooLarge(request(Vector(step("x" * 65, "limit")))) should include("64 characters")
      val frame = JsArray(Vector.fill(10001)(obj("a" -> JsNumber(1))))
      tooLarge(obj("roots" -> JsArray(obj("id" -> str("r"), "rows" -> frame)), "steps" -> JsArray())) should include("10000 rows")
      tooLarge(request(Vector.empty, "lanes" -> obj("l" -> obj("rows" -> frame)))) should include("10000 rows")
    }

    "refuse unknown top-level and step fields" in {
      badRequest(JsObject(request(Vector.empty).fields + ("extra" -> JsTrue))) should include("unsupported")
      badRequest(request(Vector(JsObject(step("a", "limit").fields + ("extra" -> JsTrue))))) should include("unsupported")
    }
  }
}
