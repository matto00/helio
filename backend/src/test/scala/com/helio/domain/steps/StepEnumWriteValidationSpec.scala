package com.helio.domain.steps

import com.helio.domain.engine.PipelineAnalyzeService._
import com.helio.domain.engine.SchemaField
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1416: write-time rejection of clearly invalid fillnull / window / pivot enum values
 *  (companion `validateRawConfig`), while incomplete drafts stay accepted (HEL-814 D2). */
class StepEnumWriteValidationSpec extends AnyWordSpec with Matchers {

  private def fillnull(strategy: String) = s"""{"columns":["a"],"strategy":"$strategy"}"""
  private def window(extra: String)      = s"""{"partitionBy":[],"orderBy":[],"outputColumn":"o",$extra}"""
  private def pivot(agg: String)         = s"""{"index":[],"column":"c","values":"v","agg":"$agg"}"""

  private val fillnullC = FillNullStep.companion
  private val windowC   = WindowStep.companion
  private val pivotC    = PivotStep.companion

  "FillNullStep.companion.validateRawConfig" should {
    "reject a non-empty unknown strategy with the run/analyze message" in {
      val msg = fillnullC.validateRawConfig(fillnull("average")).getOrElse(fail("expected rejection"))
      msg should include("Unsupported fillnull strategy: 'average'")
      msg should include("forwardFill")
    }
    "reject a case-near-miss strategy" in {
      fillnullC.validateRawConfig(fillnull("forwardfill")) should not be empty
    }
    "accept every supported strategy" in {
      FillNullStep.SupportedStrategies.foreach(s => fillnullC.validateRawConfig(fillnull(s)) shouldBe None)
    }
    "accept drafts: constant with no value, empty strategy, absent strategy" in {
      fillnullC.validateRawConfig(fillnull("constant")) shouldBe None
      fillnullC.validateRawConfig(fillnull("")) shouldBe None
      fillnullC.validateRawConfig("""{"columns":[]}""") shouldBe None
    }
  }

  "WindowStep.companion.validateRawConfig" should {
    "reject a non-empty unknown function" in {
      val msg = windowC.validateRawConfig(window(""""function":"ntile"""")).getOrElse(fail("expected rejection"))
      msg should include("Unsupported window function: 'ntile'")
    }
    "reject lag/lead with an offset <= 0" in {
      for (fn <- Seq("lag", "lead"); off <- Seq(0, -3)) {
        val msg = windowC.validateRawConfig(window(s""""function":"$fn","field":"f","offset":$off""")).getOrElse(fail(s"$fn $off"))
        msg should include(s"window function '$fn' requires a positive 'offset', got $off")
      }
    }
    "accept every supported function and a positive offset" in {
      WindowStep.SupportedFunctions.foreach(f => windowC.validateRawConfig(window(s""""function":"$f"""")) shouldBe None)
      windowC.validateRawConfig(window(""""function":"lag","field":"f","offset":2""")) shouldBe None
    }
    "accept drafts: lag with no field, lag with no offset, empty/absent function" in {
      windowC.validateRawConfig(window(""""function":"lag"""")) shouldBe None
      windowC.validateRawConfig(window(""""function":"running_sum"""")) shouldBe None
      windowC.validateRawConfig(window(""""function":""""")) shouldBe None
      windowC.validateRawConfig("""{"outputColumn":"o"}""") shouldBe None
    }
    "accept an offset <= 0 on a function that ignores it" in {
      windowC.validateRawConfig(window(""""function":"row_number","offset":0""")) shouldBe None
    }
  }

  "PivotStep.companion.validateRawConfig" should {
    "reject a non-empty unknown agg" in {
      val msg = pivotC.validateRawConfig(pivot("median")).getOrElse(fail("expected rejection"))
      msg should include("Unsupported pivot aggregation function: 'median'")
    }
    "accept every supported agg and drafts (empty / absent agg)" in {
      PivotStep.SupportedAggs.foreach(a => pivotC.validateRawConfig(pivot(a)) shouldBe None)
      pivotC.validateRawConfig(pivot("")) shouldBe None
      pivotC.validateRawConfig("""{"column":"c","values":"v"}""") shouldBe None
    }
  }

  "analyze" should {
    val schema = Vector(SchemaField("a", "string"), SchemaField("f", "string"), SchemaField("c", "string"), SchemaField("v", "float"))
    def run(op: String, cfg: String) =
      analyze(Vector(PipelineStepInput(id = "s1", position = 0, op = op, config = cfg)), schema)(0)

    "report each invalid value exactly once (no duplicated message)" in {
      val cases = Seq(
        ("fillnull", fillnull("average"), "Unsupported fillnull strategy: 'average'"),
        ("window", window(""""function":"ntile""""), "Unsupported window function: 'ntile'"),
        ("window", window(""""function":"lag","field":"f","offset":0"""), "requires a positive 'offset', got 0"),
        ("pivot", pivot("median"), "Unsupported pivot aggregation function: 'median'")
      )
      for ((op, cfg, frag) <- cases) {
        val err = run(op, cfg).validationError.getOrElse(fail(s"$op: no error"))
        err should include(frag)
        err.split(frag.take(20)).length shouldBe 2 // fragment appears exactly once
      }
    }
    "keep reporting drafts" in {
      run("fillnull", fillnull("constant")).validationError.getOrElse("") should include("requires 'value'")
      run("fillnull", fillnull("")).validationError.getOrElse("") should include("Unsupported fillnull strategy: ''")
      run("window", window(""""function":"lag"""")).validationError.getOrElse("") should include("requires 'field'")
      run("pivot", pivot("")).validationError.getOrElse("") should include("Unsupported pivot aggregation function: ''")
    }
  }

  "apply (run path, legacy stored configs)" should {
    "still refuse unknown values with the same message" in {
      val ex1 = intercept[StepConfigError](FillNullStep.apply(Seq.empty, FillNullConfig(Vector("a"), "average", None)))
      ex1.getMessage should include("Unsupported fillnull strategy: 'average'")
      val ex2 = intercept[StepConfigError](WindowStep.apply(Seq.empty, WindowConfig.decode(window(""""function":"lag","field":"f","offset":0"""))))
      ex2.getMessage should include("positive 'offset'")
      val ex3 = intercept[StepConfigError](PivotStep.apply(Seq.empty, PivotConfig(Vector.empty, "c", "v", "median")))
      ex3.getMessage should include("Unsupported pivot aggregation function: 'median'")
    }
  }

  "WindowStep.apply error order (HEL-1422)" should {
    def runErr(extra: String): String =
      intercept[StepConfigError](WindowStep.apply(Seq.empty, WindowConfig.decode(window(extra)))).getMessage

    "report a missing field before a non-positive offset for lag" in {
      val msg = runErr(""""function":"lag","offset":0""")
      msg should include("requires 'field'")
      msg should not include "positive 'offset'"
    }
    "report a missing field before a non-positive offset for lead" in {
      val msg = runErr(""""function":"lead","offset":-2""")
      msg should include("requires 'field'")
      msg should not include "positive 'offset'"
    }
    "report an unsupported function before a missing field" in {
      runErr(""""function":"median"""") should include("Unsupported window function: 'median'")
    }
    "still report a bad offset when the field is present" in {
      runErr(""""function":"lag","field":"f","offset":0""") should include("positive 'offset'")
    }
  }
}
