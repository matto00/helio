# HEL-660: Claude tool-use loop primitive in ClaudeClient

## Description

`ClaudeClient` (HEL-390) today only does single send/stream — one prompt in, one response out, no tool use. HEL-659's bounded find-then-answer loop (see `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`) needs Claude to call tools mid-conversation and get results fed back, capped at a hard 3 hops.

## Scope

* Extend `ClaudeClient` with a `sendWithTools(history, tools, executor)`-shaped method: accepts a tool schema list and an executor callback, parses `tool_use` content blocks in Claude's response, invokes the executor, feeds the `tool_result` back, and loops.
* Hard cap at 3 hops — on the 4th `tool_use` attempt, terminate gracefully (return a "couldn't resolve this in the lookup budget" outcome) rather than looping indefinitely.
* No actual tools yet (that's the next ticket, HEL-661) — this ticket is the loop mechanics only, testable with a fake executor.
* Reuse existing guardrails (max input tokens, key handling) unchanged.

## Acceptance Criteria

- [ ] `ClaudeClient` can run a multi-turn tool-use loop against a fake transport with scripted `tool_use`/`tool_result` sequences, deterministic in tests (no real network calls).
- [ ] The loop hard-caps at 3 hops and terminates gracefully (not an exception, not an infinite loop) on a 4th `tool_use` attempt — asserted with the same "fake transport throws on the Nth call" fixture style as HEL-392's bounded self-repair test.
- [ ] Existing single-shot `send`/`stream` methods are unchanged and still pass their existing tests.

## Context / Notes

- Parent epic: HEL-659 (Top-Level Workspace Assistant). This is the first of 8 child tickets (HEL-660-667); delivery order is 660 → 661 → 662 → 663 → 664 → 665 → 666 → 667.
- Canonical reference: `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`, especially the "Architecture" section — the design spec frames the hard 3-hop cap as the *assistant's own* bounded-loop policy (owned by the future `AssistantService`/HEL-662), while `ClaudeClient` itself is meant to remain a reusable low-level primitive. Scope boundary for this ticket: the loop mechanics (parse `tool_use`, execute, feed `tool_result` back, loop) live in `ClaudeClient`; the hop cap should be a caller-supplied parameter/policy on `sendWithTools`, not a value hardcoded inside `ClaudeClient` — HEL-662 (`AssistantService`) is the caller that will actually supply `3`. This ticket's own tests still need to exercise and assert the hard-cap-at-3 behavior (per acceptance criteria), just via a caller-supplied argument rather than a `ClaudeClient`-internal constant.
- Testing philosophy: same deterministic-fixture approach as HEL-392's bounded self-repair test — fake transport, scripted `tool_use` sequences, no real network calls.
