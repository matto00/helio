package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1313 task 4.1: the pure per-kind key-set + aggregation/chartType rules. */
class OutputConfigValidationSpec extends AnyWordSpec with Matchers {

  private val E = JsObject.empty
  private def obj(fs: (String, JsValue)*): JsObject = JsObject(fs: _*)
  private def s(v: String): JsString = JsString(v)
  private def rejected(kind: OutputKind, written: JsObject, stored: JsObject = E): String =
    OutputConfigValidation.validate(kind, written, stored) match {
      case Left(msg) => msg
      case Right(_)  => fail(s"expected Left for ${written.compactPrint}")
    }
  private def ok(kind: OutputKind, written: JsObject, stored: JsObject = E): Unit =
    OutputConfigValidation.validate(kind, written, stored) shouldBe Right(())

  private val chartAgg  = obj("groupBy" -> s("region"), "agg" -> s("sum"), "yField" -> s("amount"))

  "known keys" should {
    "accept every kind's full known set (string-valued placeholders where no shape is checked)" in {
      OutputConfigValidation.KnownKeys.foreach { case (kind, keys) =>
        val written = JsObject(keys.filterNot(Set("aggregation", "chartType", "fieldMapping", "compare", "historyPayloads")).map(_ -> s("x")).toMap)
        withClue(kind.toString)(ok(kind, written))
      }
      ok(OutputKind.Chart, obj("chartType" -> s("bar"), "aggregation" -> chartAgg, "compare" -> s("7d"), "historyPayloads" -> JsTrue))
    }

    "reject a typo'd key per kind, naming it with a did-you-mean hint" in {
      Seq(
        (OutputKind.Chart, "chartTyp", "chartType"), (OutputKind.Metric, "lable", "label"), (OutputKind.Table, "columnOrdr", "columnOrder"),
        (OutputKind.Collection, "layot", "layout"), (OutputKind.Timeline, "sortt", "sort"), (OutputKind.Markdown, "contnet", "content")
      ).foreach { case (kind, typo, intended) =>
        val msg = rejected(kind, obj(typo -> s("x")))
        msg should include(s"`$typo`")
        msg should include(s"did you mean `$intended`?")
      }
    }

    "say a key valid for another kind is not a config key of this one" in {
      rejected(OutputKind.Table, obj("chartType" -> s("bar"))) should include("`chartType` (not a table config key)")
    }

    "suggest the rename for known legacy keys, and the panel appearance for dead styling keys" in {
      rejected(OutputKind.Metric, obj("metricLabel" -> s("x"))) should include("use `label`")
      rejected(OutputKind.Metric, obj("metricUnit" -> s("x"))) should include("use `unit`")
      rejected(OutputKind.Chart, obj("chartAnnotation" -> s("x"))) should include("use `annotation`")
      Seq("legend", "tooltip", "seriesColors", "axisLabels").foreach { k =>
        rejected(OutputKind.Chart, obj(k -> obj())) should include("appearance.chart")
      }
    }

    "list every offending key, sorted, and the valid keys" in {
      val msg = rejected(OutputKind.Markdown, obj("zzz" -> s("1"), "aaa" -> s("2")))
      msg.indexOf("`aaa`") should (be >= 0 and be < msg.indexOf("`zzz`"))
      msg should include("Valid keys: compare, content, fieldMapping, historyPayloads")
    }

    "accept an unknown key re-sent with its stored value, reject a changed or new one" in {
      val stored = obj("metricLabel" -> s("old"))
      ok(OutputKind.Metric, obj("metricLabel" -> s("old"), "compare" -> s("7d")), stored)
      rejected(OutputKind.Metric, obj("metricLabel" -> s("new")), stored) should include("`metricLabel`")
      rejected(OutputKind.Metric, obj("metricUnit" -> s("x")), stored) should include("`metricUnit`")
    }

    "accept null for a stored unknown key but reject it for one that is not stored" in {
      ok(OutputKind.Metric, obj("metricLabel" -> JsNull), obj("metricLabel" -> s("old")))
      rejected(OutputKind.Metric, obj("metricLabel" -> JsNull)) should include("`metricLabel`")
    }
  }

  "chartType" should {
    "accept bar/line/pie/scatter/null and reject anything else" in {
      Seq("bar", "line", "pie", "scatter").foreach(t => ok(OutputKind.Chart, obj("chartType" -> s(t))))
      ok(OutputKind.Chart, obj("chartType" -> JsNull))
      rejected(OutputKind.Chart, obj("chartType" -> s("area"))) should include("chartType")
      rejected(OutputKind.Chart, obj("chartType" -> JsNumber(1))) should include("chartType")
    }
  }

