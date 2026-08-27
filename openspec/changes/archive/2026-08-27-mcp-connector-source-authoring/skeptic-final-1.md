## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Gates re-run by me, fresh, in this worktree**

- `sbt -batch test` from `backend/`: `Total number of tests run: 3602 / Suites: completed 232, aborted 0 /
  Tests: succeeded 3602, failed 0` — `[success] Total time: 210 s`. Nothing regressed.
- helio-mcp jest: `npx jest helio-mcp/src --testPathIgnorePatterns="/node_modules/" "/dist/"
  --rootDir <worktree>` → **9 suites / 198 tests, all passing**. (Confirming the evaluator's
  ignore-pattern gotcha: my first run without excluding `/dist/` picked up 9 compiled
  `dist/**/*.test.js` suites that fail with `SyntaxError: Cannot use import statement outside a
  module` — an artifact of the e2e build, not a real failure. Re-ran scoped to `src`: clean. This is
  exactly the "reproduce before you REFUTE" case; the anomaly was my invocation.)
- `npx tsc --noEmit` in `helio-mcp/`: clean (test-file-only `@types/jest` noise absent when run from
  the package dir).

**Escalation resolution (bare-url retirement moved to the wire boundary) — durably recorded and real**

- Code: `backend/.../api/routes/sources/SourceRoutes.scala:47-58` — the rejection is a new
  `case Success(request) if request.config.connectorId.isEmpty && request.config.url.isDefined` guard
  inside the non-`sql` branch of `POST /api/sources`, ahead of `sourceService.createRest`, returning
  400 with an actionable message naming `connectorId` and `POST /api/connectors`. `SourceService.createRest`
  itself is untouched in the diff (`git diff main...HEAD --stat` lists no `SourceService.scala`), so
  `PipelineProposalService.resolveRestSource` keeps bare-url.
- design.md Decision 1 records the revised edit site, enumerates each explicitly-untouched internal
  caller, and the Risks section carries an explicit `CORRECTED (was wrong in an earlier draft)` note.
- tasks.md §1 header and 1.1a/1.2/1.3 match the revised edit site, including the requirement that the
  three `PipelineApplyProposalRollbackSpec` inline-bare-url tests remain green — and they do (3602 green,
  and `PipelineServiceInlineRestBodySpec`'s "inline rest_api bare-url source" case appears passing in
  the run output).

**Acceptance criteria traced**

| AC | Evidence |
|---|---|
| Agent can list Connectors and author a working REST source against one | `read.ts:210-224` registers `list_connectors` → `HelioApi.listConnectorInstances` (`helioApi.ts:310-325`); `write.ts:108-149` `create_rest_data_source` now takes `connectorId` + shaping fields only |
| Demonstrated end-to-end, real run not a unit test | `e2e-evidence.md` task 6.1 — real `@modelcontextprotocol/sdk` `Client` over `StdioClientTransport` spawning `node dist/index.js`; real `tools/list` (48 tools), real `list_connectors`, real `create_rest_data_source` producing a real 15-field DataType with `fetchError: null` against jsonplaceholder, real `helio://workspace/context` resource read showing the `connectors` block. This is MCP-level, not HTTP-level |
| No credential reaches the agent surface, enumerated both directions | `e2e-evidence.md` task 7.1 table — 6 rows, each with a schema-level AND a runtime check; `ConnectorSummary` is built by naming 4 fields (`ConnectorEntityProtocol.scala` `fromDomain`, `types.ts` `ConnectorSummary`), never by subtracting from `ConnectorMeta`; runtime proof is an exact `Object.keys` **union across all entries** (`['host','id','kind','name']`), not a spot check. Backend spec asserts the exact serialized key set with a fixture Connector whose `defaultHeaders` holds an `Authorization`-shaped value |
| Agent-creates-a-Connector decision made and justified | design.md Decision 2 — forbidden, with a structural (not policy) justification; verified live by the `tools/list` enumeration containing no create/update/rotate-Connector tool |
| Tool descriptions state credentials are never returned | `read.ts:216-219` ("Credentials are NEVER returned by this or any tool, in any form, including partially masked — do not waste turns trying to retrieve one"); `write.ts:114-122` (same, plus the loud-rejection statement) |
| Naming consistent with HEL-825 | `list_connectors` (instances) vs. pre-existing `list_connector_types` (kind metadata); design.md Decision 3; both present and distinct in the live `tools/list` |

