package com.helio.domain.outputs

import com.helio.domain.insights.InsightPreset
import com.helio.domain.model.{OutputId, OutputKind}
import com.helio.domain.panels.OutputBindingSpec
import com.helio.services.panels.OutputPanelDefaultSize
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1740: the insight config contract (every key, range and default) and the reads scoping check. */
class InsightConfigSpec extends AnyWordSpec with Matchers {

  private def cfg(s: String): JsObject = s.parseJson.asJsObject
  private def err(s: String): String   = InsightConfig.parse(cfg(s)).left.getOrElse(fail(s"expected Left for $s"))

  "InsightConfig.parse" should {
    "apply every default to an empty config" in {
      val c = InsightConfig.parse(JsObject.empty).toOption.get
      c.preset shouldBe InsightPreset.Auto
      c.prompt shouldBe None
      c.reads shouldBe InsightReads(None, Vector.empty)
      c.refresh shouldBe InsightRefresh.OnRun
      c.maxSentences shouldBe 2
      c.maxChars shouldBe 400
    }

    "read every key" in {
      val c = InsightConfig.parse(cfg("""{"preset":"delta","prompt":"why","reads":{"outputs":["a","b"],"windows":["7d","custom:P2D"]},"refresh":"daily","maxSentences":6,"maxChars":1200}""")).toOption.get
      c.preset shouldBe InsightPreset.Delta
      c.prompt shouldBe Some("why")
      c.reads shouldBe InsightReads(Some(Vector(OutputId("a"), OutputId("b"))), Vector("7d", "custom:P2D"))
      c.refresh shouldBe InsightRefresh.Daily
      c.maxSentences shouldBe 6
      c.maxChars shouldBe 1200
    }

    "treat null as absent for every key" in {
      InsightConfig.parse(cfg("""{"preset":null,"prompt":null,"reads":null,"refresh":null,"maxSentences":null,"maxChars":null}""")) shouldBe
        InsightConfig.parse(JsObject.empty)
    }

    "distinguish an empty reads.outputs from an absent one" in {
      InsightConfig.parse(cfg("""{"reads":{"outputs":[]}}""")).toOption.get.reads.outputs shouldBe Some(Vector.empty)
    }

    "reject out-of-range values naming the key" in {
      err("""{"preset":"poem"}""") should include("preset")
      err("""{"preset":3}""") should include("preset")
      err("""{"refresh":"hourly"}""") should include("refresh")
      err("""{"maxSentences":0}""") should include("maxSentences")
      err("""{"maxSentences":7}""") should include("maxSentences")
      err("""{"maxSentences":1.5}""") should include("maxSentences")
      err("""{"maxChars":79}""") should include("maxChars")
      err("""{"maxChars":1201}""") should include("maxChars")
      err(s"""{"prompt":"${"x" * 2001}"}""") should include("prompt")
      err("""{"prompt":4}""") should include("prompt")
      err("""{"reads":"x"}""") should include("reads")
    }

    "accept the boundaries" in {
      InsightConfig.parse(cfg(s"""{"maxSentences":1,"maxChars":80,"prompt":"${"x" * 2000}"}""")).isRight shouldBe true
    }

    "reject an unknown reads key naming reads.<key>" in {
      err("""{"reads":{"models":[]}}""") should include("reads.models")
    }

    "reject more than 8 outputs, a duplicate id, a non-string id" in {
      err(s"""{"reads":{"outputs":[${(1 to 9).map(i => s""""o$i"""").mkString(",")}]}}""") should include("reads.outputs")
      err("""{"reads":{"outputs":["a","a"]}}""") should include("reads.outputs")
      err("""{"reads":{"outputs":[1]}}""") should include("reads.outputs")
      InsightConfig.parse(cfg(s"""{"reads":{"outputs":[${(1 to 8).map(i => s""""o$i"""").mkString(",")}]}}""")).isRight shouldBe true
    }

    "reject previous_run, a bad window, more than 4 windows, a duplicate window" in {
      err("""{"reads":{"windows":["previous_run"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["2d"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["custom:P400D"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["1d","7d","30d","custom:P2D","custom:P3D"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["1d","1d"]}}""") should include("reads.windows")
    }
  }

  "InsightReadsCheck" should {
    val me    = OutputId("me")
    val peers = Map(OutputId("t") -> (OutputKind.Table: OutputKind), OutputId("i2") -> (OutputKind.Insight: OutputKind), me -> (OutputKind.Insight: OutputKind))
    def check(written: String, stored: String = "{}", kind: OutputKind = OutputKind.Insight) =
      InsightReadsCheck.check(kind, Some(me), cfg(written), cfg(stored), peers)

    "accept a same-pipeline non-insight Output, and an empty list" in {
      check("""{"reads":{"outputs":["t"]}}""") shouldBe Right(())
      check("""{"reads":{"outputs":[]}}""") shouldBe Right(())
    }
    "reject an unknown id, itself and another insight, naming reads.outputs" in {
      for (id <- Seq("zzz", "me", "i2"))
        check(s"""{"reads":{"outputs":["$id"]}}""").left.getOrElse("") should include("reads.outputs")
      check("""{"reads":{"outputs":["me"]}}""").left.getOrElse("") should include("itself")
    }
    "not judge reads the write does not change (dangling reads tolerated)" in {
      check("""{"prompt":"p"}""", """{"reads":{"outputs":["gone"]}}""") shouldBe Right(())
      check("""{"reads":{"outputs":["gone"]}}""", """{"reads":{"outputs":["gone"]}}""") shouldBe Right(())
    }
    "ignore non-insight kinds" in {
      check("""{"reads":{"outputs":["zzz"]}}""", kind = OutputKind.Table) shouldBe Right(())
    }
  }

  "insight placement" should {
    "default to a 6x3 panel, with no fieldMapping slots and vacuously bindable" in {
      OutputPanelDefaultSize.forKind(OutputKind.Insight) shouldBe OutputPanelDefaultSize.Size(6, 3)
      val spec = OutputBindingSpec.All.find(_.outputKind == OutputKind.Insight).get
      spec.allSlots shouldBe empty
    }
  }

  "OutputKind" should {
    "round-trip every canonical kind through asString/fromString" in {
      OutputKind.all.map(OutputKind.asString).map(OutputKind.fromString) shouldBe OutputKind.all.map(Right(_))
      OutputKind.all should contain(OutputKind.Insight)
    }
  }
}
