package com.helio.api.protocols

import com.helio.domain._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.util.Failure

/** Round-trip + tolerance coverage for the codec that bridges the typed
 *  domain configs and the JSON text stored on `pipeline_steps.config`. */
class PipelineStepConfigCodecSpec extends AnyWordSpec with Matchers {

  "decode + encode round-trip" should {
    "preserve rename config" in {
      val raw = """{"renames":{"a":"b","c":"d"}}"""
      PipelineStepConfigCodec.decode("rename", raw).get shouldBe RenameConfig(Map("a" -> "b", "c" -> "d"))
    }

    "preserve filter config with multiple conditions" in {
      val raw = """{"combinator":"OR","conditions":[{"field":"x","operator":">","value":"5"}]}"""
      val decoded = PipelineStepConfigCodec.decode("filter", raw).get.asInstanceOf[FilterConfig]
      decoded.combinator shouldBe "OR"
      decoded.conditions should have size 1
      decoded.conditions.head shouldBe FilterCondition("x", ">", Some("5"))
    }

    "preserve join config" in {
      val raw = """{"rightDataSourceId":"ds-1","joinKey":"id","joinType":"inner"}"""
      PipelineStepConfigCodec.decode("join", raw).get shouldBe JoinConfig("ds-1", "id", "inner")
    }

    "preserve compute config with optional type" in {
      val raw = """{"column":"c","expression":"a+b","type":"number"}"""
      PipelineStepConfigCodec.decode("compute", raw).get shouldBe ComputeConfig("c", "a+b", Some("number"))
    }

    "preserve groupby config" in {
      val raw = """{"groupBy":["dept"],"aggColumn":"salary","aggFunction":"sum"}"""
      PipelineStepConfigCodec.decode("groupby", raw).get shouldBe
        GroupByConfig(Vector("dept"), "salary", "sum")
    }

    "preserve cast config" in {
      val raw = """{"casts":{"x":"integer"}}"""
      PipelineStepConfigCodec.decode("cast", raw).get shouldBe CastConfig(Map("x" -> "integer"))
    }

    "preserve select config" in {
      val raw = """{"fields":["a","b"]}"""
      PipelineStepConfigCodec.decode("select", raw).get shouldBe SelectConfig(Vector("a", "b"))
    }

    "preserve limit config" in {
      val raw = """{"count":42}"""
      PipelineStepConfigCodec.decode("limit", raw).get shouldBe LimitConfig(42)
    }

    "preserve sort config with multiple keys" in {
      val raw = """{"sortBy":[{"field":"a","direction":"asc"},{"field":"b","direction":"desc"}]}"""
      PipelineStepConfigCodec.decode("sort", raw).get shouldBe
        SortConfig(Vector(SortKey("a", "asc"), SortKey("b", "desc")))
    }

    "preserve aggregate config" in {
      val raw = """{"groupBy":[{"name":"dept","type":"string"}],"aggregations":[{"alias":"total","fn":"sum","field":"x"}]}"""
      PipelineStepConfigCodec.decode("aggregate", raw).get shouldBe
        AggregateConfig(Vector(AggregateField("dept", "string")), Vector(Aggregation("total", "sum", "x")))
    }

    "preserve splittext config" in {
      val raw = """{"field":"content","mode":"heading","headingLevel":2,"indexField":"idx"}"""
      PipelineStepConfigCodec.decode("splittext", raw).get shouldBe
        SplitTextConfig("content", "heading", 2, "idx")
    }

    "preserve extractheadings config" in {
      val raw = """{"field":"content","indexField":"idx","levelField":"lvl"}"""
      PipelineStepConfigCodec.decode("extractheadings", raw).get shouldBe
        ExtractHeadingsConfig("content", "idx", "lvl")
    }

    "preserve chunkbytokencount config" in {
      val raw = """{"field":"content","targetTokenCount":250,"encoding":"cl100k_base","indexField":"idx","tokenCountField":"cnt"}"""
      PipelineStepConfigCodec.decode("chunkbytokencount", raw).get shouldBe
        ChunkByTokenCountConfig("content", 250, "cl100k_base", "idx", "cnt")
    }
  }

