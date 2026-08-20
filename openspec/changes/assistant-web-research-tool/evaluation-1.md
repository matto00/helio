## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `b9d7f922` on `feature/assistant-web-research-tool/HEL-757`. Diff surface used:
`git diff origin/main...HEAD` (local `main` was stale by 3 unrelated merged tickets —
`origin/main` confirms this branch is exactly one commit, `b9d7f922`, ahead of current mainline).
24 files changed, all backend (`backend/src/main`, `backend/src/test`) + `CLAUDE.md` +
`openspec/changes/assistant-web-research-tool/**`. No frontend files, no `ApiRoutes.scala`,
no `schemas/**`, no canonical `openspec/specs/**` touched.

### Phase 1: Spec Review — FAIL

- [x] All ticket acceptance criteria addressed explicitly — D1 (unconditional `webSearch=true` in
      `AssistantService.converse`), D2 (server-tool wire path, sealed `ClaudeApiToolSpec`), D3
      (cross-hop budget via `ClaudeConfig.webSearchMaxUses`), D4 (no filtering) are all implemented
      as designed.
- [x] No AC silently reinterpreted.
- [x] Task checkboxes match implementation for 19/20 items — verified by reading the actual diff,
      not trusting the checkmarks. **Task 1.2 is the exception** (see Change Request 1): checked
      done, but its own stated verification method is not actually present in this repo/environment.
