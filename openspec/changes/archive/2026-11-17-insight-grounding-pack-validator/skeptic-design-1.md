## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md (cross-checked against Linear HEL-1741 live), proposal.md, design.md, tasks.md,
specs/insight-grounding/spec.md, against main 2e98eba9287d61a47957129f1f097ea039125d92 (worktree HEAD; change dir untracked).

### What I verified (with evidence)

- ticket.md matches the live Linear description (scope, ACs, D1/D2/D9). The ticket's agent notes allow
  `sendWithTools(maxHops = 0)` as an alternative to adding `system` to `ClaudeRequest`; design D1 picks it.
- `ClaudeToolRequest` has `system: Option[String]`, `maxHops`, `maxTokens`, `webSearch` (ClaudeModels.scala:177-186);
  `sendWithTools` resolves `FinalResponse(text, history, usage)` when no `tool_use` block arrives
  (ClaudeClient.scala:133-143), sums the four usage counters, counts `system` in its guardrail (ClaudeClient.scala:357-365),
  sends it as the top-level `system` field (ClaudeClient.scala:321). `buildTools` emits no web_search entry when
  `webSearch = false` (ClaudeClient.scala:298). Claims in design Context hold.
- `max_tokens` is clamped `min(request, config.maxOutputTokens)` (ClaudeClient.scala:308), so `Some(400)` gives <= 400.
- `ClaudeClient.modelId = config.model`; default `claude-opus-4-8` (ClaudeConfig.scala:37), which is in the D9 table.
- `AiStepClient` pattern (domain trait, sealed failures, `Unavailable` default) confirmed (domain/ai/AiStepClient.scala).
- `OutputHistoryService.deltaAndPct`: pct in percent units, `None` when base is 0 (OutputHistoryService.scala:160-167).
- `OutputHistoryResolution` fields (compare, current, baseline, delta, pct, availableFrom, points) exist; `OutputCompare.fromConfig`/`parse` exist.
- `OutputKind` closed set has no `insight` (model.scala:606-640): no HEL-1740 dependency in the plan.
- Output config keys `compare`, `fieldMapping` (Shared), `chartType`, `aggregation.groupBy` (Chart) confirmed (OutputConfigValidation.scala:20-28, 154);
  TopNShape expands to `sort` + `limit` (TopNShape.scala:8-9).
- No migration, route, Main/ApiRoutes wiring, or ClaudeClient/ClaudeRequest change planned. Every AC has a task (3.1-3.4, 3.6 fake-only).
- Pricing values in D9: internally consistent (cache write 1.25x input, cache read 0.1x input; micro-USD unit arithmetic checks out:
  1M+1M tokens on opus-4-8 = 30,000,000 micros). I did NOT re-read the pricing page (no web access here, and none needed to judge the design);
  the source URL and read date are carried, which is what the ruling requires.

### Verdict: REFUTE

Three defects in the two decisions that carry the ACs (D4 for AC2, D7 for AC1). Each one either cannot be implemented as written
or makes the spec contradict itself. All three are small edits.

### Change Requests

1. **design.md:48 (D4), the escaping rule reads as a no-op.** It says every `<`, `>` and `&` is "replaced by `<`, `>`, `&`".
   The escape sequences were lost when the text was rendered, so the rule that AC2 rests on cannot be read.
   Spell them out literally as the six-character JSON escapes backslash-u003c, backslash-u003e and backslash-u0026 (in a code span).
   Also state that the replacement runs on the serialized compact JSON string, because spray-json's printer does not emit these
   escapes. Spec scenario "Injected instruction stays inside the data block" should also say the injected value is under
   `maxCellChars` (200), or the "returns the original row value unchanged" assertion conflicts with D3's truncation.

2. **design.md D7, signed numerals contradict the absolute-value rule.** The regex captures an "optional sign", and normalization
   only strips `$`/commas. So `x` stays signed while the match is `|x - |v||`. A correctly cited "-12.4%" against pct -12.4 gives
   |-12.4 - 12.4| = 24.8 and is rejected. That contradicts D7's own stated intent ("absolute value, so down 12% matches pct -12.4")
   and the spec's "Rounded and percent numbers accepted" scenario. Fix: compare `|x|` to `|v|`, or state that the sign is dropped
   in normalization. Add a test case for a negative cited pct written with a minus sign.

3. **design.md D7, citation markers will be scanned as numerals.** Markers `[c12]` contain digits. D7 removes markers only for the
   length check ("Length: markers removed"). It never says whether they are removed before the date/numeral scan, and the numeral
   regex has no left-boundary rule. A literal implementation reads the `12` in `[c12]` as an uncited numeral and rejects nearly every
   valid render. Fix: state that markers are stripped (after the cited set is collected) before the date and numeral scans. Also state
   the numeral's left boundary: either a numeral must not be preceded by a letter or digit, or digits inside alphanumeric tokens like
   `Q3`/`H1` are scanned too, as the deliberately strict choice. Pick one and write it down.

### Non-blocking notes

- **Healthy renders that will be rejected (risk already listed; worth closing at planning cost):** the compare window ("7 days" from `7d`),
  the head row count ("top 5" under the Leaders preset), and years ("Nov 2026") are numbers the model will naturally write, but none of
  them is cited. Consider citing the compare window length and the head row count, or have the preset instructions forbid those forms.
  Also, D7 splits sentences on `.` and then takes the cited set per sentence, so a marker the model writes after the period ("rose 12%. [c3]")
  falls into the next sentence. The system prompt should require the marker before the sentence's terminal punctuation.
- D6 Trend: `OutputSummaryReducer` treats an absent `chartType` as `line` (OutputSummaryReducer.scala:113). Say whether a chart with no
  `chartType` counts as a line chart for inference.
- D2 `InsightInputAdapters`: `OutputHistoryResolution` has no outputId, outputName or field. The field is `current.metric.field`
  (`StoredMetricIdentity`) and the name comes from the `Output`, so the adapter needs the `Output` as an extra parameter. This is obvious
  once you look; noting it so the signature is not argued over during execution.
- D8: the custom prompt goes into the instruction part. If it contains the literal `<insight_data>`/`</insight_data>`, the
  "exactly one opening and one closing delimiter" property breaks. Consider stripping or escaping the delimiter tokens from the custom prompt.
- Cost: `sendWithTools` cache-marks the system prompt and the first user message (ClaudeClient.scala:313-324). A per-render pack is
  never re-read, so every render above the cache minimum pays a 1.25x cache-write rate on the pack. That is recorded, not enforced, so
  it is acceptable; flag it for L4.
- `tools: []` goes on the wire whenever `tools = Nil` (ClaudeProtocol.scala:244). The only production caller today always sends tools.
  This leaf cannot run a live call, so L4's first live render should confirm the API accepts an empty `tools` array.
- `ClaudeInsightClient` is constructible with no quota gate. D1 discloses this; L4 must not wire it without the gate.
- `InsightContextBuilder` in `domain/insights` would import `infrastructure.ai.ClaudeTokenEstimator`. The codebase already has
  domain-to-infrastructure imports, so this is not a violation, but it cuts against D1's "no infra type leaks" framing. Placing the builder
  in `services/insights` would avoid it.
