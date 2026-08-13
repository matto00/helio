package com.helio.ai

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.{Map => JMap}

/** Coverage for `ClaudeConfig.fromEnv()` (HEL-390 tasks 6.1): key present/absent/blank,
 *  model/temperature/max-tokens/max-input-tokens defaults + overrides, and that the API key
 *  never appears in `toString`/logging output (design.md's "API key never appears in logs"
 *  requirement + task 1.3).
 *
 *  Mutates the real process environment via reflection to exercise `sys.env` branches, mirroring
 *  the existing `withEnv`/`withoutEnv` pattern in `LocalFileSystemSpec`/`GcsFileSystemSpec`. Every
 *  mutation is restored in a `finally` block so no other spec observes a changed environment. */
class ClaudeConfigSpec extends AnyWordSpec with Matchers {

  "ClaudeConfig.fromEnv" should {

    "return Right(config) with apiKey set from a non-blank ANTHROPIC_API_KEY" in {
      withEnv("ANTHROPIC_API_KEY" -> "sk-ant-test-key-12345") {
        val result = ClaudeConfig.fromEnv()
        result.isRight shouldBe true
        result.map(_.apiKey) shouldBe Right("sk-ant-test-key-12345")
      }
    }

    "return Left naming ANTHROPIC_API_KEY when the variable is unset" in {
      withoutEnv("ANTHROPIC_API_KEY") {
        val result = ClaudeConfig.fromEnv()
        result.isLeft shouldBe true
        result.left.getOrElse("") should include("ANTHROPIC_API_KEY")
      }
    }

    "return Left naming ANTHROPIC_API_KEY when the variable is blank" in {
      withEnv("ANTHROPIC_API_KEY" -> "   ") {
        val result = ClaudeConfig.fromEnv()
        result.isLeft shouldBe true
        result.left.getOrElse("") should include("ANTHROPIC_API_KEY")
      }
    }

    "default model to claude-opus-4-8 when CLAUDE_MODEL is unset" in {
      withEnv("ANTHROPIC_API_KEY" -> "key") {
        withoutEnv("CLAUDE_MODEL") {
          ClaudeConfig.fromEnv().map(_.model) shouldBe Right("claude-opus-4-8")
        }
      }
    }

    "override model when CLAUDE_MODEL is set" in {
      withEnv("ANTHROPIC_API_KEY" -> "key", "CLAUDE_MODEL" -> "claude-haiku-4-5-20251001") {
        ClaudeConfig.fromEnv().map(_.model) shouldBe Right("claude-haiku-4-5-20251001")
      }
    }

    "default temperature to 1.0 when CLAUDE_TEMPERATURE is unset" in {
      withEnv("ANTHROPIC_API_KEY" -> "key") {
        withoutEnv("CLAUDE_TEMPERATURE") {
          ClaudeConfig.fromEnv().map(_.temperature) shouldBe Right(1.0)
        }
      }
    }

    "override temperature when CLAUDE_TEMPERATURE is set" in {
      withEnv("ANTHROPIC_API_KEY" -> "key", "CLAUDE_TEMPERATURE" -> "0.3") {
        ClaudeConfig.fromEnv().map(_.temperature) shouldBe Right(0.3)
      }
    }

    "default maxOutputTokens=4096 and maxInputTokens=100000 when unset" in {
      withEnv("ANTHROPIC_API_KEY" -> "key") {
        withoutEnv("CLAUDE_MAX_TOKENS", "CLAUDE_MAX_INPUT_TOKENS") {
          val result = ClaudeConfig.fromEnv()
          result.map(_.maxOutputTokens) shouldBe Right(4096)
          result.map(_.maxInputTokens) shouldBe Right(100000)
        }
      }
    }

    "override maxOutputTokens and maxInputTokens independently when set" in {
      withEnv("ANTHROPIC_API_KEY" -> "key", "CLAUDE_MAX_TOKENS" -> "2048", "CLAUDE_MAX_INPUT_TOKENS" -> "50000") {
        val result = ClaudeConfig.fromEnv()
        result.map(_.maxOutputTokens) shouldBe Right(2048)
        result.map(_.maxInputTokens) shouldBe Right(50000)
      }
    }
  }

  "ClaudeConfig.toString" should {

    "never render the configured apiKey value" in {
      val secretKey = "sk-ant-super-secret-value-should-not-leak"
      val config    = ClaudeConfig(apiKey = secretKey, model = "claude-opus-4-8", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)

      config.toString should not include secretKey
      config.toString should include("redacted")
    }
  }

  // ---- env-mutation helpers (mirrors LocalFileSystemSpec/GcsFileSystemSpec) ----

  private def withEnv(pairs: (String, String)*)(block: => Unit): Unit = {
    val saved = pairs.map { case (k, _) => k -> sys.env.get(k) }
    pairs.foreach { case (k, v) => setEnv(k, v) }
    try block
    finally saved.foreach { case (k, prev) =>
      prev.fold(unsetEnv(k))(setEnv(k, _))
    }
  }

  private def withoutEnv(keys: String*)(block: => Unit): Unit = {
    val saved = keys.map(k => k -> sys.env.get(k))
    keys.foreach(unsetEnv)
    try block
    finally saved.foreach { case (k, prev) =>
      prev.fold(())(setEnv(k, _))
    }
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def setEnv(key: String, value: String): Unit = {
    val envField = System.getenv().getClass.getDeclaredField("m")
    envField.setAccessible(true)
    envField
      .get(System.getenv())
      .asInstanceOf[JMap[String, String]]
      .put(key, value)
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def unsetEnv(key: String): Unit = {
    val envField = System.getenv().getClass.getDeclaredField("m")
    envField.setAccessible(true)
    envField
      .get(System.getenv())
      .asInstanceOf[JMap[String, String]]
      .remove(key)
  }
}
