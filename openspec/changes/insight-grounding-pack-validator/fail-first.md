# Fail-first record (HEL-1741, C12)

The specs were written against the finished implementation, so each proof test was made red by a recorded
mutation of the implementation (one mutation per run, sources restored and diffed clean after the last run).
Command for every run:

    cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.insights.* com.helio.services.insights.* com.helio.infrastructure.ai.ClaudeInsightClientSpec"

Green baseline (no mutation): `Tests: succeeded 48, failed 0`.

| Task | Mutation (file) | Red result (excerpt) |
|---|---|---|
| 3.1 fabricated number | `InsightValidator.numeralMatches`: `%` branch replaced by `if (true) true` (every numeral accepted) | InsightValidatorSpec "be rejected with a reason naming the numeral": `Vector() had size 0 instead of expected size 1`; InsightRendererSpec "be rejected by the renderer...": `expected Rejected, got Accepted(InsightRender(Revenue is 999 [c1].,...` |
| 3.1 `[c12]` marker not a numeral | `InsightValidator.checkSentence`: markers not stripped before the numeral scan (`val bare = sentence`) | "accept a correctly rounded value": `Vector("numeral '1' does not match any value cited in its sentence") was not empty`; "not treat the digits inside a citation marker...": red (marker digits scanned) |
| 3.1 `-12.4%` vs pct `-12.4` | `near`: sign kept (`math.abs(x - v)` instead of `math.abs(x - math.abs(v))`) | "accept a percent with or without a minus sign...": `Vector("numeral '12.4%' does not match any value cited in its sentence") was not empty` (only failure, 1 of 48) |
| 3.1 string cell "1234" | `InsightContextBuilder.parsePlainNumber`: `if (true) None` (numeric strings stay uncited) | "accept a string cell cited as a number...": `Some(77.0) was not equal to Some(1234.0)`; "cite every number, date and numeric string": same |
| 3.2 injected delimiter | `InsightContextBuilder.serialize`: `<`/`>`/`&` escaping removed | "keep an injected closing delimiter and instruction inside it...": `2 was not equal to 1` (two closing delimiters), the only failure |
| 3.3 budget (oversized head) | `InsightContextBuilder.build`: budget check disabled (`... \|\| estimate >= 0`) | "trim an oversized head...": `18856 was not less than or equal to 8000`; "shed windows and compares...": `404667 was not less than or equal to 1500` |
| 3.3 shedding order | `InsightContextBuilder.shed`: head-row halving disabled | "trim an oversized head so the estimate is at or under 8000" red (only failure) |
| 3.3 irreducible pack, zero calls | same budget-disabled mutation | "refuse an irreducible pack" red; InsightRendererSpec "make zero client calls...": `expected PackTooLarge, got Accepted(...)` |
| 3.4 allow-list (guard) | `InsightContextBuilder.pack`: extra key `"sourceConfig" -> "jdbc:postgresql://h/db"` added to the pack | "all belong to the allow-list, whatever the inputs": `false was not equal to true`; "carry no source, credential or connection fields..." red |
| 3.5 two rejections | `InsightRenderer.attempt`: retry disabled (`else if (false)`) | "keep the last good render, call the client exactly twice...": `1 was not equal to 2`; "be accepted on the retry after one rejection": `expected Accepted, got Rejected(...)` |
| 3.6 wire: system | `ClaudeInsightClient`: `system = None` | "carry a system prompt, no tools, no web search and at most 400 output tokens" red |
| 3.6 wire: web search | `ClaudeInsightClient`: `webSearch = true` | same test: `[{"max_uses":3,"name":"web_search","type":"web_search_20250305"}] was not equal to []` |
| 3.6 wire: 400 cap | `ClaudeInsightClient`: `maxTokens = Some(request.maxOutputTokens)` | "never exceed 400 even when asked for more": `4000 was not equal to 400` |

A first all-at-once mutation run (25 failures across 4 specs) is not used for attribution because the mutations
interact; the table above is from the isolated runs.
