## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: 26826981e84e783628809e87e2e0cebd4d7e77a8.
- Base: fef01cda9c089e90c2f93f65e1b59ee1f11d8a16, resolved live.
- Diff reviewed: b521e77d1..HEAD (the cycle-2 fix commit).

### Phase 1: Spec Review — FAIL

The cycle-1 change requests were addressed in code:
- **CR1 (code and test): fixed.** `AssistantSystemPrompt.scala:154-155` now states "up to 12 hops (tool-call round trips) per turn, and the turn stops after 3 failed tool calls". Both numbers are interpolated from `AssistantStopMessages.HopCeiling`/`FailureBudget`. `AssistantSystemPromptSpec` pins the interpolated text and asserts that "at most 4 hops" is absent. The design.md non-goal now carves out this line, per the orchestrator's ruling.
- **CR2: fixed.** `specs/chat-message-rendering/spec.md` MODIFIES the turn-signal requirement with the `stopReason` notes, "Couldn't finish in one go", and the `stopMessage` fallback bubble. The openspec parser picks it up.
- **CR3: fixed.** The HEL-1636 JSDoc sits on `isVisibleTextBlock` again.
- **Non-blocking items: done.**
  - `AssistantProtocol.scala:25` now says "hop ceiling (12)".
  - The panel comment now says "in one go".
  - A test was added for both untested wordings.
  - pr-notes.md proposes the file split.

One issue remains:
1. **The new system-prompt requirement is dropped when the change is parsed.**
   - Cause: `specs/assistant-conversation-loop/spec.md` now has two `## ADDED Requirements` headers, at line 50 and line 128. The new "The system prompt SHALL state the loop's real limits" requirement sits under the second one.
   - Effect: `openspec show assistant-failure-budget-loop --json --deltas-only` lists only two ADDED requirements for assistant-conversation-loop: "The tool loop stops on a failure budget or a hop ceiling" and "The conversation view shows the stop message". The system-prompt requirement is not among them (0 matches in the parsed JSON). Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.concertino/scratch/HEL-1637/eval2-deltas.json`.
   - Why it matters: archiving would silently leave the canonical spec without the requirement CR1 asked for.
   - Why the checks missed it: `openspec validate --strict`, `check:openspec` and `check:spec-structure` all pass, so they do not catch it.

### Phase 2: Code Review — PASS

Fresh gates, chosen for the scope of this diff:

| Gate | Scope | Result | Log |
| --- | --- | --- | --- |
| Backend `testOnly` | `services.assistant`, `services.workspace` (reads `AssistantSystemPrompt.text`), `infrastructure.ai`, `api.routes.assistant` (sizes messages against the prompt), `services.ask`, `eval`, `services.insights` | 611 / 611 passed; both new tests confirmed executed; no compile warnings | `.concertino/scratch/HEL-1637/eval2-shard.txt` |
| `npm run lint` | whole repo | clean | |
| `npm run format:check` | whole repo | clean | |
| `npm run typecheck` | frontend | clean | |
| Frontend jest | `features/assistant` | 16 suites / 149 tests passed | |
| `npm --prefix frontend run build` | frontend | OK | |
| `check:schemas`, `check:spec-structure`, `check:openspec`, `check:scala-quality` | repo checks | all pass | |

The full backend suite passed in cycle 1 (10173 tests). This diff touches only the prompt string, two test files, one doc comment and frontend comments, so no wider re-run was needed.

Code notes:
- The prompt interpolation reads the same constants the loop uses, so the prompt and the code cannot drift.
- The new wording test asserts the exact `startWith` text for both the propose wording and the read wording.

### Phase 3: UI Review — PASS

The frontend diff since cycle 1 only moves a JSDoc and edits a comment; nothing that renders changed. Cycle 1's live UI pass still covers this code. Its evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.concertino/scratch/HEL-1637/`:
- `eval-ui-failure-budget.png`
- `eval-ui-hop-ceiling.png`
- `eval-ui-input-budget-1440.png`

The assistant jest suite and the production build were re-run fresh for this cycle.

### Overall: FAIL

### Change Requests
1. In `openspec/changes/assistant-failure-budget-loop/specs/assistant-conversation-loop/spec.md`:
   - Delete the second `## ADDED Requirements` header (line 128).
   - Move "### Requirement: The system prompt SHALL state the loop's real limits" and its scenario into the first ADDED section, which starts at line 50 (for example, right after "The conversation view shows the stop message").
   - Verify that `openspec show assistant-failure-budget-loop --json --deltas-only` lists three ADDED requirements for assistant-conversation-loop, including the system-prompt one.

### Non-blocking Suggestions
- none
