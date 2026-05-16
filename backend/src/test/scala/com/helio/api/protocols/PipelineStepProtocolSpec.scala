package com.helio.api.protocols

import com.helio.api.JsonProtocols
import com.helio.domain._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Discriminated-union round-trip coverage for the CS2c-3a PipelineStep wire
 *  shape — every subtype writes / reads with the `type` field, the per-subtype
 *  `config` payload is typed (not stringified), and unknown discriminators
 *  fail with `deserializationError`. */
class PipelineStepProtocolSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private val now = "2026-05-15T00:00:00Z"

  private val subtypes: Seq[PipelineStepResponse] = Seq(
    RenameStepResponse("s", "p", 0, now, now, RenameConfig(Map("a" -> "b"))),
    FilterStepResponse("s", "p", 0, now, now, FilterConfig("AND", Vector(FilterCondition("x", "=", Some("y"))))),
    JoinStepResponse("s", "p", 0, now, now, JoinConfig("ds", "k", "inner")),
    ComputeStepResponse("s", "p", 0, now, now, ComputeConfig("c", "e", None)),
    GroupByStepResponse("s", "p", 0, now, now, GroupByConfig(Vector("g"), "c", "sum")),
    CastStepResponse("s", "p", 0, now, now, CastConfig(Map("x" -> "integer"))),
    SelectStepResponse("s", "p", 0, now, now, SelectConfig(Vector("a"))),
    LimitStepResponse("s", "p", 0, now, now, LimitConfig(5)),
    SortStepResponse("s", "p", 0, now, now, SortConfig(Vector(SortKey("a", "asc")))),
    AggregateStepResponse("s", "p", 0, now, now, AggregateConfig(Vector.empty, Vector.empty))
  )

  "PipelineStepResponse discriminated-union format" should {
    "write emits a `type` discriminator at the top level" in {
      subtypes.foreach { s =>
        val written = s.toJson.asJsObject
        written.fields.get("type") shouldBe Some(JsString(s.`type`))
      }
    }

    "write emits a typed (not stringified) `config` object" in {
      val filter: PipelineStepResponse = subtypes.collectFirst { case f: FilterStepResponse => f }.get
      val written = filter.toJson.asJsObject
      written.fields("config") shouldBe a [JsObject]
    }

    "round-trip every subtype" in {
      subtypes.foreach { s =>
        val written = s.toJson
        val parsed  = written.convertTo[PipelineStepResponse]
        parsed shouldBe s
      }
    }

    "read rejects an unknown type discriminator" in {
      val bad = JsObject("type" -> JsString("bogus"), "id" -> JsString("s"))
      a [DeserializationException] should be thrownBy bad.convertTo[PipelineStepResponse]
    }

    "read rejects a missing type discriminator" in {
      val bad = JsObject("id" -> JsString("s"))
      a [DeserializationException] should be thrownBy bad.convertTo[PipelineStepResponse]
    }
  }

  "CreatePipelineStepRequest wire shape" should {
    "deserialize from `{type, config}` shape" in {
      val raw = """{"type":"select","config":{"fields":["a","b"]}}""".parseJson
      raw.convertTo[CreatePipelineStepRequest] shouldBe
        CreatePipelineStepRequest("select", JsObject("fields" -> JsArray(JsString("a"), JsString("b"))))
    }
  }

  "UpdatePipelineStepRequest wire shape" should {
    "deserialize partial PATCH bodies (config only)" in {
      val raw = """{"config":{"renames":{}}}""".parseJson
      val parsed = raw.convertTo[UpdatePipelineStepRequest]
      parsed.`type`   shouldBe None
      parsed.config   shouldBe Some(JsObject("renames" -> JsObject()))
      parsed.position shouldBe None
    }

    "deserialize position-only PATCH bodies" in {
      val raw = """{"position":3}""".parseJson
      val parsed = raw.convertTo[UpdatePipelineStepRequest]
      parsed.`type`   shouldBe None
      parsed.config   shouldBe None
      parsed.position shouldBe Some(3)
    }
  }
}
