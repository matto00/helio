## Context

See proposal.md — Why. `helio-mcp/scripts/verify.ts` spawns the BUILT server (`../dist/index.js`, resolved
relative to the script, so a worktree run uses the worktree's own `dist`) with the real SDK client over stdio. It
calls exactly two write tools: `create_pipeline` (stale `source:` shape; the tool's zod `inputSchema` in
`src/tools/pipelines.ts` now requires `roots: z.array(createPipelineRootSchema).min(1)`) and `add_outputs_from_shape`
(`pipelineId/shapeId/params/outputName` — still current; two of its three calls are deliberate failures). It mints no
PAT and deletes nothing: each run leaves a pipeline, an inline static source and an Output in the shared dev DB.
`src/server.test.ts` already drives the real server in-process via `InMemoryTransport` with a stub `HelioApi`.
helio-mcp tests are collected by the root `jest.config.cjs` (helio-mcp has no `test` script); `scripts/**/*.ts` is
type-checked by `tsconfig.typecheck.json`, while `tsconfig.json` (build, `rootDir: src`) excludes `scripts/`.
`/api/tokens` (`ApiTokenRoutes`) accepts session OR PAT auth: POST mints (raw token only in the response), DELETE
`/api/tokens/:id` revokes.

## Goals / Non-Goals

**Goals:** verify green end-to-end on the current schemas; zero residue per run (exact ids); a drift guard that goes
red on exactly the HEL-913 class of break; helio-mcp under Dependabot with the repo's grouping guard satisfied.

**Non-Goals:** backend changes; new dependencies; touching the main checkout's `helio-mcp/dist`.

## Decisions

**D1 — Pure payload builders in `helio-mcp/scripts/verifyPayloads.ts`.** verify.ts imports
`buildCreatePipelineArgs(runId)` / `buildAddOutputsFromShapeArgs(...)` etc. — one builder per write-tool call, no I/O.
The drift guard imports the SAME builders, so the test and the script cannot disagree. Alternative (inline literals
duplicated into a test) rejected: duplication is exactly how the script drifted.

**D2 — Drift guard binds to the live tool input schema, not `schemas/`.** A Jest test (`helio-mcp/scripts/
verifyPayloads.test.ts`, collected by the root config) builds the real server via `createServer(stubApi)`, connects an
in-process `Client` over `InMemoryTransport`, and for EVERY builder calls the named tool, asserting the result is not
an input-validation rejection (the SDK reports these as an error containing the zod issue, e.g. `roots: Required`).
The stub records which `HelioApi` method each call reached, and the test asserts the handler was actually reached —
proof the payload passed validation rather than failing for another reason. The stub returns plausible shapes for each
handler path; the assertion is on the recorded api method, not on `isError` alone. It also asserts the set of tool names
verify.ts calls (parsed from verify.ts source by regex on `name: "<tool>"`) equals the builder set, so a new write
call added to verify without a builder fails. `schemas/` is the HTTP request layer: MCP inputs use `config` where the
HTTP body uses `staticConfig`, so validating verify's payloads against `schemas/` would check the wrong contract (the
handler-to-HTTP seam is the handler's own tests' concern). Mutation proof required: revert `roots` → `source` in the
builder and show the guard red with the zod message.

**D3 — verify mints and revokes its own PAT.** `HELIO_PAT` stays the bootstrap credential (unchanged UX). verify
POSTs `/api/tokens` with a run-tagged name (`HEL-1264 verify <runId>`), spawns the server with the MINTED token, and
sets `expiresInDays: 1` (`CreateApiTokenRequest(name, expiresInDays, scopedPipelineIds)`) as a crash backstop,
and in `finally` DELETEs `/api/tokens/<id>` by the exact id from the create response, then confirms the minted token now
gets 401 on a cheap authenticated GET. The raw minted token is never printed. Request shape read from
`CreateApiTokenRequest` (backend protocols), not guessed.

**D4 — Exact-id fixture ledger, cleaned in `finally`.** Every id verify creates is pushed to a ledger as soon as it
is known: the pipeline id (create response), each inline root's source id (from the created pipeline's `roots`),
Outputs (deleted with their pipeline — verify confirms rather than assumes). Teardown order: pipeline first (HEL-989:
a source with a rooting pipeline cannot be deleted), then sources, then the PAT last (teardown needs auth). Each
delete is followed by a GET expecting 404. Teardown errors are collected and reported; a failed teardown makes the run
exit non-zero even if the checks passed. Deletion uses direct HTTP with the bootstrap credential (no dependency on the
MCP server still being alive). Fixture names carry the runId so any residue is attributable.

**D5 — Dependabot entry.** New `npm` / `"/helio-mcp"` block mirroring `/`: weekly, `open-pull-requests-limit: 10`,
`labels: ["dependencies"]`. Groups: `mcp-sdk` (patterns `@modelcontextprotocol/sdk`, `zod` — exact names, per the
file header's no-wildcard rule) declared BEFORE `dev-dependencies` (`dependency-type: development`). Contract: the
SDK declares `zod` as a peer (`^3.25 || ^4.0`) and helio-mcp passes zod schemas into `registerTool`, so a lone zod
major bump typechecks against the old SDK types (cf. the TS2589 note in `jest.config.cjs`). Add the family to
`DECLARED_FAMILIES` in `scripts/check-dependabot-groups.mjs`. Its `main()` hardcodes the manifests it loads
(`for (const directory of ["/", "/frontend"])`), so a family declared against `/helio-mcp` would fail with "no
manifest available" and the unaccounted-dependency coverage loop would silently skip `/helio-mcp` (`if (!manifest)
continue`). Fix: derive the directory list from the parsed config's own `npm` update entries, so every npm entry --
this one and any future one -- is coverage-checked; a directory with no `package.json` keeps today's tolerant
behaviour. Alternative (append `"/helio-mcp"` to the literal) rejected: it repeats the omission that caused this.

**D6 — README.** "Verifying" documents the PAT mint/revoke and self-cleanup; the layout block drops the nonexistent
`scripts/compose.ts` and lists `verifyPayloads.ts`.

## Risks / Trade-offs

- [The linked `helio-mcp/node_modules` is the main checkout's] → never `npm install`/`ci` through it; if it is stale
  vs the lockfile, report rather than mutate it.
- [A crash between create and ledger push leaks one row] → push each id immediately on receipt; names carry runId.
- [verify's read sections use whatever data the shared DB holds] → unchanged; only verify's own writes are its
  fixtures.

## Planner Notes

- Self-approved: D3 (mint/revoke rather than "verify mints nothing") — reads the AC literally and keeps the bootstrap
  credential out of the spawned server.
- Self-approved: D5 family classification, grounded in the SDK's own `peerDependencies`.
