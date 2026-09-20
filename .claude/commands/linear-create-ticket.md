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

If potential duplicates are found:

- List them with their titles and URLs
- Ask: "I found a potentially related ticket — how would you like to proceed?"
  - **Proceed with new ticket**: create it and add `Related: [URL]` in the description
  - **Don't create**: stop and surface the existing ticket URL for reference

If no duplicates: proceed without asking.

### 3. Ask clarifying questions (max 3, only when necessary)

Ask a question **only if** the answer would materially change the ticket's scope, acceptance criteria, or priority — and the answer cannot be reasonably inferred from context.

**Do ask about:**

- Missing acceptance criteria when none can be inferred and the feature is ambiguous
- Priority when the description gives no signal (no urgency language, no "broken/can't use")
- Scope ambiguity that would produce meaningfully different tickets
- Origin, when the description reads like a spinoff ("found while working…", "noticed in…") but names no ticket — see step 3a

**Do NOT ask about:**

- Things clearly inferable from context
- Implementation details (that's for the planner)
- Technology choices
- Things the executor/planner will figure out

For a single clear ticket: ask **0 questions** and create it directly.

### 3a. Classify the origin (so the board can tell it from original scope)

Decide which of three the ticket is. Infer it from the description and from any ticket id it names (`HEL-N`); do not ask when it is clear.

- **Original work** — new work planned on its own merits. No origin, no label.
- **Follow-up** — a spinoff: a gap, defect or idea found while working ticket X that X's own acceptance criteria do not need. Origin ticket X is required.
- **Scope addition** — something an original-scope ticket _cannot be delivered without_ (a blocker found when checking a premise), or something the owner adds to an existing epic. Test: **would the origin ticket's own AC be unmeetable without it?** Yes → scope addition. No → follow-up.

This matters because `createdAt` alone cannot separate them, and a follow-up filed without a marker is invisible to anyone auditing the board later.

### 4. For epics: show breakdown and wait for confirmation

If the description is epic-scoped, break it down into logical tickets where each:

- Is independently deliverable
- Is achievable in one worktree session (one PR)
- Has a clear, distinct purpose

**Show the proposed breakdown to the user and wait for confirmation before creating anything:**

```
I'll create N tickets:
1. [Title] — [one-line rationale]
2. [Title] — [one-line rationale]
...

Shall I create these?
```

Only proceed to creation after the user confirms.

### 5. Create each ticket

For each ticket, create it in Linear with:

**Title** — action-oriented, ≤ 80 chars (e.g. "Add undo/redo for panel layout changes")

**Description** — include:

- Context: why this is needed
- What: what will change
- (For bugs) Observed behavior, expected behavior, steps to reproduce
- (If duplicate was found and user chose to proceed) `Related: [URL]`
- (**Follow-up only**) these two lines, verbatim, so provenance is queryable independently of any event log:

  ```
  origin_kind: followup
  origin_ticket: HEL-N
  ```

**Provenance and labels** — apply these on the **same** `mcp__linear__save_issue` call that creates the ticket, never as a step to remember afterwards:

- Follow-up → label `Follow-up`, and `relatedTo: ["HEL-N"]` for the origin ticket.
- Scope addition → label `Scope addition`, `parentId` set to the epic it extends, and `blocks` set for any original-scope ticket that cannot ship without it.
- Original work → no origin label.

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

**Team** — Helio Platform

### 6. Show results

After creating all tickets, **read each one back** (`mcp__linear__get_issue`) and confirm that any label the ticket should carry is actually on it — whether a label name that does not exist errors or is silently dropped depends on the tool, so do not assume.

Then display:

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
- [ ] A follow-up carries `origin_kind: followup`, `origin_ticket`, the `Follow-up` label and a `relatedTo` link; a scope addition carries the `Scope addition` label, a `parentId`, and any `blocks` — verified by reading the ticket back

---

## Guardrails

- For multi-ticket breakdowns: always show the plan and wait for confirmation — never silently create multiple tickets
- Never ask more than 3 clarifying questions total across all tickets
- For a clear, unambiguous single ticket: 0 questions, create immediately
- Infer priority and project from context rather than asking
- If the description is genuinely impossible to scope (no meaningful signal at all): ask one open-ended question — "Can you tell me more about what you're trying to achieve?"
