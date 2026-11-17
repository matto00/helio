## Standing Constraints

- [C1] No live Anthropic API call anywhere (tests, scripts, manual probes); every model interaction uses a fake seam or a recording fake ClaudeTransport.
- [C2] No dependency on the insight Output kind (HEL-1740); no Flyway migration; no change to ClaudeClient/ClaudeRequest/ClaudeModels; nothing wired into Main/ApiRoutes/triggers.
- [C3] Every AC proof test is recorded red (failing against a stub/mutation) before it is green; record each red run in the change dir as fail-first.md.
- [C4] Never read or print any .env file; quoted heredocs only; no pkill/pgrep/killall; sbt with -J-Xmx3g and nice -n 19; read the sbt test summary, not just the exit code.

### Backend

## 1. Domain types and seam

- [x] 1.1 Add domain/insights InsightInputs (head, compares, windows) and InsightLimits (8000/400/50/200); compiles
- [x] 1.2 Add domain/insights InsightModelClient trait, request/response/usage, sealed failures, Unavailable default; compiles
- [x] 1.3 Add domain/insights InsightPreset with fromString/asString and InsightPresetInference per design D6; unit spec green
- [x] 1.4 Add domain/insights InsightPriceTable with the design D9 default table and source URL/date; cost spec green

## 2. Pack, validator, renderer, adapter

- [x] 2.1 Add domain/insights InsightContextBuilder: citations, cited head/compare/window values, delimiter escaping, budget shedding (D3-D5); spec green
- [x] 2.2 Add domain/insights InsightValidator implementing D7 length, marker, date and numeral rules; spec green
- [x] 2.3 Add services/insights InsightRenderer with outcomes and one retry (D8); spec green with fake client
- [x] 2.4 Add services/insights InsightInputAdapters.fromResolution(output, resolution) (D2), window points via OutputHistoryService's headline reader, skipping points with no headline; spec green
- [x] 2.5 Add infrastructure/ai ClaudeInsightClient over sendWithTools (tools Nil, maxHops 0, webSearch false, system, maxTokens 400); spec green over a recording fake transport

### Tests

## 3. Acceptance proofs (fail-first)

- [x] 3.1 Fabricated number rejected (validator and renderer level); plus accepted cases for rounding, -12.4% vs pct -12.4, [c12] markers, and a string cell "1234" cited and stated as 1,234; red recorded first
- [x] 3.2 Injected instruction with a closing delimiter stays inside the data block and round-trips; red recorded first
- [x] 3.3 Pack under the 8000-token estimate for an oversized head; irreducible pack makes zero client calls; red recorded first
- [x] 3.4 Pack keys are allow-listed and contain no source credential/connection fields; mutation adding a key turns it red
- [x] 3.5 Two rejections keep the last good render and call the fake exactly twice; red recorded first
- [x] 3.6 Recording-transport spec proves system set, no tools, no web_search, max_tokens <= 400; red recorded first
- [x] 3.7 Run sbt testFull (nice -n 19, -J-Xmx3g) and scalafmt/quality checks; read the summary for zero failures
