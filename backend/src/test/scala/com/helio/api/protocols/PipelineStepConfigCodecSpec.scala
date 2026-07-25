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

    "preserve datebucket config with outputColumn" in {
      val raw = """{"field":"ts","granularity":"month","outputColumn":"ts_month"}"""
      PipelineStepConfigCodec.decode("datebucket", raw).get shouldBe
        DateBucketConfig("ts", "month", Some("ts_month"))
    }

    "preserve datebucket config without outputColumn" in {
      val raw = """{"field":"ts","granularity":"day"}"""
      PipelineStepConfigCodec.decode("datebucket", raw).get shouldBe
        DateBucketConfig("ts", "day", None)
    }

    "preserve pivot config" in {
      val raw = """{"index":["region"],"column":"product","values":"revenue","agg":"sum"}"""
      PipelineStepConfigCodec.decode("pivot", raw).get shouldBe
        PivotConfig(Vector("region"), "product", "revenue", "sum")
    }

    "preserve window config" in {
      val raw = """{"partitionBy":["category"],"orderBy":[{"field":"amount","direction":"desc"}],"function":"rank","field":null,"outputColumn":"rnk","offset":null}"""
      PipelineStepConfigCodec.decode("window", raw).get shouldBe
        WindowConfig(Vector("category"), Vector(SortKey("amount", "desc")), "rank", None, "rnk", None)
    }

    "preserve window config with field and offset for lag" in {
      val raw = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"lag","field":"amount","outputColumn":"prev","offset":2}"""
      PipelineStepConfigCodec.decode("window", raw).get shouldBe
        WindowConfig(Vector("category"), Vector(SortKey("day", "asc")), "lag", Some("amount"), "prev", Some(2))
    }

    "preserve unpivot config" in {
      val raw = """{"idVars":["region"],"valueVars":["jan","feb"],"varName":"month","valueName":"amount"}"""
      PipelineStepConfigCodec.decode("unpivot", raw).get shouldBe
        UnpivotConfig(Vector("region"), Vector("jan", "feb"), "month", "amount")
    }

    "preserve dedupe config" in {
      val raw = """{"keys":["id","region"],"keep":"last"}"""
      PipelineStepConfigCodec.decode("dedupe", raw).get shouldBe
        DedupeConfig(Vector("id", "region"), "last")
    }

    "preserve fillnull config" in {
      val raw = """{"columns":["price"],"strategy":"mean","value":null}"""
      PipelineStepConfigCodec.decode("fillnull", raw).get shouldBe
        FillNullConfig(Vector("price"), "mean", None)
    }

    "preserve fillnull config with a constant value" in {
      val raw = """{"columns":["region"],"strategy":"constant","value":"unknown"}"""
      PipelineStepConfigCodec.decode("fillnull", raw).get shouldBe
        FillNullConfig(Vector("region"), "constant", Some("unknown"))
    }

    "preserve stringops config for split" in {
      val raw = """{"operation":"split","field":"path","outputColumn":"segment","pattern":null,"separator":"/","index":1,"fields":null}"""
      PipelineStepConfigCodec.decode("stringops", raw).get shouldBe
        StringOpsConfig("split", "path", "segment", None, Some("/"), Some(1), None)
    }

    "preserve stringops config for concat" in {
      val raw = """{"operation":"concat","field":"","outputColumn":"fullName","pattern":null,"separator":" ","index":null,"fields":["first","last"]}"""
      PipelineStepConfigCodec.decode("stringops", raw).get shouldBe
        StringOpsConfig("concat", "", "fullName", None, Some(" "), None, Some(Vector("first", "last")))
    }

    "preserve union config for byPosition" in {
      val raw = """{"otherDataSourceId":"ds-2","mode":"byPosition"}"""
      PipelineStepConfigCodec.decode("union", raw).get shouldBe
        UnionConfig("ds-2", "byPosition")
    }

    "preserve union config for byName" in {
      val raw = """{"otherDataSourceId":"ds-2","mode":"byName"}"""
      PipelineStepConfigCodec.decode("union", raw).get shouldBe
        UnionConfig("ds-2", "byName")
    }

    "preserve lookup config" in {
      val raw = """{"referenceDataSourceId":"ds-2","sourceKey":"code","lookupKey":"code","columns":["label","price"]}"""
      PipelineStepConfigCodec.decode("lookup", raw).get shouldBe
        LookupConfig("ds-2", "code", "code", Vector("label", "price"))
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

    "datebucket — decode({}) yields empty field/granularity and no outputColumn (tolerant decode; fails at execute time per the standard contract)" in {
      PipelineStepConfigCodec.decode("datebucket", "{}").get shouldBe DateBucketConfig("", "", None)
    }

    "pivot — decode({}) yields empty index/column/values/agg (tolerant decode; fails at execute time per the standard contract)" in {
      PipelineStepConfigCodec.decode("pivot", "{}").get shouldBe PivotConfig(Vector.empty, "", "", "")
    }

    "window — decode({}) yields empty partitionBy/orderBy/function/outputColumn and no field/offset (tolerant decode; fails at execute time per the standard contract)" in {
      PipelineStepConfigCodec.decode("window", "{}").get shouldBe
        WindowConfig(Vector.empty, Vector.empty, "", None, "", None)
    }

    "unpivot — decode({}) yields empty idVars/valueVars and default varName/valueName" in {
      PipelineStepConfigCodec.decode("unpivot", "{}").get shouldBe
        UnpivotConfig(Vector.empty, Vector.empty, "variable", "value")
    }

    "dedupe — decode({}) yields empty keys and keep=first default" in {
      PipelineStepConfigCodec.decode("dedupe", "{}").get shouldBe
        DedupeConfig(Vector.empty, "first")
    }

    "dedupe — malformed keep value falls back to first (only the literal 'last' selects last-occurrence)" in {
      PipelineStepConfigCodec.decode("dedupe", """{"keys":["id"],"keep":"bogus"}""").get shouldBe
        DedupeConfig(Vector("id"), "first")
    }

    "fillnull — decode({}) yields empty columns, empty strategy, and no value default" in {
      PipelineStepConfigCodec.decode("fillnull", "{}").get shouldBe
        FillNullConfig(Vector.empty, "", None)
    }

    "stringops — decode({}) yields empty operation/field/outputColumn and no optional params (tolerant decode; fails at execute time per the standard contract)" in {
      PipelineStepConfigCodec.decode("stringops", "{}").get shouldBe
        StringOpsConfig("", "", "", None, None, None, None)
    }

    "union — decode({}) yields empty otherDataSourceId and byPosition default" in {
      PipelineStepConfigCodec.decode("union", "{}").get shouldBe
        UnionConfig("", "byPosition")
    }

    "lookup — decode({}) yields empty ids/keys and an empty columns vector" in {
      PipelineStepConfigCodec.decode("lookup", "{}").get shouldBe
        LookupConfig("", "", "", Vector.empty)
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
        "chunkbytokencount" -> ChunkByTokenCountConfig("content", 500, "o200k_base", "chunkIndex", "tokenCount"),
        "datebucket" -> DateBucketConfig("ts", "month", Some("ts_month")),
        "pivot"      -> PivotConfig(Vector("region"), "product", "revenue", "sum"),
        "window"     -> WindowConfig(Vector("category"), Vector(SortKey("amount", "desc")), "rank", None, "rnk", None),
        "unpivot"    -> UnpivotConfig(Vector("region"), Vector("jan", "feb"), "month", "amount"),
        "dedupe"     -> DedupeConfig(Vector("id"), "last"),
        "fillnull"   -> FillNullConfig(Vector("price"), "mean", None),
        "stringops"  -> StringOpsConfig("extractRegex", "email", "localPart", Some("^([^@]+)@"), None, None, None),
        "union"      -> UnionConfig("ds-2", "byName"),
        "lookup"     -> LookupConfig("ds-2", "code", "code", Vector("label"))
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
