## Standing Constraints

- [C1] Executor and auditor run on sonnet; evaluator and skeptics on opus (driver ruling), passed explicitly on every spawn.
- [C2] Do not touch `frontend/**/compareOptions.ts`. Never bypass hooks; never delete `e2e-evidence/`; e2e screenshots via `e2e/support/evidencePath.ts`; no shared Playwright MCP browser or shared /tmp cookie jars; check both themes.
- [C3] Test/probe parallelism at most 3–4 workers under `nice -n 19`; long Bash calls use `timeout: 600000`.
- [C4] Before spawning the auditor: `git fetch`; if `git merge-base --is-ancestor origin/main HEAD` fails, merge origin/main, push, and wait for CI fully green on that exact head (owner rule 2026-10-08, until CON-231).
- [C5] If CI fails only on hel1350/hel1351 e2e specs (HEL-1373), escalate and stop; do not fix them.
- [C6] No prod changes; never touch matt@helio.dev data; delete only by exact id; never use pkill/pgrep/killall.

## 1. Backend: serve the limits

- [x] 1.1 Add `HistoryPayloadLimitsResponse` (+ tier case class, `from(PayloadHistoryConfig)`) and `historyPayloadLimits: Option[...] = None` on `OutputResponse` in `OutputProtocol.scala` (jsonFormat14); verify `sbt compile`.
- [x] 1.2 Stamp `historyPayloadLimits` in `OutputRoutes.withAvailability` from the same config; verify by extending `OutputHistoryPayloadsAvailableSpec` (or a sibling spec) with: default limits on GET/list/PATCH/POST, an overridden config (maxRows 500, beta 5 runs / 3 days) flowing through, a client-sent `config.historyPayloadLimits` not affecting the top-level field, and the field omitted when the pair is not wired. Show each new assertion red against an unstamped build first.
- [x] 1.3 Add `historyPayloadLimits` to `schemas/outputs/output.schema.json` (readOnly, `additionalProperties: false` at each level); verify the schema-drift check passes.

## 2. Frontend

- [x] 2.1 Add the `HistoryPayloadLimits` type to `types/output.ts` and a pure formatter for the help sentence; verify unit tests for defaults, overrides (500 rows / 2 MiB / 1 run / 1 day), a zero tier ("keeps no rows"), non-whole byte values, and absent limits.
- [x] 2.2 `HistoryPayloadsField` renders the formatted help from a new `limits` prop (constant deleted; grep shows no `1,000`/`1 MiB` literals left in the component); `OutputEditorSheet` passes `output.historyPayloadLimits`; verify `OutputEditorSheet.history.test.tsx` updated for both figure sets.
- [x] 2.3 Upsell link opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`) with an accessible new-tab cue; note uses `__field-hint`; verify unit test asserts target/rel/accessible name/class.
- [x] 2.4 Update `e2e/hel1331-history-payloads-toggle.spec.ts`: clicking the link opens a new page at `/settings#beta-access` with the Beta access heading in view, and the original page still shows the editor with an unsaved name edit; computed font size of note equals help text; screenshots of enabled + disabled states in light and dark via `evidencePath.ts`. Verify the spec passes locally against the worktree's own servers.

## 3. helio-mcp

- [x] 3.1 Add `historyPayloadLimits` to `OutputResponse` in `helio-mcp/src/types.ts`; rewrite `HISTORY_PAYLOADS_CONFIG_DOC` to reference the field instead of fixed figures; update `server.test.ts`/`outputsHandlers.test.ts` assertions; verify `npm test` in helio-mcp.

## 4. Verification

- [x] 4.1 Full gates: frontend lint/typecheck/format/jest, backend `sbt testFull` (relevant specs at minimum, full suite before handoff), helio-mcp tests, `openspec validate history-payloads-toggle-polish --type change`; live check in the running app (both themes) that the editor shows the server's figures.
