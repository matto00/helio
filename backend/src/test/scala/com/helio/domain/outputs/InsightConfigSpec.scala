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

  private val selectable: String => Boolean = Set("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5")
  private def cfg(s: String): JsObject = s.parseJson.asJsObject
  private def err(s: String): String   = InsightConfig.parse(cfg(s), selectable).left.getOrElse(fail(s"expected Left for $s"))

  "InsightConfig.parse" should {
    "apply every default to an empty config" in {
      val c = InsightConfig.parse(JsObject.empty, selectable).toOption.get
      c.preset shouldBe InsightPreset.Auto
      c.prompt shouldBe None
      c.reads shouldBe InsightReads(None, Vector.empty)
      c.refresh shouldBe InsightRefresh.OnRun
      c.maxSentences shouldBe 2
      c.maxChars shouldBe 400
    }

    "read every key" in {
      val c = InsightConfig.parse(cfg("""{"preset":"delta","prompt":"why","reads":{"outputs":["a","b"],"windows":["7d","custom:P2D"]},"refresh":"daily","maxSentences":6,"maxChars":1200}"""), selectable).toOption.get
      c.preset shouldBe InsightPreset.Delta
      c.prompt shouldBe Some("why")
      c.reads shouldBe InsightReads(Some(Vector(OutputId("a"), OutputId("b"))), Vector("7d", "custom:P2D"))
      c.refresh shouldBe InsightRefresh.Daily
      c.maxSentences shouldBe 6
      c.maxChars shouldBe 1200
    }

    "treat null as absent for every key" in {
      InsightConfig.parse(cfg("""{"preset":null,"prompt":null,"reads":null,"refresh":null,"maxSentences":null,"maxChars":null}"""), selectable) shouldBe
        InsightConfig.parse(JsObject.empty, selectable)
    }

    "distinguish an empty reads.outputs from an absent one" in {
      InsightConfig.parse(cfg("""{"reads":{"outputs":[]}}"""), selectable).toOption.get.reads.outputs shouldBe Some(Vector.empty)
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
      InsightConfig.parse(cfg(s"""{"maxSentences":1,"maxChars":80,"prompt":"${"x" * 2000}"}"""), selectable).isRight shouldBe true
    }

    "reject an unknown reads key naming reads.<key>" in {
      err("""{"reads":{"models":[]}}""") should include("reads.models")
    }

    "reject more than 8 outputs, a duplicate id, a non-string id" in {
      err(s"""{"reads":{"outputs":[${(1 to 9).map(i => s""""o$i"""").mkString(",")}]}}""") should include("reads.outputs")
      err("""{"reads":{"outputs":["a","a"]}}""") should include("reads.outputs")
      err("""{"reads":{"outputs":[1]}}""") should include("reads.outputs")
      InsightConfig.parse(cfg(s"""{"reads":{"outputs":[${(1 to 8).map(i => s""""o$i"""").mkString(",")}]}}"""), selectable).isRight shouldBe true
    }

    "reject previous_run, a bad window, more than 4 windows, a duplicate window" in {
      err("""{"reads":{"windows":["previous_run"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["2d"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["custom:P400D"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["1d","7d","30d","custom:P2D","custom:P3D"]}}""") should include("reads.windows")
      err("""{"reads":{"windows":["1d","1d"]}}""") should include("reads.windows")
    }
  }

  "InsightConfig model key (HEL-1743 R1)" should {
    "default to absent (the server default) and read a selectable id" in {
      InsightConfig.parse(JsObject.empty, selectable).toOption.get.model shouldBe None
      InsightConfig.parse(cfg("""{"model":"claude-haiku-5-5"}"""), selectable).toOption.get.model shouldBe Some("claude-haiku-5-5")
    }
    "treat null as cleared" in {
      InsightConfig.parse(cfg("""{"model":null}"""), selectable).toOption.get.model shouldBe None
    }
    "reject an id outside the selectable set, naming model" in {
      err("""{"model":"claude-opus-4-8"}""") should include("model")
      InsightConfig.parse(cfg("""{"model":"claude-opus-5-5"}"""), _ == "claude-haiku-5-5").left.getOrElse("") should include("model")
    }
    "reject a non-string, naming model" in {
      err("""{"model":7}""") should include("model")
      err("""{"model":["claude-haiku-5-5"]}""") should include("model")
    }
    "list model among the insight-owned keys" in {
      InsightConfig.OwnKeys should contain("model")
    }
  }

  "InsightReadsCheck" should {
    val me    = OutputId("me")
    val peers = Map(OutputId("t") -> (OutputKind.Table: OutputKind), OutputId("i2") -> (OutputKind.Insight: OutputKind), me -> (OutputKind.Insight: OutputKind))
    def check(written: String, stored: String = "{}", kind: OutputKind = OutputKind.Insight) =
      InsightReadsCheck.check(kind, Some(me), cfg(written), cfg(stored), peers, selectable)

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