  "tolerance" should {
    "filter — missing combinator defaults to AND" in {
      val raw = """{"conditions":[]}"""
      PipelineStepConfigCodec.decode("filter", raw).get.asInstanceOf[FilterConfig].combinator shouldBe "AND"
    }

    "filter — missing conditions defaults to empty" in {
      val raw = """{"combinator":"OR"}"""
      PipelineStepConfigCodec.decode("filter", raw).get.asInstanceOf[FilterConfig].conditions shouldBe empty
    }

    "compute — missing optional type field" in {
      val raw = """{"column":"c","expression":"a+b"}"""
      PipelineStepConfigCodec.decode("compute", raw).get.asInstanceOf[ComputeConfig].`type` shouldBe None
    }

    "aggregate — missing groupBy/aggregations defaults to empty (parity with pre-CS2c-3a engine)" in {
      PipelineStepConfigCodec.decode("aggregate", """{}""").get shouldBe
        AggregateConfig(Vector.empty, Vector.empty)
    }

    // ── Partial-config tolerance for the remaining 7 kinds ────────────────────
    //
    // Regression coverage for the CS2c-3a read-path regression: pre-fix any
    // persisted row with `config = '{}'` on rename/join/groupby/cast/select/
    // limit/sort hard-failed in `convertTo[*Config]` → 500 on the entire
    // listByPipeline result. Each kind now decodes into a default-valued
    // config; engine-time required-field failures match pre-CS2c-3a behaviour.

    "rename — decode({}) yields empty renames map" in {
      PipelineStepConfigCodec.decode("rename", "{}").get shouldBe RenameConfig(Map.empty)
    }

    "join — decode({}) yields empty ids and inner default" in {
      PipelineStepConfigCodec.decode("join", "{}").get shouldBe JoinConfig("", "", "inner")
    }

    "groupby — decode({}) yields empty groupBy / empty aggColumn / sum default" in {
      PipelineStepConfigCodec.decode("groupby", "{}").get shouldBe
        GroupByConfig(Vector.empty, "", "sum")
    }

    "cast — decode({}) yields empty casts map" in {
      PipelineStepConfigCodec.decode("cast", "{}").get shouldBe CastConfig(Map.empty)
    }

    "select — decode({}) yields empty fields vector" in {
      PipelineStepConfigCodec.decode("select", "{}").get shouldBe SelectConfig(Vector.empty)
    }

    "limit — decode({}) yields count=0 (engine treats as no-op)" in {
      PipelineStepConfigCodec.decode("limit", "{}").get shouldBe LimitConfig(0)
    }

    "sort — decode({}) yields empty sortBy" in {
      PipelineStepConfigCodec.decode("sort", "{}").get shouldBe SortConfig(Vector.empty)
    }

    "every kind tolerates decode({}) without throwing" in {
      PipelineStepKind.All.foreach { kind =>
        val result = PipelineStepConfigCodec.decode(kind, "{}")
        withClue(s"kind=$kind: ") {
          result.isSuccess shouldBe true
        }
      }
    }
  }

  "failure modes" should {
    "reject unknown step kind" in {
      val ex = PipelineStepConfigCodec.decode("bogus", "{}")
      ex shouldBe a [Failure[_]]
      ex.failed.get.getMessage should include ("Unknown step op")
    }

    "reject malformed JSON" in {
      val ex = PipelineStepConfigCodec.decode("rename", "not-json")
      ex shouldBe a [Failure[_]]
    }
  }

  "encode" should {
    "round-trip through encodeConfig for every typed config" in {
      val cases: Seq[(String, Any)] = Seq(
        "rename"    -> RenameConfig(Map("a" -> "b")),
        "filter"    -> FilterConfig("AND", Vector(FilterCondition("x", "=", Some("y")))),
        "join"      -> JoinConfig("ds-1", "k", "inner"),
        "compute"   -> ComputeConfig("c", "expr", Some("number")),
        "groupby"   -> GroupByConfig(Vector("g"), "c", "sum"),
        "cast"      -> CastConfig(Map("x" -> "integer")),
        "select"    -> SelectConfig(Vector("a")),
        "limit"     -> LimitConfig(5),
        "sort"      -> SortConfig(Vector(SortKey("a", "asc"))),
        "aggregate" -> AggregateConfig(Vector(AggregateField("g", "string")), Vector(Aggregation("a", "sum", "x"))),
        "splittext" -> SplitTextConfig("content", "paragraph", 1, "segmentIndex"),
        "extractheadings" -> ExtractHeadingsConfig("content", "headingIndex", "headingLevel"),
        "chunkbytokencount" -> ChunkByTokenCountConfig("content", 500, "o200k_base", "chunkIndex", "tokenCount")
      )
      cases.foreach { case (kind, cfg) =>
        val encoded = PipelineStepConfigCodec.encodeConfig(cfg)
        val decoded = PipelineStepConfigCodec.decode(kind, encoded).get
        decoded shouldBe cfg
      }
    }

    "encodeJsObject validates the inbound shape before storing" in {
      val ok = JsObject("renames" -> JsObject("a" -> JsString("b")))
      PipelineStepConfigCodec.encodeJsObject("rename", ok).get shouldBe ok.compactPrint
    }
  }
}