**Findings 5.1 and 8.1**

- 5.1 recorded in `e2e-evidence.md` with concrete line references into
  `AssistantProposalToolSchemas.scala` / `AssistantToolExecutor.scala`; no edits to either file in the
  diff — verified against `git diff main...HEAD --stat`.
- 8.1 recorded with a live Playwright reproduction (SQL-kind Connector selectable and silently accepted
  in the REST picker). **Not fixed — I confirm that is correct.** It is a `frontend/` defect in
  `ConnectorSelectField.tsx`, explicitly out of this ticket's scope ("UI (child 6, HEL-827 — already
  shipped)"), and fixing it here would be scope creep. It needs a follow-up ticket.

**UI**: no `frontend/**` file appears in `git diff main...HEAD --stat`. No UI surface to judge; servers
not started (correctly — there is nothing visual in this change).

---

### THE JUDGMENT CALL: `.strict()` vs. the 5-name denylist

I probed this directly rather than reasoning about it, using the worktree's own
`@modelcontextprotocol/sdk@1.29.0` and `zod@3` (probe scripts in the scratchpad, not the repo).

**1. Does the shipped denylist actually leak?** Yes. Registering the shipped raw shape on a real
`McpServer`, connecting a real `Client` over `InMemoryTransport`, and calling the tool:

```
[raw shape, as shipped]  args ["name","connectorId","secret"] -> OK {"name":"n","connectorId":"c"}
[strict object]          args ["name","connectorId","secret"] -> ERROR -32602 ... "code":"unrecognized_keys", "keys":["secret"]
```

A hostile/naive `secret: "sk-LEAK"` (or `bearer`, `authorization`, `apiSecret`, `accessToken`, …) is
**silently dropped and the call SUCCEEDS** today. That is precisely the failure mode the loud-rejection
commit `7dc3132f` was written to eliminate — the agent believes it configured auth, the source silently
fails to authenticate later, far from the mistake. The denylist closes 5 doors in a room with unbounded
doors. The shipped code's own test file documents the hazard without recognising it:
`restDataSourceSchema.test.ts:23-34` ("has no url field at all") asserts `success: true` for
`url: "https://evil.example.com/exfil"` — i.e. an agent passing a raw URL is silently ignored and gets a
source pointed somewhere else entirely.

**2. Is `.strict()` compatible with how the MCP SDK consumes `inputSchema`?** Yes, unambiguously, on 1.29.0:
- `mcp.d.ts:150`: `InputArgs extends undefined | ZodRawShapeCompat | AnySchema` — a full Zod schema is a
  first-class accepted form, not just a raw shape. `getZodSchemaObject` (`mcp.js:861-871`) passes a schema
  instance straight through; only a raw shape gets `objectFromShape`-wrapped. **No double-wrapping.**
- JSON-Schema generation is **byte-identical** between the two forms. Both `tools/list` responses returned:
  `{"type":"object","properties":{...},"required":["name","connectorId"],"additionalProperties":false,
  "$schema":"http://json-schema.org/draft-07/schema#"}`. Note the SDK already advertises
  `additionalProperties: false` for the plain shape — so the *advertised* contract already claims strictness
  the *runtime validation* does not enforce. `.strict()` makes the runtime match the contract already on the wire.
- The named-field custom messages still fire under `.strict()` (the 5 names are *known* keys, so they reach
  their `.refine`): verified live — `auth` still returns the exact `"...Pass connectorId instead."` message,
  while `secret` returns `unrecognized_keys`. The layering the coordinator asked about works.
- Type-level: I copied `helio-mcp/` to the scratchpad, applied the change, and ran `npx tsc --noEmit`.
  Non-test errors: **none** — identical to the unmodified baseline run. The handler's object destructuring
  in `write.ts` still infers correctly from the `ZodObject`.

**3. Does any legitimate caller pass a key outside the current list?** No. `grep` over `helio-mcp/src` and
`helio-mcp/scripts` shows `createRestDataSourceInputSchema` has exactly one consumer (`write.ts:124`) and
`createRestDataSourceSchema` exactly one (its own test). The handler destructures only declared fields.
Running the full helio-mcp suite against the `.strict()` variant: **197 passed, 1 failed** — and the single
failure is `"has no url field at all"`, the test described above, whose assertion (`success: true` for an
extra `url`) is itself the behavior being fixed. No legitimate caller breaks.

