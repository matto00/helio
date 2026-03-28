Create one or more well-scoped Linear tickets from a free-form description.

---

## Input

The argument after `/linear-create-ticket` is a free-form description of a feature, bug, task, improvement, or initiative. If no argument is provided, ask the user what they want to create.

---

## Steps

### 1. Classify the scope

Determine whether the description is:

- **Single ticket** — clear, bounded, implementable in one worktree session
- **Epic / multi-ticket** — involves multiple independent deliverables, phases, or concerns that would be too large for one PR

Signals of epic scope: "system for...", "refactor all...", "phase 1/2/3", multiple unrelated features described together, estimated effort spanning multiple weeks.

### 2. Duplicate check

Search Linear for existing open tickets with similar titles or descriptions.

- If potential duplicates are found: list them with their titles and URLs, ask the user to confirm they want to proceed with creating a new ticket
- If no duplicates: proceed without asking

### 3. Ask clarifying questions (max 3, only when necessary)

Ask a question **only if** the answer would materially change the ticket's scope, acceptance criteria, or priority — and the answer cannot be reasonably inferred from context.

**Do ask about:**

- Missing acceptance criteria when none can be inferred and the feature is ambiguous
- Priority when the description gives no signal (no urgency language, no "broken/can't use")
- Scope ambiguity that would produce meaningfully different tickets

**Do NOT ask about:**

- Things clearly inferable from context
- Implementation details (that's for the planner)
- Technology choices
- Things the executor/planner will figure out

For a single clear ticket: ask **0 questions** and create it directly.

### 4. For epics: show breakdown before creating

If the description is epic-scoped, break it down into logical tickets where each:

- Is independently deliverable
- Is achievable in one worktree session (one PR)
- Has a clear, distinct purpose

**Show the proposed breakdown to the user before creating anything:**

```
I'll create N tickets:
1. [Title] — [one-line rationale]
2. [Title] — [one-line rationale]
...

Creating now...
```

Then create all tickets.

### 5. Create each ticket

For each ticket, create it in Linear with:

**Title** — action-oriented, ≤ 80 chars (e.g. "Add undo/redo for panel layout changes")

**Description** — include:

- Context: why this is needed
- What: what will change
- (For bugs) Observed behavior, expected behavior, steps to reproduce

**Acceptance criteria** — at least 2, each testable and specific:

```
## Acceptance criteria
- [ ] [specific, testable condition]
- [ ] [specific, testable condition]
```

**Priority** — infer from description:

- "broken", "can't use", "critical", "blocking", "urgent" → Urgent
- "should", "need to", "important" → High
- "would be nice", "improve", "enhance" → Medium
- "someday", "low priority", "minor" → Low
- Default when unclear → Medium

**Project** — assign based on description area:

- UI/frontend/visual/component → assign to current active frontend project
- API/backend/server/database → assign to current active backend project
- Use `mcp__linear__list_projects` to find the right project if needed

**Team** — Helio

### 6. Show results

After creating all tickets, display:

- Title and Linear URL for each ticket created
- Brief note if any decisions were inferred (e.g., "Set priority to Medium — no urgency signal in description")

---

## Acceptance criteria for each created ticket

Before creating, verify each ticket satisfies:

- [ ] Title is action-oriented and ≤ 80 chars
- [ ] Description explains the "what" and "why"
- [ ] At least 2 testable acceptance criteria present
- [ ] Priority is set (not None)
- [ ] Scope is achievable in one worktree session (for single tickets)
- [ ] Bug tickets include: observed behavior, expected behavior, reproduction steps
- [ ] Not a duplicate of an existing open ticket (or user confirmed)

---

## Guardrails

- For multi-ticket breakdowns: always show the plan before creating — never silently create multiple tickets
- Never ask more than 3 clarifying questions total across all tickets
- For a clear, unambiguous single ticket: 0 questions, create immediately
- Infer priority and project from context rather than asking
- If the description is genuinely impossible to scope (no meaningful signal at all): ask one open-ended question — "Can you tell me more about what you're trying to achieve?"
