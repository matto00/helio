## Context

Verified on main 2a9f9e467 (see `.concertino/runs/HEL-1617/evidence/premise-validation.md`):
`helio-mcp/src/context.ts:504` starts `outputsByPipelinePromise = fetchAllOutputs(api).then(...)`, the fail-fast
`Promise.all` follows at :508, and the promise is awaited only at :515. `fetchAllOutputs` (:170) has no catch; there is
no `unhandledRejection` handler in `helio-mcp/src`. Node v22.23.2 (local) exits 1 on an unhandled rejection
(`node -e 'Promise.reject(new Error("x")); setTimeout(...)'`). Note the crash does not need the `Promise.all` to reject:
Node flags a rejection unhandled once the microtask queue drains, so an Outputs 429 that settles while the
`Promise.all` is still pending also kills the process, even though line 515 would attach a handler later.

The sibling concurrently-started sections already follow a "self-catch, degrade" pattern (`buildAgentContext`,
`buildConnectors`, `fetchPlacements`, per-pipeline `stepsError`).

## Goals / Non-Goals

**Goals:** no unobserved rejection in the context build; Outputs failure degrades with a signal; a process-level safety
net; a red-first reproduction recorded as evidence. **Non-Goals:** see proposal.md.

## Decisions

1. **Self-catch the Outputs promise at creation.** `outputsByPipelinePromise` becomes
   `fetchAllOutputs(api).then(build...).then(map => ({ map }), err => ({ map: new Map(), error: message }))` (or an
   equivalent named helper), so the promise can never reject and is always observed regardless of what the
   `Promise.all` does. Rejected alternative: moving the outputs fetch into the `Promise.all` / `allSettled` — fixes the
   orphan but either keeps "Outputs failure fails the call" (contradicting the documented contract) or restructures
   more than needed.
2. **Signal the degradation: optional top-level `outputsError?: string`.** Silent `[]` would let an agent conclude a
   pipeline has no Outputs and create duplicates. Mirrors `stepsError`. Omitted on success, so the success payload is
   byte-identical to today. Must survive `applyBudget` and concise mode unchanged. Error text: the error's `message`
   (the `HelioRateLimitError` message already names the rate limit and retry-after).
3. **Safety net in `index.ts` `main()`, via a small exported installer** (e.g. `installUnhandledRejectionGuard(proc,
   write)` in its own module) so it is unit-testable without `index.ts`'s direct-invocation guard. Logs
   `helio-mcp: unhandled rejection: <msg>` truncated to 500 chars (same bound as the transport-error log), to stderr
   only (stdout is the JSON-RPC stream). Does NOT handle `uncaughtException` (synchronous throws may leave state
   inconsistent; out of scope). It is a backstop, not the fix — Decision 1 must hold on its own, and the tests must
   prove the fix without the guard installed.
4. **Red-first test shape.** A seam test like `rateLimitSeam.test.ts`: real MCP `Client` over `InMemoryTransport`,
   real `HelioHttpClient` with a stub `fetchImpl` answering 429 (Retry-After beyond the budget) for data-sources and
   outputs-list URLs, OK for others as needed; fake timers. Assert `isError` + rate-limit text, and that no
   `unhandledRejection` fired (listener on `process`, verify jest's environment actually delivers the event — if it
   does not, the red must come from a subprocess run). Also a direct subprocess reproduction (node 22 + tsx, a tiny
   script under the run's scratch dir or the test itself spawning `node`) showing exit 1 on unfixed code and exit 0
   on the fix; both transcripts persisted as evidence. Plus a unit test for Decision 2 (outputs-only failure →
   `outputsError`, all `outputs: []`) and Decision 3 (installer logs and does not exit).
5. **HEL-1524 note.** No CHANGELOG exists; release notes are written at `/release` time from commits. Add a short
   "Contract changes" note to `helio-mcp/README.md` stating that `update_dashboard_layout` requires
   `expectedLayoutVersion` since HEL-1524 and that older callers omitting it get a validation error.

## Findings on related bullets (recorded, not fixed here)

- **Request volume.** Per call: 8 fixed requests (4 core, 2 agent-context, 1 connectors, >=1 outputs page), plus 3
  per pipeline (`analyzePipeline`, `getPipelineRunHistory`, `getPipeline`), plus 1 per Output (`listOutputPanels`),
  plus 1 per distinct dashboard snapshot for controls. All fan-outs are unbounded `Promise.all`. A 55-pipeline
  workspace is >= 173 requests before Outputs, above the 120/60s default budget. Candidate follow-up: bounded
  concurrency and/or fewer per-pipeline calls. Not fixed here (non-goal).
- **HEL-1524.** README already documents the requirement (`helio-mcp/README.md:181`); the gap is a discoverable
  contract-change note, addressed by Decision 5.

## Risks / Trade-offs

- A new optional field in the context payload: additive, absent on the success path.
- The safety net could mask future bugs; mitigated by logging every occurrence and by Decision 1 being tested
  without it.
