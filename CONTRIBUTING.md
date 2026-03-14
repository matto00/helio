# Contributing

This repository uses a performance-first engineering approach for a customizable dashboard application.

## Core Stack

- Frontend: React + TypeScript + Redux
- Backend: Scala + Akka
- Frontend tooling: npm, ESLint, Prettier, Jest
- Backend testing: ScalaTest
- API contracts: JSON Schema

## Non-Negotiables

These are hard rules for all contributions:

- Optimize for performance by default.
- Keep code modular and reusable.
- Import classes/types when needed; do not use full qualifiers in normal code.
- Follow project formatting and style rules (no ad-hoc styles).
- Do not make large assumptions about architecture or requirements without asking first.

## Development Rules

### 1) Code Quality and Style

- All TypeScript and Scala code must pass linting and formatting checks before commit.
- Prefer small, composable modules over large files/functions.
- Keep naming explicit and domain-oriented (`dashboard`, `panel`, `layout`, `widget`, etc.).
- Avoid duplicate logic. Extract shared behavior into reusable modules.
- Use strict typing in frontend code; avoid `any` unless there is a documented reason.

### 2) Frontend (React + TypeScript + Redux)

- Keep UI components focused on presentation; move business logic to hooks/selectors/services.
- Use Redux for app-level state. Keep local component state local.
- Use memoized selectors for derived state where needed.
- Minimize unnecessary renders (stable props, memoization where it measurably helps).
- Keep component tests in Jest focused on behavior, not implementation details.

### 3) Backend (Scala + Akka)

- Keep actor and service boundaries clear and minimal.
- Prefer explicit message protocols and typed interfaces.
- Do not block actor threads with long-running synchronous operations.
- Isolate infrastructure concerns (IO, external clients) behind reusable interfaces.
- Write ScalaTest coverage for core domain and service logic.

### 4) API Contracts (JSON Schema)

- Define request/response payloads with JSON Schema.
- Keep schemas versioned in-repo and update them in the same change as code.
- Validate inputs at service boundaries.
- Ensure frontend and backend remain schema-aligned.

### 5) Security Guidelines

- Validate and sanitize all untrusted input.
- Enforce authentication/authorization checks at backend boundaries.
- Never commit secrets, tokens, or credentials.
- Use least-privilege access patterns for services and data access.
- Avoid leaking sensitive data in logs and error messages.

### 6) Testing Requirements

- Frontend: Jest tests required for changed components, hooks, selectors, and reducers.
- Backend: ScalaTest required for changed domain/service behavior.
- New features should include tests for success and failure paths.
- Bug fixes should include a regression test when practical.

## Pre-Commit Policy

Pre-commit checks must run and block commits on failure.

Required checks:

- `npm run lint`
- `npm run format` (or `npm run format:check` if configured)
- `npm test`

Bypass policy:

- `git commit -n` (no-verify) is available for emergencies only.
- Any bypassed checks must be fixed immediately in the next commit.

## Pull Request Expectations

- Keep PRs focused and reasonably sized.
- Describe behavior changes and testing performed.
- Flag security-sensitive or performance-sensitive changes explicitly.
- If requirements are unclear, ask questions before implementation.

## Out of Scope for Now

- Database specification rules (to be decided later).
- WebSocket/real-time rules (not in scope yet).
- CI/CD policy (not defined yet).
- Backward-compatibility policy for saved dashboard configs (not required yet).
