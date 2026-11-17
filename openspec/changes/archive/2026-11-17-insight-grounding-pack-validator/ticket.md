# HEL-1741: Insight L3: grounding pack, presets and citation validator behind a fake model seam

## Description

Leaf of HEL-921 (Insight Outputs). This leaf builds the pure parts of writing an insight: what the model sees, how it
is asked, and what is accepted back. It makes no live call.

- **Grounding pack.** `InsightContextBuilder` builds a bounded JSON pack from: the node's snapshot head (capped number
  of rows); the resolved compare deltas of the Outputs it reads; summary points for the configured windows. Every
  number in the pack gets a citation id (`c1..cn` mapping to outputId, field, value and capturedAt). Row text is quoted
  as data inside delimited JSON.
- **Presets** let a user add an insight without writing a prompt. The preset is inferred from what the node carries:
  metric with compare -> delta; time-series chart -> trend; top-n table -> leaders; anything else -> summary.
- **Renderer.** `InsightRenderer` calls the model through a new `InsightModelClient` seam, following the `AiStepClient`
  pattern. It uses a system prompt, no tools and no web search.
- **Validator.** It rejects any output that: is longer than `maxSentences` or `maxChars`; uses a citation marker that
  isn't in the pack; contains a numeral that does not match a cited value after normalization. The design states the
  rounding, percent and date rules. A rejected render is not stored. The last good render stays (owner ruling D9).
- **Token caps.** About 8k input and 400 output per render (D2). Cost is computed from API usage times a price table in
  config, read from the source. Dollars are recorded, not enforced.

## Acceptance criteria (fail-first unit tests)

- A fabricated number is rejected.
- An injected instruction in a row value stays inside the data block.
- The pack never exceeds the input-token budget (`ClaudeTokenEstimator`).
- The pack carries no source credential or connection fields.
- Fake client only. No live API call.

Migration: none. Parallel: can run alongside L1 (HEL-1740) and L2.

## Owner rulings binding this leaf (2026-11-17)

- D1: the model is the shared `CLAUDE_MODEL` setting.
- D2: token caps per render, about 8k input and 400 output. Dollars recorded (usage x price table read from the
  source), not enforced.
- D9: a render that fails the citation check is rejected and not stored; the last good render stays; retry once.

## Driver constraints

- NO live Anthropic API call of any kind (code default model is claude-opus-4-8).
- Must not depend on the `insight` Output kind (HEL-1740, not in main); take the node snapshot, compare deltas and
  history points as inputs.
- No Flyway migration (V138/V139 reserved).
