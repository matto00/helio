# Contributing to Helio

Thanks for your interest in contributing. This document covers how to get set up, the standards we hold code to, and what to expect from the review process.

## Getting Started

See the [README](README.md) for prerequisites and instructions on running the frontend and backend locally.

Before starting work on anything non-trivial, open an issue or comment on an existing one so we can align on approach before you invest time in implementation.

## Workflow

1. Fork the repo and create a branch: `[feature|task|bug]/short-description`
2. Make your changes, keeping commits focused and descriptive
3. Ensure all pre-commit checks pass (see below)
4. Open a pull request against `main` and fill out the PR template

## Code Standards

### General

- Optimize for readability and performance — they're usually not in conflict
- Keep changes focused; avoid unrelated refactors in the same PR
- Prefer small, composable units over large files or functions
- Never commit secrets, credentials, or `.env` files

### Frontend (React / TypeScript / Redux)

- Use Redux for shared app state; keep components primarily presentational
- Move reusable behavior into hooks, selectors, or utilities
- Avoid `any` — use proper types or `unknown` with narrowing
- Write Jest tests for components, hooks, selectors, and reducers
- Test behavior, not implementation details

### Backend (Scala / Akka HTTP)

- Keep actor and service boundaries explicit
- Never block actor threads with synchronous I/O
- Isolate infrastructure concerns behind reusable interfaces
- Write ScalaTest coverage for domain and service logic

### API Contracts

- Define request/response shapes in `schemas/` (JSON Schema 2020-12)
- Keep schema changes in the same PR as the code that uses them
- Validate all inputs at service boundaries

## Pre-Commit Policy

Husky runs the following automatically on every commit — fix failures before pushing:

```bash
npm run lint          # ESLint (zero-warnings)
npm run format:check  # Prettier
npm test              # Jest + Scala tests
```

`git commit -n` (skip hooks) is available for emergencies only. Any bypassed checks must be fixed in the next commit.

## Pull Request Expectations

- Keep PRs reasonably scoped — one concern per PR
- Describe what changed and how you tested it (the PR template will prompt you)
- Flag anything security-sensitive or performance-sensitive explicitly
- Expect review feedback within a few days; address comments or push back with reasoning

## Reporting Issues

Use the GitHub issue templates for bugs and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please read it before participating.
