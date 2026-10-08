# HEL-1349: helio-mcp: MAX_BACKOFF_MS (60s) equals the MCP request timeout — a 429 near 60s Retry-After becomes a tool timeout

## Description

origin_kind: followup
origin_ticket: HEL-1297

`helio-mcp/src/httpClient.ts:65` sets `MAX_BACKOFF_MS = 60_000`, which equals the MCP SDK's request timeout. When the backend returns 429 with a `Retry-After` close to 60 s, the client waits that long and the tool call fails with `-32001` (timeout) rather than a clear rate-limit error. Plain `npm run verify` and real MCP clients are exposed to this. HEL-1297's `verify:isolated` mode lifts the rate limits, which hides it there.

## Acceptance Criteria

- Keep backoff comfortably below the SDK timeout, or return a structured rate-limit error (with the retry-after) when the wait would exceed it.
- Add a test with a mocked 429 and a long `Retry-After` that is red before the fix.
- Check this against the SDK version after HEL-1348 (>=1.31.0), whose timeout may differ.

## Also from HEL-1297 (low priority, listed outside the Acceptance block)

- A signal arriving during `createdb` can leave that database behind unreported (`isolatedRun.ts` ~:169).
- SIGKILL on the tsx wrapper can orphan the node child.
- The harness PID is signalled even after a normal exit, so a reused PID could be hit.
- The README doesn't mention the backend log in the work directory.
- design.md D3 still says JVM options are "exported from sbt verbatim".

Orchestrator scoping note: these five `verify:isolated` hardening items are NOT part of this change (see proposal.md Non-scope); they are handed back to the driver as a follow-up to file.

## Premise findings (orchestrator, verified against the live tree 2026-10-08)

- `MAX_BACKOFF_MS = 60_000` at httpClient.ts:65 is a per-wait clamp; `MAX_RATE_LIMIT_RETRIES = 5`, so cumulative wait per request can reach ~300 s. Even modest Retry-After values (15 s x 5) blow a 60 s client timeout — the ticket understates the exposure.
- Installed SDK is 1.31.0; `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` (sdk dist/esm/shared/protocol.js). This is the default of the *calling* MCP client (TS-SDK clients incl. `scripts/verify.ts`); other clients may configure differently.
- The backend's pipeline-run guard (HEL-505) answers 429 with `Retry-After` up to the 60 s window, so a near-60 s Retry-After is a realistic input, not a hypothetical.
