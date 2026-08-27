## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

- Task 6.1 ("Real run: create a Connector..., call `list_connectors`..., call
  `create_rest_data_source`..., confirm the source successfully fetches... Capture the
  transcript/output as evidence") is marked `[x]` in tasks.md, but `files-modified.md` contains no
  evidence of this run whatsoever — no transcript, no log excerpt, no description of what was
  observed. This is an explicit ticket acceptance criterion ("Demonstrated end to end... proven with
  a real run, not a unit test") — checking the task box without recording the run is exactly the
  "AC silently reinterpreted" failure mode this checklist exists to catch. (I independently ran the
  equivalent flow myself via the API during Phase 3 below and it does work — see Phase 3 — but that
  is *my* evidence, not the executor's, and does not retroactively satisfy the task.)
- Task 7.1 ("Record the enumeration in the evaluator/skeptic evidence, not just asserted in a commit
  message") is marked `[x]`, but no enumeration write-up appears in `files-modified.md` or any other
  artifact in the change dir — only the commit message and code comments assert the property. The
  ticket AC explicitly calls out that a commit-message assertion is insufficient; the executor's
  handoff repeats exactly that insufficient form.
- Task 5.1 ("Report any divergence found") and task 8.1 ("Report the finding [on the Connector-picker
  kind-mismatch behavior]") are both marked `[x]` with no findings recorded anywhere — not in
  `files-modified.md`, not in a separate note. Either no divergence/issue was found (in which case
  the report should say so explicitly, e.g. "5.1: verified consistent, no divergence") or the
  investigation was skipped and the box was checked anyway. As written, this is unverifiable from the
  executor's own record.

All other checklist items pass:
- Ticket ACs 1, 3, 4, 5, 6 (list+author against a Connector; agent-Connector-creation decision made
  and justified — forbidden, documented in commit message and design.md; tool descriptions state
  credentials are never returned; naming consistent with HEL-825's `list_connectors`/
  `list_connector_types` split) are all correctly implemented and independently verified against code
  (see Phase 2/3).
- No scope creep — diff is confined to the ticket's stated surfaces (MCP tools, workspace-context
  fan-outs, the wire-boundary bare-url rejection, and their tests).
- The escalation (moving the bare-url rejection from `SourceService.createRest` to `SourceRoutes`) is
  correctly reflected in both `design.md` (Decision 1, rewritten) and `tasks.md` (task 1 rewritten),
  and the implementation matches: `SourceService.createRest` is byte-for-byte unchanged from `main`
  (confirmed via `git diff main...HEAD -- backend/.../SourceService.scala`, empty), and the rejection
  now lives in `SourceRoutes.scala` exactly as described.
- No API/schema drift left undocumented — `schemas/workspace/workspace-context.schema.json` was
  updated in the same commit as the `connectors` field addition.

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` given at this speed):

- `cd backend && sbt test`: **3602 tests, 0 failures**, run to completion (3m22s). Confirmed
  `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` are present in `backend/.env` — no
  `NoKeyConfigured` failures appeared (would show as ~13-14 failures per the setup note; saw none).
- `helio-mcp` has no `test`/`lint` script of its own — its tests run under the **root** `jest.config.cjs`
  and root `eslint.config.*`. Important environmental note: the root `jest.config.cjs`
  `testPathIgnorePatterns` includes `/.claude/worktrees/` (added to keep the main repo's `npm test`
  from crawling nested delivery worktrees) — because this delivery worktree's own absolute path is
  itself under `.claude/worktrees/...`, running plain `npx jest` **inside this worktree** matches 0
  test files and (with `--passWithNoTests`, which the root `npm test` script uses) silently reports
  success having run nothing. This is a pre-existing environmental gotcha, not a defect introduced by
  this change, but it means the executor's own gate-run report — if it ran `npm test` unmodified from
  inside this worktree — cannot be trusted at face value for `helio-mcp`. I re-ran targeted
  (`npx jest helio-mcp/ --testPathIgnorePatterns="/node_modules/"` to bypass the worktree exclusion)
  and got **9 suites / 196 tests, all passing**, including the two new suites
  (`restDataSourceSchema.test.ts`, `context.test.ts`).
- `npx tsc --noEmit` in `helio-mcp/`: clean, no errors.
- `npx eslint` (root config) against all changed `helio-mcp/src/**` files: clean, 0 warnings.
- `npx prettier --check` against all changed `helio-mcp` files + the schema JSON: clean.
- No `frontend/**` files in the diff (`git diff --stat main...HEAD` confirmed) — frontend gates
  correctly not required; matches the ticket's explicit "UI already shipped in HEL-827" scoping.

Code-quality spot checks (CONTRIBUTING.md/DESIGN.md n/a — no frontend UI touched):
- `ConnectorSummary` (both Scala and TS) is built by naming exactly `id`/`name`/`kind`/`host` off the
  domain type, never by projecting/subtracting from a richer type — confirmed by reading
  `ConnectorEntityProtocol.scala` and `helio-mcp/src/types.ts`; matches design.md Decision 6 and
  avoids the "forgot a new field lands in an omission-based projection" foot-gun.
- `SourceRoutes.scala`'s new branch is inserted as an additional `case Success(request) if ...` guard
  ahead of the existing `case Success(request) =>` — decode (`convertTo[CreateSourceRequest]`) stays
  untouched and total; the rejection is a post-decode check, exactly per task 1.1a.
- `PipelineApplyProposalRollbackSpec.scala`'s diff is confined to the `createRestSource` helper (which
  hits `POST /api/sources` directly); the three inline-bare-url apply-proposal tests elsewhere in that
  file are untouched in the diff — this is the correct signal for the escalation resolution being
  placed at the right boundary.
- `helio-mcp/src/context.ts`'s `buildConnectors` is independently try/catch-guarded (confirmed by
  reading the function), degrading to `[]` on failure without failing the whole
  `get_workspace_context` call — matches task 2.7 and the "connectors never shrunk by budget
  trimming" spec scenario (also has a dedicated test per files-modified.md, confirmed present in
  `WorkspaceContextServiceApplyBudgetSpec.scala`'s diff).
- No dead code, no TODO/FIXME left behind, no untyped escape hatches in the reviewed diff.

### Phase 3: UI Review — PASS (API-level; no browser UI changed)

Triggered by `ApiRoutes.scala`, `schemas/**`, and `backend routes` changes. There are no
`frontend/**` changes, so there is no browser surface to exercise — reviewed at the API level instead,
which is the actual surface this ticket adds.

Started servers via `scripts/concertino/start-servers.sh` (main-repo copy — this worktree predates the
script's sync; both backend :9167 and frontend :6260 were already healthy/reused).

Independently drove the full happy path myself, since the executor recorded none (see Phase 1):
1. `POST /api/connectors` with a real `rest_api` Connector → 201, no credential echoed back.
2. `GET /api/connectors` → list includes the new Connector; response shows `config: {implicit:false}`
   only, no credential field, matching what `list_connectors`/`ConnectorSummary` are meant to expose.
3. `POST /api/sources` with `{"type":"rest_api","config":{"connectorId":"<id>","endpoint":"/todos/1"}}`
   → 201, a `DataType` was created with real inferred fields (`completed`/`id`/`title`/`userId`) — the
   source **actually fetched successfully**, no `fetchError`. This is the exact flow task 6.1 called
   for (Connector → connectorId-based source → successful fetch), just driven directly against the
   HTTP API rather than through an MCP client.
4. `POST /api/sources` with a bare `url` (no `connectorId`) → **400**, body names `connectorId`
   explicitly ("connectorId is required — a bare url is no longer accepted on POST /api/sources...").
5. `GET /api/workspace/context` → `connectors` array present, each entry exactly
   `{id, name, kind, host}` — confirmed for the newly created Connector and every other Connector in
   the (shared dev) DB, no `config`/`defaultHeaders`/credential field on any entry.
6. Cleaned up the source and Connector created for this check (`DELETE`, both 204).

No console errors observed (API-only interaction); no loading/empty-state concerns apply (no new
frontend surface). Accessibility/breakpoint checks N/A — no UI changed.

### Overall: FAIL

The implementation itself is correct and well-tested — every mechanical check I ran independently
(gates, credential-non-leak enumeration, the escalation boundary, and the end-to-end happy path)
passes. The failure is procedural: three explicit tasks tied to ticket acceptance criteria (6.1 real
end-to-end demonstration, 7.1 recorded credential-enumeration, and the report-only tasks 5.1/8.1) are
marked complete in `tasks.md` without the required evidence ever being written down anywhere in the
change directory. Per this ticket's own AC text, an assertion in a commit message or an unrecorded
task checkbox does not satisfy "proven with a real run" or "record ... in the evaluator/skeptic
evidence, not just asserted."

### Change Requests

1. Add a section to `files-modified.md` (or a new `e2e-evidence.md` in the change dir) documenting
   task 6.1's real run: the actual Connector created, the `list_connectors` MCP call and its result,
   the `create_rest_data_source` call with the returned `connectorId`, and confirmation the resulting
   source fetched successfully (DataType id, field list, no fetchError) — ideally via an actual MCP
   client/tool-call transcript, not just the equivalent raw HTTP calls, since task 6.1 specifically
   asks for the MCP surface to be exercised.
2. Add the task 7.1 credential-enumeration write-up to `files-modified.md`: list every MCP tool result
   and workspace-context payload that could carry Connector data (`list_connectors`,
   `create_rest_data_source` result, `get_workspace_context`'s `connectors` block on both the backend
   `WorkspaceContextResponse` and `helio-mcp/src/context.ts` fan-outs), and for each, state the
   schema-level check (no credential field exists on the type) and the runtime check (hostile-input
   test result) that was performed.
3. Add one or two sentences to `files-modified.md` reporting task 5.1's finding (does
   `AssistantProposalToolSchemas`/`AssistantToolExecutor` remain consistent with the new MCP shape, or
   was a divergence found?) and task 8.1's finding (was the mismatched-kind Connector-picker failure
   graceful or confusing?) — even "verified consistent, no divergence" / "graceful 4xx with a clear
   message" is sufficient; an unrecorded checkbox is not.

### Non-blocking Suggestions

- Consider adding a note to `jest.config.cjs` or `CONTRIBUTING.md` flagging that plain `npx jest`/
  `npm test` run *from inside* a delivery worktree under `.claude/worktrees/` will silently match zero
  tests (via the very ignore pattern meant to protect the main repo's own test run) — this cost real
  evaluation time to discover and would equally mislead an executor who trusts an in-worktree
  `npm test` "0 failures" result at face value. A worktree-local override (or a comment at the top of
  the ignore pattern loud enough to catch a reader running gates from inside one) would close this
  gap for future tickets.
