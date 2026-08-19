## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Ground truth for the premise.** Read
   `frontend/src/features/assistant/ui/ToolCallIndicator.tsx` directly. `VERB_BY_TOOL_NAME`
   (lines 24-31) has exactly 6 entries (`find`, `get_resource`, `propose_dashboard`,
   `propose_pipeline`, `propose_combined`, `propose_patch_set`) and no `test_connection` entry;
   `verbFor` (line 33-35) falls back to `"Calling"` for any unmapped name. This matches the
   ticket's claim exactly.

2. **`test_connection` is a real, shipped tool** (not speculative). `git log --all --oneline
   --grep="HEL-756"` shows `9f76fda6 HEL-756 Add test_connection tool + structural
   verify-before-propose gate (#396)` merged to main, and `grep -rl test_connection backend/src`
   found it wired through `AssistantProtocol.scala`, `AssistantProposalToolSchemas.scala`,
   `AssistantService.scala`, `AssistantToolExecutor.scala`, `AssistantSystemPrompt.scala` plus
   specs. It reaches the frontend purely as a string `name` on `ClaudeToolUseBlockDto` (no
   frontend-side constant to grep for), which is why `grep -r test_connection frontend/src`
   returns nothing — expected, not a gap in the plan.

3. **Ticket ↔ Linear parity.** Fetched HEL-759 via `mcp__linear__get_issue`; description, Fix, and
   Acceptance Criteria are verbatim identical to `ticket.md`.

4. **Spec delta correctness.** Read
   `openspec/specs/chat-message-rendering/spec.md` (the current, non-delta capability spec) and
   diffed it against the change's `specs/chat-message-rendering/spec.md` delta by hand. The
   delta's `### Requirement: Each tool call in the transcript is individually visible` preserves
   the base requirement text and all 3 existing scenarios verbatim, appending one new sentence
   ("Every tool the assistant can call SHALL have a tool-specific verb...") and one new scenario
   ("A test_connection call renders with a tool-specific verb"). No existing scenario altered or
   dropped. The delta correctly targets an existing requirement under an existing capability
   (`chat-message-rendering` genuinely exists at that path) with `## MODIFIED Requirements`,
   matching the convention used by the most recent precedent
   (`openspec/changes/archive/2026-08-19-assistant-connection-test-tool/.../spec.md`, which uses
   the same `## MODIFIED Requirements` header style for an analogous small addition).

5. **Task/test-plan fit.** Read
   `frontend/src/features/assistant/ui/ToolCallIndicator.test.tsx` — the existing test file
   defines a `findToolUse` const and asserts on the rendered label text
   (`'Searching: find(query: "revenue")'`). `tasks.md` item 2.1 ("assert a `test_connection`
   tool_use renders the 'Verifying connection' verb, not the generic 'Calling' fallback") is a
   trivial, unambiguous extension of that exact pattern — no new test infrastructure needed.

6. **No placeholders / hand-waving.** `grep -rniE "TODO|TBD|figure out|TKTK|placeholder"` across
   the change directory returned nothing.

7. **Scope check.** `design.md`'s Non-Goals ("no change to `verbFor`'s fallback behavior, to any
   other tool's verb, or to the `test_connection` tool itself") and `proposal.md`'s Impact/
   Non-goals sections bound the change to exactly the one map entry `tasks.md` describes. Both
   ACs trace 1:1 to the two tasks (AC1 → task 1.1 code change; AC2 → task 2.1 test). Nothing in
   the ticket's acceptance criteria is left uncovered, and nothing in the plan reaches beyond the
   ticket (no touching `compactInput`/`summarizeResult`, no backend changes, no schema/contract
   changes — correctly, since this is a pure frontend label lookup with no wire-format
   implications).

8. **Self-approval justification.** `design.md`'s "Planner Notes" self-approves escalation on the
   grounds this is a single-line, non-architectural UI-label addition. That's an accurate
   characterization given the diff surface confirmed above (one map entry + one test).

### Verdict: CONFIRM

The plan is accurate (premise verified against the real source file and the real merged HEL-756
commit), internally consistent (proposal/design/tasks/AC all agree), correctly scoped (AC ↔ task
1:1, no drift), and the spec delta is a clean, non-destructive `MODIFIED Requirements` addition to
the correct existing capability, following established repo convention. No placeholders,
contradictions, or ambiguity found.

### Non-blocking notes

- None substantive. The design doc's risk section already correctly identifies "verb wording
  bikeshed" as the only conceivable risk and dismisses it by citing the ticket's own suggested
  phrasing — I have no objection to "Verifying connection" as the chosen verb.

### Environment note (not a verdict blocker)

This worktree's `scripts/concertino/` is missing `next-report-number.sh` / `persist-evidence.sh`
/ `emit-event.sh` (they exist in the main checkout at `/home/matt/Development/helio/scripts/
concertino/` but are gitignored/generated, and this worktree predates their addition to that
generated set). I confirmed `assert-phase.sh` is byte-identical between the main checkout and this
worktree, and `next-report-number.sh` is a pure function of its `<change-dir>` argument with no
cwd dependency, so I invoked it via its absolute path in the main checkout against this worktree's
change directory to get a correct, collision-safe filename. I will do the same for
`persist-evidence.sh` and `emit-event.sh` below.
