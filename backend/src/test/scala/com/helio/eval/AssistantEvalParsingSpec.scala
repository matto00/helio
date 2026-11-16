package com.helio.eval

import com.helio.testkit.TempDirectorySupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.Files

/** Offline coverage for the eval runner's pure parts (HEL-1639 D8): transcript counting, the telemetry line parser and
 *  the cost formula. No model call, no HTTP. */
class AssistantEvalParsingSpec extends AnyWordSpec with Matchers with TempDirectorySupport {

  private def turn(role: String, blocks: String*): String = s"""{"role":"$role","content":[${blocks.mkString(",")}]}"""
  private def use(id: String, name: String, input: String = "{}"): String =
    s"""{"blockType":"tool_use","id":"$id","name":"$name","input":$input}"""
  private def result(id: String, content: String, isError: Boolean): String =
    s"""{"blockType":"tool_result","toolUseId":"$id","content":${JsString(content).compactPrint},"isError":$isError}"""

  "EvalTranscript.stats" should {
    "count failed calls from isError, zero-result finds separately, and keep the LAST successful propose" in {
      val transcript = s"""[
        ${turn("user", """{"blockType":"text","text":"hi"}""")},
        ${turn("assistant", use("a", "find"), use("b", "propose_patch_set", """{"edits":[1]}"""))},
        ${turn("user", result("a", "[]", false), result("b", "edit 0: bad", true))},
        ${turn("assistant", use("c", "propose_patch_set", """{"edits":[2]}"""))},
        ${turn("user", result("c", """{"proposalId":"p1"}""", false))},
        ${turn("assistant", """{"blockType":"text","text":"done"}""")}
      ]""".parseJson
      val s = EvalTranscript.stats(transcript)
      s.toolCalls shouldBe 3
      s.failedCalls shouldBe 1
      s.zeroResultFinds shouldBe 1
      s.proposeCalls shouldBe 2
      s.successfulProposes shouldBe 1
      s.hops shouldBe 3
      s.finalProposal.map(_.input.compactPrint) shouldBe Some("""{"edits":[2]}""")
      s.finalText shouldBe "done"
    }
  }

  "SpendLedger" should {
    "refuse to start on a ledger file that exists but is corrupt, instead of reading it as $0 spent (C1)" in {
      val file = newTempDir("eval-ledger").resolve("eval-spend-ledger.json")
      Files.writeString(file, "{ not json")
      an[IllegalStateException] should be thrownBy new SpendLedger(file)
      Files.writeString(file, """{"capUsd":3,"entries":"nope"}""")
      an[IllegalStateException] should be thrownBy new SpendLedger(file)
    }

    "start at $0 when there is no file, and sum a valid one" in {
      val dir = newTempDir("eval-ledger2")
      new SpendLedger(dir.resolve("absent.json")).total shouldBe 0.0
      val file = dir.resolve("ledger.json")
      val ledger = new SpendLedger(file)
      ledger.add("r", "c", 0.25)
      new SpendLedger(file).total shouldBe 0.25 +- 1e-9
    }
  }

  "EvalTelemetry.parseLine" should {
    "parse the JSON from the first brace even behind an sbt [info] prefix, with string-typed MDC numbers" in {
      val line = """[info] {"@timestamp":"t","message":"assistant_tool_loop_outcome","conversationId":"c1","modelId":"claude-haiku-4-5-20251001","inputTokens":"1000","outputTokens":"200","cacheReadInputTokens":"0","cacheCreationInputTokens":"0"}"""
      val t = EvalTelemetry.parseLine(line).getOrElse(fail("no telemetry parsed"))
      t.conversationId shouldBe "c1"
      t.modelId shouldBe "claude-haiku-4-5-20251001"
      t.costUsd shouldBe (0.001 + 0.001) +- 1e-9
    }

    "match a conversation by id from a log file, never by position" in {
      val dir = newTempDir("eval-parsing")
      val log = dir.resolve("backend.log")
      Files.writeString(log,
        """{"message":"assistant_tool_loop_outcome","conversationId":"other","modelId":"m","inputTokens":"5","outputTokens":"5"}""" + "\n" +
          """{"message":"assistant_tool_loop_outcome","conversationId":"mine","modelId":"m","inputTokens":"7","outputTokens":"9"}""" + "\n")
      EvalTelemetry.find(log, "mine").map(_.inputTokens) shouldBe Some(7L)
      EvalTelemetry.find(log, "absent") shouldBe None
    }
  }
}
