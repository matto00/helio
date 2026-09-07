## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit `3b236fd5` (base `8231b191`), plus uncommitted edits to `design.md` and
`specs/mcp-concise-response-modes/spec.md`. MCP-only; no dev server started (correct — no
`frontend/**`, no backend, no `schemas/**`, no migration; confirmed from `git diff main...HEAD --stat`).

### What I verified (with evidence)

**1. The post-evaluator spec edit is TRUE of the code, and is not a weakening.**
The rewritten SHALL: *"every field the response previously carried SHALL retain its previous value, and
no entity or per-entity detail SHALL be omitted"* + a new scenario requiring the omission enumeration
present-and-empty.
- (a) TRUE: I read the full-mode construction in the diff. `dataSources[].inferredSchema` and
  `pipelines[].steps[].outputColumns` are emitted with identical values in the non-concise branch
  (`context.ts` — a spread-refactor only); `truncation.applied` is now `omittedDetailKinds.length > 0`,
  which is `false` in full mode, i.e. the same value main hardcoded. The only wire-level change to a
  default response is the additive `truncation.omittedDetailKinds: []`. The prior "byte-identical" SHALL
  was indeed literally false; this one is literally true.
- (b) NOT vacuous: it still forbids both value change and omission on every existing field, and it
  *added* an obligation (the enumeration must be present and empty, never absent) rather than removing
  one. It is strictly more checkable than the old one, which no test could satisfy as written.
- (c) The evidence still binds. `context.test.ts` "the default response ... (task 6.6)" deep-compares
  default-args vs explicit `(DEFAULT_BUDGET_BYTES, false)` and asserts the concise-only keys are absent;
  full-mode *content* is separately pinned absolutely by the sibling assertions
  (`full.dataSources[0].inferredSchema` has 60 entries, `full.pipelines[0].steps[0].outputColumns` has
  60, `full.truncation.applied === false`, `omittedDetailKinds === []`) and by the pre-existing suites,
  which are unchanged apart from one added `omittedDetailKinds: []` literal (`git diff main...HEAD --
  helio-mcp/src/context.test.ts` — the only edit above line 440). Nothing was traded away.

**2. Mutations re-run by me, from the worktree root. Three, of which two prove independence.**

| Mutation | Result |
|---|---|
| M1 concise omits nothing (`...{ outputColumns }` unconditionally) | `Tests: 2 failed, 27 passed` — ✕ size arm (6.3) **and** ✕ step-content arm (6.5); breadth / Output-schema / truncation / default-identity stayed ✓ |
| M2 omission kept, count corrupted (`outputColumnCount: 0`) | `Tests: 1 failed, 28 passed` — ✕ **only** 6.5; size arm stayed ✓ |
| M3 all Output schemas emptied (`schema: []` at `context.ts:207`) | `Tests: 3 failed` — ✕ two pre-existing absolute Output-schema tests, ✕ the `> 150_000` collapse floor |

M2 settles the axis question: the step-content assertion fires **alone**, with the size assertion green,
so it is a genuinely independent axis and not the size assertion wearing a second label. M3 additionally
shows the `> 150_000` floor is a live collapse guard, not decoration. (Note for the record: the
"every Output's schema survives concise mode intact" test is *relative* — it compares concise to full and
stays green under M3 — but the absolute guarantee is held by the two pre-existing tests that did go red,
so the property is covered end-to-end.)
Implementation restored from backup; `git status` back to its pre-mutation state and suite green.

**3. Gates re-run myself, `--testPathPatterns=` (plural), from the worktree root.**
`npx jest --testPathPatterns=context` → **25 suites / 248 tests passed, 0 failed**.
`npx jest --testPathPatterns=hel865` → **1 suite / 2 tests passed**.
`npm run check:helio-mcp-types` (tsc --noEmit) clean; `npm run lint` (`--max-warnings=0`) clean;
`npm run format:check` clean. Counts match evaluation-1's claims exactly.