`.strict()` is strictly safer, SDK-compatible, JSON-Schema-identical, and type-clean. This is a concrete,
scoped fix — not a design re-litigation — so it is a REFUTE.

---

### Verdict: REFUTE

The work is substantively correct and unusually well-evidenced — gates green, ACs traceable, the escalation
resolution durably recorded, the credential enumeration genuinely bidirectional. Two scoped fixes stand
between it and delivery, both in the change's own subject matter (credential hygiene).

### Change Requests

1. **Apply `.strict()` to `create_rest_data_source`'s input schema** (`helio-mcp/src/tools/restDataSourceSchema.ts:54`).
   Today an unknown credential-shaped key (`secret`, `bearer`, `authorization`, `apiSecret`, `accessToken`, …)
   is silently accepted-and-dropped and the tool call succeeds — the exact silent-strip failure mode commit
   `7dc3132f` set out to eliminate, closed for only 5 spellings. Proven safe and compatible above.
   - `restDataSourceSchema.ts:54` → `export const createRestDataSourceSchema = z.object(createRestDataSourceInputSchema).strict();`
   - `write.ts:23` / `write.ts:124` → import and pass `createRestDataSourceSchema` (the `ZodObject`) instead of
     `createRestDataSourceInputSchema` (the raw shape). SDK 1.29 accepts `AnySchema` at
     `mcp.d.ts:150`; `tsc --noEmit` verified clean.
   - `restDataSourceSchema.test.ts:23-34` — the `"has no url field at all"` test must invert: assert
     `success: false` and that the error names the unrecognized key, since a silently-dropped `url` means an
     agent's intended URL is discarded without a word. Keep the 5 named-field tests as-is (they still pass;
     re-verify they still assert the `connectorId`-naming message, which they do).
   - Add one test for an **unlisted** credential-shaped key (e.g. `secret`) asserting `success: false` — that
     is the regression this CR exists to prevent, and no current test would catch its removal.
   - Update the two places that overclaim the current behavior in prose:
     `restDataSourceSchema.ts`'s header comment, design.md **Decision 4** ("Because the schema has no
     credential-shaped field, an agent … has nowhere to put it"), and
     `specs/mcp-data-source-tools/spec.md:8` ("its input schema has no such fields, so an agent cannot …").
     With `.strict()` these statements become literally true for any key; today they are false for any name
     off the list of 5.

2. **Redact the live PAT committed into `openspec/changes/mcp-connector-source-authoring/e2e-evidence.md`**
   (task 6.1 "Setup" block): the file contains a real minted token,
   `helio_pat_856441f6…d42e901e`, in full. It is a local dev-DB credential for `matt@helio.dev` on the
   shared dev database, not production — so this is low-severity, not a security incident. But it is a real,
   currently-valid credential being permanently merged to `main` in the change whose entire subject is
   "a credential must never travel through a place it doesn't need to be." Replace with `helio_pat_<redacted>`;
   the evidence loses nothing (no assertion in the file depends on the token's value). Consider revoking the
   token as well.

### Non-blocking notes

- `RestAuthInput` (`helio-mcp/src/types.ts:427`) is now dead code — `grep -rn RestAuthInput helio-mcp/src`
  returns only its own declaration, since `createRestDataSource` dropped the `auth` parameter. Safe to delete
  in the same pass as CR 1 while the file is open.
- `ConnectorSummary.host` is populated from `baseUrl` (`ConnectorEntityProtocol.scala` `fromDomain`), and the
  schema description reads "base host/origin (baseUrl)". A `baseUrl` can carry a path (`https://api.x.com/v2`),
  so the field name slightly over-promises. Purely cosmetic — no credential implication, and `host` is the
  name the ticket itself used.
- The evaluator's own non-blocking note stands: `files-modified.md` does not cross-reference the new
  `e2e-evidence.md`.
- Follow-up ticket owed for finding 8.1 (Connector-picker kind mismatch in
  `frontend/src/features/sources/ui/forms/ConnectorSelectField.tsx` — no `kind` filter, SQL Connector silently
  selectable in the REST form). Correctly out of scope here; it should not leave this cycle unfiled.
