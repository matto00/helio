---
name: linear-ticket-delivery
description: Execute a Helio Linear ticket from branch creation through proposal, implementation, verification, archive, and pull request. Use when the user wants to work a Linear issue end-to-end in this repo.
license: MIT
metadata:
  author: helio
  version: "1.0"
---

# Linear Ticket Delivery

Use this skill when implementing a Linear ticket in the `helio` repository.

This workflow is mandatory for ticket-driven work in this repo.

## Required Principles

- Always read the Linear ticket first and extract requirements, acceptance criteria, and unknowns.
- Always ask clarifying questions before making assumptions.
- Keep code clean, modular, DRY, reliable, and aligned with repo rules.
- Follow existing code style, formatting, architecture boundaries, and performance-first conventions.
- Never skip approval gates.
- Always update relevant artifacts, documentation, and specs when changes affect them.
- Always verify behavior with tests and, when relevant, Playwright-based UI checks.

## Branching Rules

Before implementation, create a new branch from `master` or `main` using:

`[feature|task|bug]/[3-5-word-description]/[ticket-id]`

Examples:

- `feature/implement-akka-routes/HEL-6`
- `task/add-jest-coverage/HEL-5`
- `bug/fix-panel-loading/HEL-12`

### Prefix Selection

- Use `feature/` for net-new user-facing or API behavior.
- Use `task/` for tests, tooling, refactors, docs, infra, or maintenance work.
- Use `bug/` for fixes to broken or regressed behavior.

## End-to-End Workflow

### 1. Read the Linear ticket

- Read the issue title, description, comments, and current status.
- Extract:
  - requirements
  - acceptance criteria
  - constraints
  - open questions
- If the ticket is underspecified, ask clarifying questions before doing anything else.

### 2. Choose the OpenSpec entry path

Choose exactly one:

- Use `opsx-propose` for straightforward implementation work with enough clarity to draft proposal/design/tasks.
- Use `opsx-explore` for bugs, risky work, unclear requirements, architecture investigation, or any ticket that needs discovery before proposing implementation.

Do not implement directly before this step.

### 3. Create the branch

- Determine the correct base branch: prefer `master`, otherwise use `main`.
- Create and check out the branch before drafting or implementing changes.
- Keep all ticket work on that branch.

### 4. Draft proposal and design artifacts

- Use the selected OpenSpec workflow to create proposal/design/tasks artifacts.
- Ensure artifacts reflect the Linear issue scope and acceptance criteria.
- Update the Linear ticket with a progress comment linking the planned approach.

### 5. Explicit approval gate

Do not implement until the human explicitly approves the proposal and design.

If approval is not granted:

- stop implementation
- answer questions
- revise artifacts
- request approval again

### 6. Execute tasks

After approval:

- implement tasks in order
- keep changes small, modular, and reviewable
- update tasks as work is completed
- update any relevant artifacts as implementation reveals new requirements or design changes

### 7. Keep artifacts synchronized

Always update related materials when relevant, including:

- OpenSpec proposal/design/tasks/specs
- JSON schemas
- API contracts
- docs and runbooks
- `CONTRIBUTING.md`
- Cursor rules or skills when workflow/policy changes

### 8. Verification requirements

Run the required project gates for impacted areas.

#### Always required

- repo lint
- format check
- relevant tests

#### Frontend changes

- `npm run lint`
- `npm run format:check`
- `npm test`
- `npm run build` in `frontend/`

#### Backend changes

- `sbt test` in `backend/`

#### UI changes

- Use Playwright MCP when the change affects user-facing behavior or regression risk is visual/interactive.
- Verify the feature works and that the changed flow is non-breaking.

### 9. Human sign-off gate

Before archiving or opening the PR:

- summarize the implemented behavior
- summarize verification performed
- request human sign-off

Do not archive until sign-off is received.

### 10. Archive the OpenSpec change

After tasks are complete, tests pass, and human sign-off is received:

- use `opsx-archive`
- do not skip archive for completed ticket work

### 11. Create the pull request

Create the PR from the ticket branch after verification and archive.

PR must include:

- the Linear issue link
- summary of behavioral changes
- test plan
- risks, limitations, or follow-up notes

### 12. Update Linear throughout the lifecycle

Update the ticket status and comments at meaningful milestones:

- when investigation/proposal starts
- when approval is requested
- when implementation starts
- when blockers are discovered
- when verification is complete
- when PR is created

Include the PR URL in the ticket comments once available.

## Blocker Handling

If the ticket is blocked:

- comment on the Linear issue with the blocker and what is needed
- move it to a blocked state if such a state exists
- stop and ask the human how to proceed

Do not guess through blockers.

## Git Safety Rules

- Never force push unless explicitly requested.
- Never amend commits unless explicitly requested.
- Never revert unrelated user changes.
- Never make destructive git changes without explicit approval.
- Keep commits scoped to the ticket.

## Completion Criteria

The workflow is complete only when all of the following are true:

- branch created from `master` or `main`
- Linear ticket reviewed and clarified
- OpenSpec proposal/design/tasks created through `opsx-propose` or `opsx-explore`
- human approval received before implementation
- implementation completed cleanly
- relevant artifacts updated
- required verification passed
- human sign-off received
- OpenSpec change archived with `opsx-archive`
- branch pushed
- PR created
- Linear status/comments updated with progress and PR link

## Guardrails

- Do not skip clarifying questions.
- Do not skip approval gates.
- Do not skip tests.
- Do not skip Playwright checks for UI-sensitive work when they are relevant.
- Do not skip artifact updates when the change affects contracts, specs, or workflow.
- Do not treat “it compiles” as sufficient verification.
