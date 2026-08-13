## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read fresh (cold, no reliance on prior narrative): `ticket.md`, `proposal.md`, `design.md`,
`tasks.md`, `specs/claude-api-client/spec.md`, `workflow-state.md`, and round 1's
`skeptic-design-1.md` (treated strictly as claims to re-check, not facts). Confirmed the worktree
has no implementation yet (`grep` for the new env vars across `CLAUDE.md`/`infra/deploy-backend.sh`/
`infra/.env.deploy.example` returns nothing) — consistent with this being the design gate before
execution, so nothing to cross-check against real code yet.

Verified each of round 1's three change requests against the **current file contents**, not the
round-1 report's assertions:

1. **CR1 (stream guardrail-rejection contract undefined/untested) — resolved.**
   - `design.md` D4a (lines 72–79) now states the exact contract: `ClaudeClient.stream` runs the
     same pre-flight input-token check as `send`; on rejection it returns
     `Source.single(ClaudeStreamEvent.Error(GuardrailExceeded(reason)))` (not `Source.failed`) and
     completes normally, with the injected `ClaudeTransport.stream` seeing zero invocations.
   - `spec.md` now has a full new requirement, "The max-input-tokens guardrail applies identically
     to streaming" (lines 100–104), with a concrete scenario (lines 106–111): the resulting `Source`
     "emits exactly one `ClaudeStreamEvent` carrying the `GuardrailExceeded` reason and completes,
     and the injected `ClaudeTransport` records zero `stream` invocations."
   - `tasks.md` 4.3 states the same contract in task form, and 6.2 explicitly says "over-input-budget
     rejection with zero transport invocations (**both `send` and `stream`**)" — the missing task-6
     test now exists.
   - All three artifacts agree on one, unambiguous implementation.

2. **CR2 (`temperature` field with no env var/default) — resolved.**
   - `design.md` D7 (lines 96–105) adds `CLAUDE_TEMPERATURE` (default `1.0`, matching the Anthropic
     API's own default), explicitly closing the exact gap round 1 named ("This closes the gap where
     `tasks.md` previously declared `temperature` as a field with no env var populating it").
   - `tasks.md` 1.2 now lists `CLAUDE_TEMPERATURE` (default `1.0`) alongside the other `fromEnv()`
     reads.
   - `spec.md`'s config requirement (lines 3–9) now names `CLAUDE_TEMPERATURE` and its default in
     prose, with a dedicated scenario "Temperature defaults and is overridable" (lines 24–27).
   - No remaining internal contradiction: every place `ClaudeConfig`'s fields are enumerated now
     agrees on how `temperature` is populated.

3. **CR3 (`CLAUDE_MAX_TOKENS`/`CLAUDE_MAX_INPUT_TOKENS` defaults asserted but unspecified) —
   resolved.**
   - `design.md` D4 (lines 57–65) now states concrete values: `CLAUDE_MAX_TOKENS` default **4096**,
     `CLAUDE_MAX_INPUT_TOKENS` default **100,000**, with a one-sentence rationale for each (4096 as a
     conventional output ceiling; 100k as "comfortably inside every configurable model's context
     window while still rejecting runaway prompts").
   - `spec.md`'s config requirement (line 7) states both defaults in the requirement prose, plus a
     dedicated scenario "Token ceilings default when unset" (lines 29–32) pinning
     `maxOutputTokens == 4096` and `maxInputTokens == 100000`.
   - `tasks.md` 1.2 states the same two defaults, and — the specific gap round 1 flagged — **task
     6.1 now explicitly tests the default-value case**: "`ClaudeConfigSpec`: key present/absent/
     blank, model/temperature/max-tokens/max-input-tokens **defaults + overrides**..." (line 54),
     not just override behavior.

All three round-1 change requests are substantively resolved with concrete, cross-consistent values
— not just asserted in one file while silently absent elsewhere. I checked each claim against all
four documents (`design.md`, `tasks.md`, `spec.md`, and where relevant `proposal.md`) rather than
trusting a single occurrence.

### Additional adversarial pass (not limited to the three known gaps)

- Re-verified round 1's non-blocking notes were also cleaned up in this revision (not required, but
  checked since they touch the same documents): the `cost` = token-count interpretation sentence is
  now in `design.md` D4 (lines 67–70); the tokenizer encoding was changed from `cl100k_base` to
  `o200k_base` to match `ChunkByTokenCountConfig`'s existing default (Context, lines 10–12, and D4
  line 60); and `HttpClaudeTransport.send`'s exact error-signaling shape (`ClaudeApiException` →
  `.recover`/`.transform` → `Left(ApiError(...))`) is now spelled out in D3 (lines 51–55). None of
  these were required for a CONFIRM, but their presence is evidence the revision was a genuine,
  careful pass over the documents rather than a narrow patch of exactly the three flagged lines.
- Checked for new contradictions introduced by the revision itself: env var names/defaults
  (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`/`claude-opus-4-8`, `CLAUDE_TEMPERATURE`/`1.0`,
  `CLAUDE_MAX_TOKENS`/`4096`, `CLAUDE_MAX_INPUT_TOKENS`/`100000`) are stated identically across
  `design.md`, `tasks.md`, and `spec.md` — no drift found.
- Re-traced all six functional ACs from `ticket.md` to a design decision + task + spec requirement;
  unchanged from round 1's finding that all have a home, and the revision doesn't introduce scope
  drift (still explicitly defers route/consumer wiring to HEL-341).
- One minor documentation-completeness gap, not blocking: `tasks.md` 5.3 lists "`ANTHROPIC_API_KEY`
  (+ optional `CLAUDE_MODEL`/`CLAUDE_MAX_TOKENS`/`CLAUDE_MAX_INPUT_TOKENS`)" as the vars to add to
  `CLAUDE.md`'s prod env-var table, but omits the newly-added `CLAUDE_TEMPERATURE` from that list even
  though D7 treats it as equally configurable/documentable as the other three optional vars. This
  is a one-line task-list omission, not an ambiguity that produces divergent implementations (a
  competent implementer documenting three sibling optional env vars would very likely also document
  the fourth), so it does not rise to a blocking change request — but worth a one-line fix to
  `tasks.md` 5.3 during implementation.

### Verdict: CONFIRM

All three change requests from round 1 are resolved with concrete, testable values, stated
consistently across `design.md`, `tasks.md`, and `spec.md`, with corresponding task-6 test coverage
added for each previously-untested case. No new internal contradictions, placeholders, or
implementation-blocking ambiguity were found in this fresh pass. The design is sound enough to
implement.

### Non-blocking notes

- `tasks.md` 5.3: add `CLAUDE_TEMPERATURE` to the list of optional vars to document in `CLAUDE.md`'s
  prod env-var table, alongside `CLAUDE_MODEL`/`CLAUDE_MAX_TOKENS`/`CLAUDE_MAX_INPUT_TOKENS` (see
  above — not blocking, but an easy one-line consistency fix).