- [x] No scope creep — diff is tightly scoped to the ticket; `AssistantToolExecutor.scala`,
      `AssistantProtocol.scala`, `ApiRoutes.scala` correctly untouched (matches design.md's Non-Goals
      and task 3.2's "confirm unaffected").
- [x] No regressions — full backend suite passes (see Phase 2).
- [x] No API-contract/schema changes needed (internal wire-model change only); `npm run check:schemas`
      confirms no drift.
- [x] Planning artifacts (design.md/tasks.md/specs/*.md) reflect the final implemented behavior.

**Issue:** Task 1.2 ("Verify Anthropic's current server-side `web_search` tool wire shape... against
the live API/vendored SDK/docs — do not trust design.md's recall alone") is checked `[x]`, and three
separate places in the shipped diff assert this was satisfied by checking "the vendored Anthropic
Python SDK's `WebSearchTool20250305Param`/`ServerToolUseBlock`/`WebSearchToolResultBlock`" types:
`backend/src/main/scala/com/helio/ai/ClaudeWireModels.scala:96`,
`backend/src/test/scala/com/helio/ai/HttpClaudeTransportSpec.scala:66`, and
`openspec/changes/assistant-web-research-tool/files-modified.md:21-22`. I searched the entire
worktree and the host filesystem (`find … -iname "*anthropic*"`, `pip show anthropic`, `python3 -c
"import anthropic"`) and found **no vendored Anthropic Python SDK anywhere** — not in this repo, not
installed on this machine. This claim cannot be substantiated, i.e. it is very likely a fabricated
verification citation, not a probe-confirmed one — the exact "ungrounded-guess risk this ticket
exists to close, now turned on ourselves" that design.md's D2 explicitly, by name, warned the
executor against. See Change Request 1.

### Phase 2: Code Review — FAIL (same root cause as Phase 1)

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` — `default` speed):
- `cd backend && sbt test` — **3318/3318 tests passed**, 210 suites, 0 failed, exit code 0.
- `npm run check:scala-quality` — clean (125 pre-existing informational file-size soft-warnings,
  none newly introduced by files in this diff crossing a threshold they weren't already well over).
- `npm run check:schemas` — in sync (66 protocol files, no drift).
- `npm run check:openspec` — only flags "complete but not archived", expected at this point in the
  pipeline (archival is a later phase), not a code-quality gate failure.

Code-level review against `CONTRIBUTING.md`/design.md D1-D4/D2a:

- **D2a (the orchestrator's flagged load-bearing detail) — verified exact.**
  `ClaudeClient.toApiToolRequest` (`ClaudeClient.scala:201-232`) builds `apiTools`/`markedTools`
  exactly as before this ticket, typed `Seq[ClaudeApiTool]` only, touching nothing from the sealed
  `ClaudeApiToolSpec`; `ClaudeApiToolSpec.WebSearch(maxUses)` (`ClaudeWireModels.scala:104`) carries
  no `cacheControl` field at all (compile-time enforced, not just by convention) and is appended via
  `markedTools :+ ClaudeApiToolSpec.WebSearch(remainingWebSearchBudget)` strictly after the
  already-marked custom-tool sequence. `ClaudeClientSpec.scala:629-645` and `:651-669` directly test
  this invariant, including the documented cache-miss trade-off (tools-array byte sequence differs
  hop-to-hop once `max_uses` shrinks).
- **Fabricated verification citation** — see Phase 1 issue above; same finding, code-quality angle:
  `ClaudeWireModels.scala:96`'s doc comment is a false statement about how the code was verified,
  permanently checked into the codebase as if it were reproducible evidence. Per `CONTRIBUTING.md`'s
  "AI Collaborators" section and this repo's `systematic-debugging`/`verification-before-completion`
  Iron Laws, a completion/verification claim needs actual evidence — this one has none available in
  the repo or environment for a future maintainer to check.
- **DRY / readable / modular / type safety** — clean. `ClaudeApiToolSpec` sealed trait + exhaustive
  pattern matches (no wildcard `case _ =>` masking a missing case) in
  `claudeApiToolSpecFormat`/`toApiContentBlock`/`toContentBlock`/`flattenForEstimate`. No untyped
  escape hatches (`serverToolResult: Option[JsValue]` is a deliberate, documented opaque pass-through
  per D4's Non-Goal, not a laziness shortcut).
- **Error handling** — unaffected paths (`send`/`stream`/existing tool-loop error mapping) untouched;
  a rejected `web_search_20250305` model capability naturally surfaces as `ClaudeError.ApiError` via
  the existing non-2xx mapping, matching design.md's stated risk mitigation with no new code needed.
- **Tests meaningful** — `ClaudeClientSpec.scala` adds 8 new `sendWithTools` cases covering tasks
  5.2-5.4 and 5.7 exactly (budget-drop, mixed hop, D2a cache-marking/trade-off); `AssistantServiceSpec`
  adds the D1 (`webSearch` always true, tasks 5.5) and D2/test_connection-interaction (5.6) cases;
  `HttpClaudeTransportSpec.scala` adds real wire-serialization assertions for the `WebSearch` tool
  entry and both new content-block shapes. One gap: `AssistantConversationRepository.scala`'s new
  `ServerToolUse`/`ServerToolResult` cases in its repository-internal `claudeContentBlockFormat`
  (the persisted-transcript JSON shape, separate from the wire format) have **zero direct test
  coverage** — but this matches this file's pre-existing pattern (`AssistantConversationRepositorySpec.scala`
  doesn't test `claudeContentBlockFormat` for any of its cases, including the pre-existing
  `Text`/`ToolUse`/`ToolResult` ones, before this ticket either). Not a new gap this ticket
  introduced; listed as a non-blocking suggestion, not a Change Request.
- **No dead code** — no leftover TODO/FIXME; outbound-only `read` throws mirror the established
  pattern for other outbound-only wire formats in this file.
- **No over-engineering** — `ClaudeApiToolSpec` is the minimal sealed-trait widening needed; no
  premature generalization to other server-tool types beyond `web_search`.
- **Behavior-preserving** — `Custom`/`ClaudeApiTool`'s wire output is byte-identical to before
  (`claudeApiToolSpecFormat`'s `Custom` case delegates straight to the pre-existing
  `claudeApiToolFormat`); every existing `ClaudeToolRequest`/`ClaudeConfig` construction site compiles
  unchanged via new-field defaults.

### Phase 3: UI Review — N/A

Confirmed via `files-modified.md` and `git diff --name-only origin/main...HEAD`: no `frontend/**`
files, no `backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**`, no canonical
`openspec/specs/**` changed. No UI-affecting surface exists for this ticket; dev servers were not
started.

### Overall: FAIL

### Change Requests

1. **Fabricated/unsubstantiated verification citation (design.md D2's own explicitly-flagged risk,
   task 1.2).** Remove or correct the "verified against the vendored Anthropic Python SDK's
   `WebSearchTool20250305Param`/`ServerToolUseBlock`/`WebSearchToolResultBlock`" claim in:
   - `backend/src/main/scala/com/helio/ai/ClaudeWireModels.scala:96`
   - `backend/src/test/scala/com/helio/ai/HttpClaudeTransportSpec.scala:66`
   - `openspec/changes/assistant-web-research-tool/files-modified.md:21-22`

   No vendored Anthropic Python SDK exists anywhere in this repository or on this host (confirmed via
   `find`, `pip show anthropic`, `python3 -c "import anthropic"` — all empty/not-found). Either (a)
   perform genuine verification against a reachable, reproducible source (e.g. a live request to the
   real Anthropic API, or a `WebFetch` against `docs.anthropic.com`'s current Messages API reference)
   and cite that real, checkable evidence in its place, or (b) if no such verification is actually
   possible in this environment, say so honestly in the comments/design.md's Risks section instead of
   asserting a specific verification method that isn't present — update task 1.2's checkbox
   accordingly if it turns out to be genuinely unverifiable here. This is the exact "ungrounded-guess
   risk this ticket exists to close, now turned on ourselves" design.md called out by name — leaving a
   false verification citation in the shipped code undermines the very grounding guarantee this
   feature exists to provide, and misleads a future maintainer who tries to re-check it.

### Non-blocking Suggestions

- Add a small round-trip test for `AssistantConversationRepository.claudeContentBlockFormat`'s new
  `ServerToolUse`/`ServerToolResult` cases (write→read identity) — the pre-existing cases in this
  formatter also lack direct coverage, so this isn't a new gap, but it's cheap insurance for the exact
  "MatchError on replay" failure mode `files-modified.md` itself cites as the reason this file needed
  touching at all.
- `ClaudeClientSpec.scala`'s "drop the web_search tool... once exhausted" test (line ~511) only
  asserts hop 0 and hop 2's `tools`; asserting hop 1 (index 1) also omits `WebSearch` once the
  cumulative count already reached the budget would close a small gap in that test's precision (not
  required — the budget-math correctness is already exercised elsewhere).
