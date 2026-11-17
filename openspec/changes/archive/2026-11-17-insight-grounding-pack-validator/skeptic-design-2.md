## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/insight-grounding/spec.md, and skeptic-design-1.md (as claims),
against worktree HEAD 2e98eba9287d61a47957129f1f097ea039125d92. The change dir is untracked, and no code has changed yet.

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/insight-grounding-pack-validator/HEL-1741`.
- Round-1 change requests are resolved in the text:
  - CR1: D4 now spells out the JSON escapes for `<`, `>` and `&`, applied after compact printing. The spec scenario now
    says the injected value is under the per-cell cap.
  - CR2: D7 drops the sign (`x = |parsed|`) and compares against `|v|`. Task 3.1 adds a test for -12.4% against pct -12.4.
  - CR3: D7 orders the steps as collect the cited set, strip markers, then scan dates and numerals. It picks the strict left
    boundary, with digits inside `Q3`/`H1` scanned.
  - Round-1 non-blocking notes are also folded in: window days and head row count are cited, the marker goes before the
    terminal punctuation, an absent `chartType` counts as line, the adapter takes `Output`, delimiter tokens are stripped
    from the custom prompt, and the estimator is passed as a function so `domain/insights` imports no infrastructure type.
- Seam claims checked in the live code:
  - `ClaudeToolRequest` has `system`, `maxHops`, `maxTokens` and `webSearch` (ClaudeModels.scala:177-186).
  - In `sendWithTools`, a response with no `tool_use` resolves `FinalResponse(text, history, usage)`, and refusal or
    blank `max_tokens`/`pause_turn` responses resolve `Failed(NoAnswer)` (ClaudeClient.scala:130-143).
    `HopBudgetExhausted` cannot occur when there are no tools.
  - The guardrail counts `system` (ClaudeClient.scala:357-360), and `modelId = config.model` (ClaudeClient.scala:36).
  - `TokenUsage` has four counters (ClaudeModels.scala:36-41).
  - `ClaudeTokenEstimator.estimate(Seq[ClaudeMessage])` exists (ClaudeTokenEstimator.scala:21).
- History claims checked:
  - `OutputHistoryResolution(compare, current, baseline, delta, pct, availableFrom, points)` exists
    (OutputHistoryService.scala:25-33), and `ResolvedHistoryPoint.metric: Option[StoredMetricIdentity(field, agg)]` gives
    the field.
  - `OutputHistoryService.resolve`/`headline` live on the companion object (line 137+), so the adapter can reuse them
    without new SQL.
  - `deltaAndPct` uses percent units (lines 160-167).
- `OutputCompare.parse` accepts only day/time durations (OutputCompare.scala:21-41), so "window length in whole days"
  is well defined except for sub-day windows (see notes).
- `TopNShape` expands to `sort` then `limit`, so the D6 Leaders rule is consistent with it.
- Every AC maps to a task: fabricated number (3.1), injection (3.2), budget (3.3), no credential fields (3.4), and fake
  only (C1, 3.6). Nothing depends on HEL-1740, and no migration, wiring or ClaudeClient change is planned.
- D9 price arithmetic is internally consistent (cache write 1.25x input, cache read 0.1x input). I could not re-read the
  pricing page (no web tool in this session). The table carries its URL and read date, as D2 requires.

### Verdict: REFUTE

One defect. It contradicts the ticket's text and the spec's own requirement, and it is a one-paragraph edit to D3/D7.

### Change Requests

1. **design.md D3: numbers held as strings are left uncited.** As a result, the pack breaks "every number gets a citation
   id", and the validator rejects true statements about common data.
   - D3 cites only "every numeric cell and every ISO-date string cell". Other strings "stay JSON strings".
   - On main, CSV source rows are loaded as raw strings (`InProcessPipelineEngine.loadCsvRowsFromBytes`,
     InProcessPipelineEngine.scala:961-973: `headers.zip(padded)` of `String` values). So any node without a `cast`
     step has a head whose numbers are JSON strings like `"1234"` or `"12.5"`.
   - Two things follow:
     - (a) The ticket ("Every number in the pack gets a citation id") and spec requirement "Grounding pack cites every
       number" ("Every numeric value in the pack ... SHALL carry a citation id") are violated for such a pack.
     - (b) Under D7, any numeral the model writes from those cells matches no cited value, so the render is rejected
       twice and never accepted. This happens on every uncast-CSV node that states a number, which defeats the feature
       for the most common source kind.
   - Required revision:
     - State in D3 that a string cell whose trimmed text is a finite plain number is cited like a numeric cell. The
       pattern is optional sign, digits, optional `,` thousands groups and optional decimal part, parsed to a value for
       matching. The original string can stay as `v`, or the parsed number can be used. Pick one and say which.
     - State in D3 how non-ISO date strings are treated. Either leave them uncited as a documented limit, or cite only
       ISO dates.
     - Add a test to 3.1 or 2.1. A head with string-typed numeric cells (`"1234"`) produces a citation, and a render
       stating `1,234 [cN]` is accepted.
     - Add one sentence to the spec requirement "Grounding pack cites every number" covering numeric strings.

### Non-blocking notes

- **Ranks under the Leaders preset.** The system prompt requires "digits only (no number words)". A model that ranks
  rows ("#1", "2nd") will then write uncited digits, and D7 rejects them. A model writing "second" would pass, because
  there is no word detection. So obeying the prompt is penalized. Either cite each head row's 1-based position
  (`field: "rank"`), or have the Leaders instruction forbid rank numerals. L4 can measure this, but it is cheap to settle
  now.
- **Shedding and the citations array.** D3 stores each value twice: once in `citations` and once inline as `{cite, v}`.
  D5 sheds rows but does not say that `citations` is rebuilt for the shed pack. If it is not rebuilt, the citations array
  alone can keep a "trimmed" head over budget, and task 3.3 would fail. Say that the pack, including its citations, is
  rebuilt from the reduced inputs on each shedding step. Consider dropping the inline `v` or the `citations.value`
  duplicate to save budget.
- **compareWindowDays for sub-day custom windows.** A window like `custom:PT12H` gives 0 whole days. Say that the
  citation is omitted when the window is under one day, or cite hours as well.
- **Custom-prompt delimiter stripping.** It should run to a fixpoint. A single pass over `<insight<insight_data>_data>`
  leaves `<insight_data>` behind.
- **Lost usage on failure.** `ClaudeToolOutcome.Failed` carries no usage (ClaudeModels.scala:216). A refusal still bills
  tokens, but `Failed` records none for that call. This is acceptable because cost is recorded, not enforced. Flag it for
  L4's cost ledger.
- **Window label.** `InsightWindow.label` has no stated source. The compare token is the obvious choice, and it is worth
  naming in D2 so it is not decided during execution.
- **Where the price table lives.** The ticket says the price table is "in config". D9 puts a default table in code with
  its source URL. That reads as acceptable for an unwired leaf, but L4 may want it overridable.
- Carried from round 1 and still true: `tools: []` goes on the wire, the pack is cache-marked (1.25x write rate), and the
  adapter has no quota gate. All three are disclosed in the Risks section, and L4 owns them.
