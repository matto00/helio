# Anthropic API contract for the three selectable models (platform.claude.com, fetched 2026-11-17)

Pages: models/overview, about-claude/pricing, build-with-claude/thinking, thinking-troubleshooting,
preserved-thinking, preserved-thinking/prefix-checks, models/{haiku,sonnet,opus}-5-5/migration-guide,
models/{opus,sonnet}-5-5/whats-new-*, agents-and-tools/tool-use/web-search-tool.

## Ids
`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`. "Every Claude model ID is a pinned snapshot, including the
dateless IDs used from the 4.6 generation on." Haiku guide: "a fixed model ID with no date suffix and no separate
alias" (same in the Opus/Sonnet guides). 1M context, 128K max output (synchronous) on all three.

## Sampling
- Haiku 5.5: "non-default `temperature`, `top_p`, or `top_k` values return a 400 error on every request"; guide: "omit".
- Sonnet 5.5 guide: "Sampling parameters return an error. Remove `temperature`, `top_p`, and `top_k`."
- Opus 5.5 guide: "Omit `temperature`, `top_p`, and `top_k`."
- Decision: never send any of the three for a catalog model, at any value.

## Thinking
- Adaptive thinking is the default on all three (omitting `thinking` = `{type:"adaptive"}`). Opus: always on.
- `thinking.type = "enabled"` + `budget_tokens`: 400 on all three ("not supported for this model. Use
  thinking.type.adaptive and output_config.effort").
- Display default `omitted` (empty `thinking` + `signature`). Thinking tokens count toward `max_tokens`.
- Effort defaults: Opus medium, Sonnet high, Haiku medium (`output_config.effort`); not sent by Helio.

## Forced tool_choice
Opus 5.5 and Sonnet 5.5: `tool_choice: type "tool" and "any" are not supported for this model.` (400). Haiku 5.5
accepts it, but the response then has no thinking block.

## Cross-model thinking
- "A thinking block that the new model or account can't use never causes an error. The API drops it for that request
  and doesn't bill it."
- Readability (producer -> reader): Haiku 5.5 blocks are readable by all three; Sonnet 5.5 by Sonnet/Opus; Opus 5.5 only
  by Opus. Sonnet 5.5 and Haiku 5.5 blocks are bound to the producing account.
- Same-model prefix check: "Possible 400 error" on all three when system, tools or an earlier message changed.
  It ignores `model`. HEL-1636 D3a/D4 already handle it (strip on tools change, drop thinking from persisted turns).

## Prefill
Rejected with 400 on all three.

## Pricing (per MTok: input / 5m cache write / cache read / output)
- Opus 5.5: $4 / $5 / $0.20 / $20
- Sonnet 5.5: $2 / $2.50 / $0.10 / $10
- Haiku 5.5 (prompt <= 100k): $0.10 / $0.125 / $0.01 / $0.50; (> 100k): $0.50 / $0.625 / $0.05 / $2.50
- Web search: $10 per 1,000 searches, all models.
These match `InsightPriceTable.Default` (HEL-1741).

## web_search
All three support web search ("available on every model"); `web_search_20250305` is the basic version in use.
