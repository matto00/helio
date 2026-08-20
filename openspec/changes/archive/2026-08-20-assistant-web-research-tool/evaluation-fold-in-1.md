## Evaluation Report — Fold-in Cycle 1 (evaluation-fold-in-1.md)

### Scope note

This is a scoped fold-in review, not a re-review of the full ticket. HEL-757's main
implementation already shipped as PR #400 (open/unmerged) and passed evaluation cycle 2
(`evaluation-2.md`, PASS) plus a final-gate skeptic CONFIRM (`skeptic-final-1.md`). During
Delivery-phase triage the human approved folding in one small additional scope — tightening
`ClaudeClientSpec.scala`'s cross-hop web_search-budget-exhaustion test to also assert hop 1 —
which passed its own fresh design-gate CONFIRM (`skeptic-design-4.md`). This report evaluates
only that fold-in increment (commit `92dfd07c`), per the orchestrator's explicit scoping, plus
a fresh full gate re-run to confirm nothing else regressed.

Per instructions, the ticket/proposal/design/tasks were not re-read from scratch; only the new
fold-in sections of `ticket.md`/`tasks.md`, `skeptic-design-4.md`, `files-modified.md`, and the
diff were read fresh.

### Phase 1: Spec Review — PASS

Issues: none.

- Task 6.1 (`tasks.md` §6) is marked `[x]` and matches exactly what was implemented: the added
  assertion `transport.toolRequests(1).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws }
  shouldBe empty` at `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala:543`, immediately
  between the pre-existing hop-0 (line 540) and hop-2 (line 545) assertions in the "drop the
  web_search tool from a later hop's outbound request once the cross-hop budget is exhausted" test.
- No AC silently reinterpreted: ticket.md's "Additional scope (fold-in, Delivery-phase triage)"
  section uses 0-based "hop 0 and hop 2" framing; the implementation correctly maps "hop 1" to
  `toolRequests(1)` (0-based array index), matching the ticket's own parallel construction and the
  design-gate skeptic's explicit ambiguity check (skeptic-design-4.md item 6) — not the file's
  pre-existing 1-based in-comment "Hop 1/Hop 3" prose, which is a separate, unrelated convention.
- No scope creep: `git diff 592a3ba1..92dfd07c --stat` shows exactly one production-adjacent
  file changed with real content — the test file (+3 lines) — plus the expected openspec
  change-dir docs (archive→active restore, `files-modified.md`, `skeptic-design-4.md`,
  `tasks.md`/`ticket.md` fold-in sections). Zero files under `backend/src/main/` touched.
- No regressions to existing behavior: full backend suite re-run fresh (below), 3318/3318 pass.
- API contracts/schemas: N/A — test-only change, no wire-shape or contract impact.
- Planning artifacts reflect final implemented behavior: `tasks.md` 6.1 and `ticket.md`'s fold-in
  section both accurately describe the shipped test change.

### Phase 2: Code Review — PASS

Issues: none.

Gates run fresh in `WORKTREE_PATH` (`EVALUATOR_CLEAN_WORKTREE` was `false`; no `CLEAN_WORKTREE`
gate re-run applicable):

- `cd backend && sbt test` — **3318/3318 tests passed**, 0 failed, 0 canceled (full suite,
  210 suites). Run completed in 3m13s.
- Targeted re-run: `sbt "testOnly com.helio.ai.ClaudeClientSpec"` — **32/32 tests passed**,
  including "should drop the web_search tool from a later hop's outbound request once the
  cross-hop budget is exhausted" (the tightened test).
- `npm run check:scala-quality` — clean (0 failures; 125 pre-existing informational soft-budget
  warnings, unrelated to this change — `ClaudeClientSpec.scala`'s size is a known, already-filed
  follow-up, HEL-762).
- `openspec validate assistant-web-research-tool --strict` — "Change 'assistant-web-research-tool'
  is valid" (re-run independently, not trusted from skeptic-design-4.md's own report).
- `npm run check:openspec` — flags "complete (21/21) but not archived", exactly as the executor's
  commit message described. Verified independently: this is the expected, deliberate state for a
  mid-fold-in-review unarchived change dir, not a defect. This is why the executor bypassed the
  pre-commit hook (`git commit -n`) for this one check only — correctly called out in the commit
  message per CONTRIBUTING.md's bypass-disclosure policy, and consistent with this ticket's own
  prior precedent (71d5abd5 implement / 592a3ba1 archive as separate commits).
- No frontend files changed (`git diff main...HEAD --name-only` — zero `frontend/**` paths), so
  `npm run lint`/`format:check`/`test`/`build` were not required by the Phase 2 trigger and were
  not run against this fold-in's own scope (already covered for the pre-existing full diff in
  `evaluation-2.md`).

Code-quality review of the 3-line diff itself
(`backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala:541-543`):

- Mirrors the exact existing style of the sibling hop-0/hop-2 assertions immediately above/below
  it (same `transport.toolRequests(n).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws }`
  pattern) — no new imports, no inline FQNs, no new abstractions.
- The new comment (lines 541-542) correctly explains *why* the assertion holds (hop 0's response
  already fired 2 searches, meeting `webSearchMaxUses = 2`), which is traceable against
  `ClaudeClient.scala`'s `toApiToolRequest` cumulative-budget logic — independently confirmed by
  the design-gate skeptic's trace (skeptic-design-4.md item 4) and consistent with this
  evaluator's own reading of the test setup (`config(webSearchMaxUses = 2)`, two searches per
  scripted hop response).
- Test is meaningful, not decorative: it closes a genuine gap where only the first (budget
  available) and third (budget clearly exhausted) hops were checked, leaving the middle hop —
  where the cutoff logic first takes effect — unverified. A regression that delayed suppression by
  one hop (e.g. an off-by-one in the cumulative-count comparison) would have passed the old test
  and now fails this one.
- Test-only, behavior-preserving: confirmed via `git diff 592a3ba1..92dfd07c` that no
  `backend/src/main/` file changed.

### Phase 3: UI Review — N/A

No UI-affecting files (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) were
touched by this fold-in increment (`git diff 592a3ba1..92dfd07c --stat`) — the change is confined
to a backend test file and openspec change-dir documentation. (The full-scope diff against `main`
does touch `openspec/specs/**`, but that content is pre-existing, already-shipped scope already
covered by Phase 3 of `evaluation-2.md`; this fold-in cycle adds nothing there.)

### Overall: PASS

### Non-blocking Suggestions

- None beyond what's already tracked: the file-size soft-budget flag on `ClaudeClientSpec.scala`
  is pre-existing and already has a dedicated follow-up ticket (HEL-762, filed during Delivery
  triage per ticket.md's "Related" section).
