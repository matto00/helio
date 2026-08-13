package com.helio.ai

import com.knuddels.jtokkit.Encodings
import com.knuddels.jtokkit.api.EncodingType

/** Estimates a request's input token count via `jtokkit`'s `o200k_base` BPE encoding — the same
 *  default `ChunkByTokenCountConfig` already uses elsewhere in this codebase, and the closer
 *  BPE-family approximation to modern Claude models than `cl100k_base` (design.md D4).
 *
 *  This is an ESTIMATE, not Claude's actual tokenizer: it counts each message's `content` string
 *  independently and sums, with no allowance for per-message role/formatting overhead the real
 *  API applies. It exists solely to drive the pre-flight `maxInputTokens` guardrail check —
 *  real token usage for cost accounting always comes from the API response's own `usage` field
 *  (`ClaudeResponse.usage`), never from this estimate. */
object ClaudeTokenEstimator {

  /** `jtokkit`'s registry/encoding are stateless and thread-safe — resolved once per JVM,
   *  mirroring `ChunkByTokenCountStep`'s `registry` field. */
  private val encoding = Encodings.newDefaultEncodingRegistry().getEncoding(EncodingType.O200K_BASE)

  def estimate(messages: Seq[ClaudeMessage]): Int =
    messages.map(m => encoding.countTokens(m.content)).sum
}
