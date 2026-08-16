# HEL-525: Memory & preferences management UI

## Description

Durable agent memory + preferences are only trustworthy if the user can SEE and CONTROL what is stored. This ticket adds the management surface: view/edit preferences (420-A) and view/delete/clear agent-memory entries (420-B). Without it, memory is an opaque black box — a non-starter for user trust and a prerequisite for the privacy controls in 420-E.

Follow the frontend design language (`DESIGN.md`) and the existing Redux-slice + service-layer + async-thunk pattern (e.g. `pipelinesSlice`, panel editors). Reuse shared UI components.

## Scope

- Frontend service + slice: a `preferences`/`agentMemory` service (axios) hitting `/api/preferences` and `/api/agent/memory`, with a Redux slice + `createAsyncThunk` calls (mirror `frontend/src/features/pipelines/state/pipelinesSlice.ts`).
- UI: a settings/profile section with (a) a preferences editor (default series colors, default panel style, naming conventions) and (b) an agent-memory list showing each entry's kind/content/last-used, with per-entry delete and a "clear all" action (confirm dialog). Use shared components and design tokens per `DESIGN.md`.
- Wire into the app's settings/navigation surface.
- Typed APIs; no `any` without justification; Jest tests for the slice + key components.

## Acceptance criteria

- [ ] A user can view and edit their preferences and see them persist across reloads.
- [ ] A user can view every stored agent-memory entry, delete individual entries, and clear all (with confirmation).
- [ ] UI follows `DESIGN.md` (tokens, spacing/type scale, shared components) and passes `npm run lint` (zero warnings) + `npm run format:check`.
- [ ] Redux slice + components covered by Jest tests; `npm test` passes.
- [ ] All network calls are typed; no unjustified `any`.

## Out of scope

- The privacy opt-out toggle + retention policy (420-E) — this ticket is view/edit/clear only.
- Feeding memory into the agent (420-C) — already done, HEL-521, merged.

## Dependencies

- Blocked by 420-A (HEL-472) and 420-B (HEL-478). Both merged.
