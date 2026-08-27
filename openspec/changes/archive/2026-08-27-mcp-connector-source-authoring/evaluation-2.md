## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS

All three cycle-1 change requests are addressed with real, recorded evidence in the new
`openspec/changes/mcp-connector-source-authoring/e2e-evidence.md` (commit `7dc3132f`), not merely
re-checked boxes:

- **Task 6.1**: a genuine end-to-end run captured, driven by a real `@modelcontextprotocol/sdk`
  `Client` over `StdioClientTransport` spawning the actual `helio-mcp` binary (`node dist/index.js`)
  — not raw HTTP, not a unit test. Shows the full `tools/list` enumeration (48 tools, confirms no
  create/update/rotate-Connector tool exists), a real `list_connectors` call/result, a real
  `create_rest_data_source` call against a real Connector producing a real 15-field DataType with
  `fetchError: null`, and a real `get_workspace_context` resource read showing the `connectors`
  block. This satisfies the AC's "proven with a real run, not a unit test."
- **Task 7.1**: a full enumeration table covering every surface that could carry Connector data
  (`list_connectors`, `create_rest_data_source` result, both `get_workspace_context` fan-outs —
  backend `WorkspaceContextResponse.connectors` and `helio-mcp/context.ts`'s own fan-out — and a
  grep-based confirmation no other tool touches Connector data), each row giving both a schema-level
  check and a runtime check, "checked in both directions" as the ticket AC requires.
- **Task 5.1**: recorded finding — "verified consistent, no divergence" — with specifics (line
  references into `AssistantProposalToolSchemas.scala`/`AssistantToolExecutor.scala`, confirms that
  surface already only offers `connectorId`-shaped rest_api config and that `test_connection`
  dispatches through the untouched `testRest` ephemeral path). No edits made, consistent with the
  task's "do not expand scope" instruction.
- **Task 8.1**: recorded finding — the Connector-picker kind-mismatch bug is confirmed real and
  reproduced live (a `sql`-kind Connector is selectable in the REST source form with no kind filter,
  accepted silently, and the mismatch is only discoverable at fetch time). Correctly left unfixed as
  out of scope, with a note that it's the same finding HEL-827's own gate already flagged.

**New judgment call reviewed**: the orchestrator additionally hardened `create_rest_data_source`'s
hostile-input handling from silent-strip to loud-rejection (an `auth`/`apiKey`/`token`/`password`/
`credential`-shaped field now fails the tool call with a validation error naming `connectorId`,
rather than being silently dropped). This is a reasonable, in-scope refinement of the same AC ("no
credential reaches the agent surface") — a silently-dropped credential field risks an agent believing
it configured auth when it didn't, which is a worse failure mode than a loud rejection. The change is
consistently threaded through:
- `restDataSourceSchema.ts` (`rejectCredentialField` helper, applied to all five field names)
- `restDataSourceSchema.test.ts` (all five hostile-field tests updated to assert `success: false` +
  message containing `connectorId`, rather than the old silent-strip assertions)
- `write.ts`'s tool description updated to describe the loud rejection
- `specs/mcp-data-source-tools/spec.md`'s "An agent attempts to pass a credential inline" scenario
  rewritten to match
- `e2e-evidence.md`'s "Post-evaluation schema hardening" section re-verifies this live against the
  real MCP stdio server: the hostile call returns `isError: true` with the exact validation message,
  and confirms no follow-up `POST /api/sources` call ever occurs.

No remaining AC gaps. No new scope creep beyond the judgment call the orchestrator explicitly
identified as being made in response to my own cycle-1 report.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH`:

- `helio-mcp` jest (targeted to bypass the `.claude/worktrees/` ignore-pattern gotcha noted in
  evaluation-1.md): **9 suites / 198 tests, all passing** (up from 196 — the two new password/
  credential hostile-field cases). Confirms `restDataSourceSchema.test.ts` now asserts loud
  rejection, not silent strip, matching the code.
- `npx tsc --noEmit` in `helio-mcp/`: clean.
- `npx eslint` (root config) against the three changed `helio-mcp` files: clean, 0 warnings.
- `npx prettier --check` against the changed files (including `e2e-evidence.md`): clean.
- No `backend/**` files changed in this commit (`git diff ff8fcec8..7dc3132f --stat` — only
  `helio-mcp/**` and `openspec/**`), so `sbt test` was not required to re-run; cycle-1's fresh
  3602/3602-green result still stands for the untouched backend surface.
- No `frontend/**` files changed.

`rejectCredentialField`'s implementation (`z.any().optional().refine(v => v === undefined, ...)`) is
a clean, minimal, well-documented pattern — reads clearly, no magic values, error message is
actionable. No dead code, no scope creep.

### Phase 3: UI Review — PASS (no regression)

No frontend files changed in this commit, so no browser surface to re-check. The one live behavior
this commit touches (the MCP tool's hostile-input handling) is directly re-verified against the real
MCP stdio server in `e2e-evidence.md`'s final section — confirmed the loud-rejection change works as
intended with no regression to the rest of the happy path (the earlier successful
`create_rest_data_source` call in the same evidence file, made before the hardening commit, still
demonstrates the unhardened-but-functionally-equivalent path succeeded; the later reproduction
confirms the hardened version now fails loudly instead). Independently re-confirmed the un-hardened
happy path myself in cycle 1 (Connector → connectorId-based source → successful fetch, no regression
possible from a commit that only adds new rejection branches ahead of the existing success path).

### Overall: PASS

All cycle-1 change requests were substantively addressed with real, recorded evidence rather than
box-checking. The additional loud-rejection judgment call is a genuine improvement, correctly
threaded through code, tests, tool description, and spec, and independently re-verified live. Gates
are green. No new issues found.

### Non-blocking Suggestions

- `files-modified.md` was not updated in this commit to point at the new `e2e-evidence.md` file —
  a future reader of `files-modified.md` alone (without knowing to look for `e2e-evidence.md`)
  could miss it. Not blocking since the file exists and is thorough, but a one-line cross-reference
  would close the gap for the next reader.