**4. Headroom measured, not taken on trust.** I instrumented the fixture directly:
`full = 465,036`, `concise = 180,951`, budget `200,000`, **headroom 9.52%**. design.md D8 states
180,726 / ~9.6% and explicitly says this "buys headroom, it does not make the response unconditionally
bounded", warns ~50 pipelines would bust it even concise, and that adding any per-entity detail busts
the target. No overclaim anywhere: the ACs claim only the 25/43 case, the spec's SHALL is scoped to
"at least 25 data sources and 43 pipelines", and the test asserts both directions on one fixture.

**5. Not a trap for an agent (the D2 inversion is legitimate).** I judged this against what the tool is
for. Every Output's `schema` — the field set an agent needs to *act* (bind an Output to a panel, author a
fieldMapping) — is retained in full in concise mode and asserted array-wise across all 43 pipelines.
Breadth is fully retained, so "does a pipeline already produce this field?" stays answerable; the
breadth alternative would have served ~14 of 43 pipelines, turning a large right answer into a small
wrong one. Every omitted list is replaced **in place** by its element count, and
`truncation.omittedDetailKinds` names both kinds, so a shallow entry is self-evidently shallow rather
than silently shallow — the specific failure mode the ticket's preference guards against. Both omitted
kinds are recoverable through existing tools (`analyze_pipeline` for per-step columns, named in the
description; `list_data_sources`/`list_source_objects` carry `inferredSchema`). And the mode is opt-in.
I do not find a path by which an agent reasons confidently from a partial picture without being told.

**6. HEL-979 is not implied fixed.** `grep -rn 979` over the change dir and `helio-mcp/src/`: three
explicit disclaimers (ticket.md "Explicitly NOT in scope", proposal.md Non-goals, design.md D6), zero
mentions in source or comments, and no code touches `WorkspaceContextService` or
`GET /api/workspace/context`. Clean.

### Verdict: REFUTE

Everything technical holds. What does not hold is artifact consistency: the "byte-identical" claim was
corrected in `spec.md` and `design.md` but left standing in `proposal.md`, so the change set now
contradicts itself on the one property the correction existed to fix. Cheap to close.

### Change Requests

1. **`proposal.md`, "What Changes", last line** — still reads *"Not breaking: verbose stays the default
   and byte-identical, matching HEL-914's precedent for the analyze half."* This is the exact statement
   design.md D3 now says the change deliberately does **not** assert ("rather than asserting a
   byte-identity the code does not have"), and which spec.md was rewritten to drop. Restate it to match:
   verbose stays the default with every existing field unchanged in value, additively gaining
   `truncation.omittedDetailKinds: []`.
2. **Record the AC3 deviation where a reader of the delivery will see it.** ticket.md AC3 says the full
   output is "byte-identical to today's"; the shipped response adds one key. The deviation is argued
   (D3/D4) and correct, but it currently lives only inside design.md. State it in the PR body (and the
   Linear comment) as an explicit, one-key additive deviation from AC3's literal wording, so it is not
   discovered later as an undisclosed contract change to `WorkspaceContextTruncation`.
3. **Commit the working-tree artifact edits.** `design.md` and `spec.md` are currently modified but
   uncommitted (`git status`), so the branch as committed at `3b236fd5` still carries the false
   byte-identical SHALL. Fold them (and CR-1/CR-2) into the commit before the PR.

### Non-blocking notes

- design.md D8's figure (180,726) is the pre-implementation estimate; the shipped value I measured is
  **180,951** (9.52% headroom) — the 225-byte delta is the new empty `omittedDetailKinds` key. Since D8
  is being edited anyway, carrying the shipped number would make the "treat concise as full" warning
  exact.
- The `get_workspace_context` description names `analyze_pipeline` as the fallback for omitted per-step
  columns but names no fallback for the omitted per-source `inferredSchema`. `list_data_sources` returns
  it; one clause would complete the redirect.
- Test 6.6's title says "byte-identical"; it proves default === explicit-false, which is the meaningful
  claim but not what the phrase suggests. A four-word title change would stop a future reader citing it
  as proof of identity with pre-change output. (Evaluator raised this too.)
- Nothing guards `laneTree.length > 0` in the promoted fixture; if `getPipeline` regressed, the
  swallowed-error path would silently restore the thin-fixture measurement design D1 blames for the
  prior false certification. One assertion closes it. (Evaluator's note 2 — I agree and reproduce it.)
