## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 2a9f9e4677f7019f5f6a36c4f72e5146cf25df85 (branch bug/mcp-context-unhandled-rejection/HEL-1617). cwd guard: READY.

### What I verified (with evidence)

- **Bug premise, from live code.** `helio-mcp/src/context.ts:504-506` creates `outputsByPipelinePromise = fetchAllOutputs(api).then(...)`
  before the fail-fast `Promise.all` at :508-513 and awaits it only at :515. `fetchAllOutputs` (:170-182) has no catch.
  `index.ts` has only `main().catch`, with no `unhandledRejection` handler. The comment at :500-503 claims the Outputs fetch
  "degrades only the outputs field", which is false. Both premises hold.
- **No other orphan in the same path.** `agentContextPromise` and `connectorsPromise` are self-caught (comments plus
  `buildAgentContext`/`buildConnectors`). `fetchPlacements` (:187-205) and `createPanelControlsLookup` (`contextControls.ts`)
  catch internally. `Promise.all` attaches handlers to every member. So Decision 1 (self-catch at creation) closes the only
  unobserved promise, and the plan is complete for this path.
- **AC1's structured error already exists.** `tools/read.ts:25-35` `guarded()` maps the `HelioApiError` subclass
  `HelioRateLimitError` to `isError` with text `HelioRateLimitError (status 429) for <url>: ...`. `httpClient.ts:304-309`
  throws immediately when the Retry-After does not fit the remaining budget. A 429 with `Retry-After: 59` therefore
  rejects at once, so the seam test is deterministic.
- **Decision 2 survives budget and concise mode.** `applyBudget` (:312-331) spreads `...context`, so a new top-level
  optional field passes through unchanged. Concise mode only projects steps and sources. The claim holds.
- **Contract surface.** `schemas/workspace/workspace-context.schema.json` (additionalProperties false) is the BACKEND
  `/api/workspace/context` contract: it has `dataTypes`/`joinHints`, which the MCP payload lacks, and it is used by
  `WorkspaceContextServiceSpec.scala`. It does not govern helio-mcp's client-side payload, so no schema delta is needed. The
  MCP shape is documented in `helio-mcp/README.md` ("Context serializer", ~:221), which task 3.2 covers. No existing spec
  requirement conflicts with the new delta (grep of `openspec/specs/*` for outputs degradation found nothing).
- **AC coverage.** AC1 maps to D1 + D4 / tasks 1.1, 2.1, 3.1. AC2 maps to D2 / task 2.2. AC3 maps to D4 / tasks 1.1, 1.2, 3.1.
  AC4 maps to D3 / task 2.3. The related bullets are assessed in the design and recorded. HEL-1524 gets a README note (D5),
  and volume reduction is a non-goal. No scope drift and no placeholders.
- **Jest behaviour probe (D4's open question), run myself.** Scratch probe
  `.concertino/scratch/HEL-1617/skeptic-probe/unh.test.js` (root jest 30.1.3, node env) created an orphaned rejected promise
  with a `process.on("unhandledRejection")` listener installed. Jest FAILED the test on its own (the "orphan" error is
  attributed to the test), and the listener saw **0** events (`SEEN 0`). See the notes below for what this means.

### Verdict: CONFIRM

### Non-blocking notes

1. **The listener assertion is vacuous under jest 30 (probe above).** A `process.on("unhandledRejection")` listener inside
   a jest test does not receive the event, so `expect(seen).toHaveLength(0)` would pass on the unfixed code too. The red
   for task 1.1 instead comes from jest failing the test when the orphan rejects. The executor must record that actual red
   (the failure text naming `HelioRateLimitError`) and must not present a listener assertion as the proof. Write D4's
   "verify jest's environment actually delivers the event" outcome down in the evidence.
2. **AC3 wants a durable regression test, not only a scratch script.** If the subprocess reproduction (task 1.2) is the
   only red that demonstrates the *process exit*, it should preferably be a committed test that spawns `node` (via `tsx`,
   present in `helio-mcp/node_modules/.bin`). A scratch script alone cannot catch a reintroduction. The jest seam test
   (note 1) does count as a durable red/green test, so this is a preference, not a requirement.
3. The seam test does not need fake timers. With `Retry-After` beyond the 30s budget, `httpClient.ts:307-309` throws
   synchronously on the first 429. Fake timers are harmless if kept.
4. The `workspace-context` resource (`server.ts:92`) also benefits from D1. With D1, a core 429 there still fails the
   resource read with a JSON-RPC error, which is expected. The spec wording "surfaced as an `isError` tool result" applies
   to the tool only, and the executor should not try to make the resource return `isError`.
5. D3's injectable `installUnhandledRejectionGuard(proc, write)` is the right shape: test it with a fake EventEmitter,
   not the real `process`, for the same reason as note 1.
