## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/insight-grounding/spec.md. I read skeptic-design-1.md and
skeptic-design-2.md as claims only. Worktree HEAD is 2e98eba9287d61a47957129f1f097ea039125d92. The change dir is
untracked, and no code has changed yet.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/insight-grounding-pack-validator/HEL-1741`.
- **Round-2 CR1 (numeric strings uncited) is resolved in the text:**
  - D3 now cites a trimmed plain-number string cell like a numeric cell. Inline `v` keeps the original string, and the
    citation `value` is the parsed number. Non-ISO date strings are a documented limit.
  - The spec requirement "Grounding pack cites every number" gained the `"1234"` sentence.
  - Task 3.1 adds the `"1234"` stated as `1,234` acceptance case.
- **Round-2 non-blocking notes are folded in:**
  - Each head row's rank is cited.
  - The pack, citations included, is rebuilt on each shedding step.
  - `compareWindowDays` is omitted when the window is under one day.
  - The custom-prompt delimiter strip runs to a fixpoint.
  - The window label is the compare token.
  - The lost usage on `Failed` is listed in Risks.
- **Seam, against live code:**
  - With `maxHops = 0` the first call is still made. `thisHop > maxHops` is checked only when `toolUses` is non-empty
    (ClaudeClient.scala:130-145).
  - A response with no tool use returns `FinalResponse`, or `Failed(NoAnswer)` on a refusal or a blank
    `max_tokens`/`pause_turn`.
  - `end_turn` with empty text gives an empty `FinalResponse`. D7's rule that blank text is rejected covers that case.
  - `buildTools` with `tools = Nil` and `webSearch = false` returns an empty sequence, with no `.last` on empty (lines 296-306).
  - `maxTokens` is clamped with `min(400, config.maxOutputTokens)` (line 312).
  - `system` is sent as a top-level block (lines 325-327) and counted in the guardrail (lines 357-360).
  - `modelId = config.model` (line 36), and the default is `claude-opus-4-8` (ClaudeConfig.scala:37).
  - `ClaudeTransport.sendTool` exists, and recording fakes over it already exist in ClaudeClientSpec and AssistantServiceSpec.
    So task 3.6 is feasible.
- **History types:**
  - `OutputHistoryResolution(compare, current, baseline, delta, pct, availableFrom, points)` and
    `ResolvedHistoryPoint.metric: Option[StoredMetricIdentity(field, agg)]` exist (OutputHistoryService.scala:16-33).
  - D2's adapter signature `(Output, OutputHistoryResolution)` fits them.
- **Other code checks:**
  - `OutputKind` is closed at six kinds with no `insight` (model.scala:606-613), so there is no HEL-1740 dependency.
  - `TopNShape` is documented as "via sort + limit" (TopNShape.scala:26), which matches the D6 Leaders rule.
  - `domain/insights` and `services/insights` do not exist yet, so the files are new only.
- **D9 price table, re-read from source.** I loaded https://platform.claude.com/docs/en/about-claude/pricing in a browser
  today. This was a docs page read, not a model API call. Every D9 value matches the page exactly:

  | Model | Input | Output | 5m write | Cache hit |
  | --- | --- | --- | --- | --- |
  | Opus 4.8 | 5 | 25 | 6.25 | 0.50 |
  | Haiku 5.5 (prompts up to 100k) | 0.10 | 0.50 | 0.125 | 0.01 |
  | Sonnet 5.5 | 2 | 10 | 2.50 | 0.10 |
  | Opus 5.5 | 4 | 20 | 5 | 0.20 |

  The model ids `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5` match the models overview page.
- **AC trace:**

  | AC | Covered by |
  | --- | --- |
  | Fabricated number rejected | D7, task 3.1 (validator and renderer level) |
  | Injection stays inside the data block | D4, task 3.2 |
  | Budget measured with `ClaudeTokenEstimator` | D5, task 3.3 |
  | No credential fields | D2 (type-level), task 3.4 (allow-list plus mutation) |
  | Fake client only | C1, task 3.6 |

  Owner rulings: D1 maps to design D1 (`client.modelId`), D2 to D5 and D9, and D9 to D8 (one retry, no text on
  `Rejected`/`Failed`, `lastGood` carried, task 3.5). No migration, wiring or ClaudeClient change is planned (C2).
- **Contradictions and placeholders:** I found no TODO or TBD. The proposal, design, tasks and spec agree. The spec
  scenarios match the D7 rules: sign dropped, markers stripped before the numeral scan, `%` matched only against pct.

### Verdict: CONFIRM

### Non-blocking notes

- **Percent-valued data cells cannot be stated with `%`.** D7 matches `%` numerals only against pct citations. A head
  cell like `rate: 12.5`, or a string `"12.5%"`, which is not a plain number and so stays uncited, can never be written
  as "12.5%". The retry may not rescue it. List this next to the non-ISO-date limit. Currency-formatted strings such as
  `"$1,234"` are a related case: they are also uncited.
- **Window point values.** `OutputHistoryResolution.points` are `OutputHistoryPoint` rows with a `summary: JsObject`,
  not doubles. The adapter should use the companion `headline` reader and skip points with no headline value. State this
  in 2.4 so it is not invented during execution.
- **Tokenizer gap.** The pricing page says Claude 4.7+ tokenizers produce about 30% more tokens than earlier ones. An
  o200k estimate of 8000 may therefore bill about 10k real input tokens. The Risks section already covers undercount
  against the 100k guardrail. L4 should compare `usage.inputTokens` with the estimate on its first live render, since D2
  says "about 8k".
- **Unknown model ids.** `claude-sonnet-5`, which CLAUDE.md gives as a `CLAUDE_MODEL` example and which is priced on the
  page at 2/10/2.50/0.20, is not in the D9 table. It yields `None`, which is the correct documented behavior. Consider
  adding it, since it is cheap.
- **Leaders detection.** "Last two ops" should be read over enabled steps only, if disabled steps can appear in
  `stepOps`. The caller supplies `stepOps`, so this is the caller's concern in L4.
- **Stray files.** Playwright wrote `.playwright-mcp/` snapshot and console logs from my pricing-page read, relative to
  its workspace root. They are not evidence for this report and need no persistence.