  "chart aggregation" should {
    "accept the well-formed shape and null" in {
      ok(OutputKind.Chart, obj("aggregation" -> chartAgg))
      ok(OutputKind.Chart, obj("aggregation" -> JsNull))
      Seq("count", "sum", "avg", "min", "max").foreach(a => ok(OutputKind.Chart, obj("aggregation" -> obj("groupBy" -> s("g"), "agg" -> s(a), "yField" -> s("y")))))
    }

    "reject malformed shapes naming aggregation" in {
      Seq[JsValue](
        obj("groupBy" -> s("g"), "agg" -> s("sum")),
        obj("groupBy" -> s(""), "agg" -> s("sum"), "yField" -> s("y")),
        obj("groupBy" -> s("g"), "agg" -> s("median"), "yField" -> s("y")),
        obj("value" -> s("amount"), "agg" -> s("sum")),
        obj("groupBy" -> s("g"), "agg" -> s("sum"), "yField" -> s("y"), "extra" -> s("1")),
        s("sum"), JsArray()
      ).foreach(a => withClue(a.compactPrint)(rejected(OutputKind.Chart, obj("aggregation" -> a)) should include("aggregation")))
    }

    "reject a non-null aggregation on a scatter chart (written either way)" in {
      rejected(OutputKind.Chart, obj("chartType" -> s("scatter"), "aggregation" -> chartAgg)) should include("scatter")
      rejected(OutputKind.Chart, obj("aggregation" -> chartAgg), obj("chartType" -> s("scatter"))) should include("scatter")
      rejected(OutputKind.Chart, obj("chartType" -> s("scatter")), obj("aggregation" -> chartAgg)) should include("scatter")
      ok(OutputKind.Chart, obj("chartType" -> s("scatter"), "aggregation" -> JsNull))
    }

    "not re-validate a stored malformed aggregation on an unrelated write" in {
      val stored = obj("aggregation" -> obj("groupBy" -> s("g")), "chartType" -> s("scatter"))
      ok(OutputKind.Chart, obj("compare" -> s("7d")), stored)
      ok(OutputKind.Chart, stored, stored)
    }
  }

  "metric aggregation" should {
    val fm = obj("value" -> s("amount"))

    "accept { agg } with fieldMapping.value, and { value, agg } without it" in {
      ok(OutputKind.Metric, obj("fieldMapping" -> fm, "aggregation" -> obj("agg" -> s("sum"))))
      ok(OutputKind.Metric, obj("aggregation" -> obj("value" -> s("amount"), "agg" -> s("sum"))))
      ok(OutputKind.Metric, obj("fieldMapping" -> fm, "aggregation" -> obj("value" -> s("amount"), "agg" -> s("sum"))))
    }

    "resolve the field against the merged stored config" in {
      ok(OutputKind.Metric, obj("aggregation" -> obj("agg" -> s("sum"))), obj("fieldMapping" -> fm))
    }

    "reject no field, a field conflict, a bad agg, an extra field, and a groupBy shape" in {
      rejected(OutputKind.Metric, obj("aggregation" -> obj("agg" -> s("sum")))) should include("aggregation")
      rejected(OutputKind.Metric, obj("fieldMapping" -> fm, "aggregation" -> obj("value" -> s("b"), "agg" -> s("sum")))) should include("conflicts")
      rejected(OutputKind.Metric, obj("fieldMapping" -> fm, "aggregation" -> obj("agg" -> s("median")))) should include("aggregation")
      rejected(OutputKind.Metric, obj("fieldMapping" -> fm, "aggregation" -> obj("agg" -> s("sum"), "x" -> s("1")))) should include("aggregation")
      rejected(OutputKind.Metric, obj("fieldMapping" -> fm, "aggregation" -> chartAgg)) should include("aggregation")
    }

    "accept a metric with no field and no aggregation" in {
      ok(OutputKind.Metric, obj("fieldMapping" -> obj(), "aggregation" -> JsNull))
      ok(OutputKind.Metric, obj("fieldMapping" -> obj("label" -> s("x"))))
    }
  }

  "aggregation on a kind that never reads it" should {
    "be rejected as an unknown key, even null" in {
      Seq(OutputKind.Table, OutputKind.Collection, OutputKind.Timeline, OutputKind.Markdown).foreach { kind =>
        rejected(kind, obj("aggregation" -> chartAgg)) should include("`aggregation`")
        rejected(kind, obj("aggregation" -> JsNull)) should include("`aggregation`")
      }
    }
  }

  "KeysDoc" should {
    "mention every kind's keys and both aggregation shapes" in {
      OutputConfigValidation.KnownKeys.values.flatten.foreach(k => OutputConfigValidation.KeysDoc should include(k))
      OutputConfigValidation.KeysDoc should include("{ groupBy, agg, yField }")
      OutputConfigValidation.KeysDoc should include("{ agg }")
      OutputConfigValidation.KeysDoc should include("{ value, agg }")
    }
  }
}
