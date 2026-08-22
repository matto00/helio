package com.helio.services.proposals

import com.helio.ai.{ClaudeMessage, ClaudeTokenEstimator}

/** Deterministic history bounding for continued authoring conversations (HEL-397 design.md D4/D5)
 *  — oldest-turn-pairs-first truncation via the existing `ClaudeTokenEstimator`, never an
 *  LLM-generated summary (costed and nondeterministic — the AC's own "bounded... deterministically"
 *  wording already rules it out). A turn-pair is exactly `[user, assistant]`: `api_history` is
 *  always persisted in that shape (`AuthoringConversationTurns` never writes repair-round-trip
 *  noise, only the final user+assistant pair per turn — design.md D3/task 3.4), so dropping two
 *  elements at a time never splits a pair. */
object AuthoringHistoryBudget {

  /** Self-approved (design.md D4): well under `ClaudeConfig`'s default `maxInputTokens` (100,000),
   *  leaving headroom for the grounding-free follow-up message this budget applies to. */
  val DefaultMaxHistoryTokens: Int = 20000

  /** Self-approved (design.md D5): a high bar (~dozens of turns at typical proposal sizes) before a
   *  conversation is rejected outright, distinct from `ClaudeClient`'s own per-request
   *  `maxInputTokens` guardrail. */
  val DefaultMaxConversationTokens: Int = 200000

  /** Drops the oldest turn-pair repeatedly until `apiHistory` fits `maxTokens`, always keeping at
   *  least the single most recent pair (an over-budget final pair is left to `ClaudeClient`'s own
   *  pre-flight guardrail to reject — a distinct, per-request concern this budget never
   *  duplicates). */
  def trim(apiHistory: Vector[ClaudeMessage], maxTokens: Int): Vector[ClaudeMessage] = {
    @scala.annotation.tailrec
    def loop(remaining: Vector[ClaudeMessage]): Vector[ClaudeMessage] =
      if (remaining.size <= 2 || ClaudeTokenEstimator.estimate(remaining) <= maxTokens) remaining
      else loop(remaining.drop(2))
    loop(apiHistory)
  }
}
