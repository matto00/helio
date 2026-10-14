## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 6b4d46cd0db59ca284fe6a36bb99eaf9df1c14ba. Diff base resolved live: 609e62b6d917243355a179fa8a26318c04898c27 (origin/main).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (re-derive each item): all three items are real; each was spot-checked against the tree (see below).
- AC2 (panel-type-rendering): REMOVED `Each panel type renders a visually distinct body` and `Metric panel literal label/unit takes precedence over field-mapped values`; ADDED per-kind body and metric-kind Output requirements; MODIFIED badge example. Header names match the living spec byte-for-byte (`grep -nF` hits at spec.md:4, :86, :117). After archive, no requirement in the spec mentions `typeId`/`fieldMapping`. The only remaining loose phrase is the Purpose line, which evidence.md records as out of scope.
- I checked the ADDED scenario claims against the source:
  - `ImagePanel.tsx` `sanitizeImageUrl`: resolves against the origin, accepts http/https only, returns the literal value for a single-`/` same-origin path, otherwise `parsed.href`. `objectFit` defaults to `contain`. On load error it swaps to the placeholder with "Image failed to load" copy.
  - `MetricRenderer.tsx`: the unit is hidden for `isDurationFormat`; the "No data" fallback depends on whether a value is present; an empty label is omitted.
  - `MetricOutputPanel.tsx:111` builds `{value, label: cfg.label ?? "", unit: cfg.unit ?? ""}` with no trend.
  - `FormRenderer.tsx:15` shows "Form not configured".
  - `DividerPanel` uses `orientation`.
- AC3 (wording): `grep -rn "mirrored by create_panel|mirroring create_panel|create_panel's enum|agent/UI parity"` over the tree (excluding node_modules/archive/this change/dist) returns 0 hits. I classified the remaining `create_panel\b` hits in `scripts/lib helio-mcp/src schemas backend/src frontend/src`: placements.ts:3,43, helioApi.ts:895,948, write.ts:728, placementsHandlers.ts:7,37 and server.test.ts:46 are all accurate history or removed-tool lists. None is a parity claim. The `create_content_panel` divider claim is true: placements.ts:94 `z.enum(["text","markdown","image","divider"])`.
- AC4 (mcp-panel-composition-tools): the five named requirements are REMOVED, and their headers match spec.md:27/76/144/178/211. The `sort` Reason was checked: backend decodes any string (DashboardProposalProtocol.scala:152), it is never read in `services/proposals`, and the zod enum is in proposal.ts.
- AC5: `openspec validate restate-stale-panel-spec-wording --type change --strict` prints "Change ... is valid" (fresh run).
- AC6/AC7: evidence.md carries the command and output for each claim; my fresh gate runs are below.
- Constraint C1 is honored for the deltas, comments and schema description I spot-checked.
- No scope creep: the backend comment and test-name edits are covered by design D4a.

### Phase 2: Code Review — PASS
Gates, run fresh by me in this worktree:
- `sbt testFull` (backend/** changed; HELIO_TEST_JVM_XMX=3g, nice 19): the log shows project path `.../worktrees/task/stale-panel-spec-wording/HEL-1592/backend/`. Total 8083 tests run, succeeded 8083, failed 0, canceled 4, suites 615, aborted 0. EXIT=0. The renamed test "...minus divider, which the proposal flow deliberately excludes as purely presentational chrome" appears and passed (log line 5047).
- `npm run check:schemas`: green (124 schemas, 11 panel-type surfaces, 14 AssistantProposalToolSchemas surfaces).
- `node scripts/check-schema-drift.selftest.mjs`: all cases passed.
- helio-mcp `npm run typecheck`: clean.
- `jest helio-mcp scripts` (HELIO_JEST_MAX_WORKERS=3): 51 suites / 469 tests passed. `--listTests` shows this worktree's paths.
- `prettier --check` on changed TS/JSON/MJS/spec files: clean.
- No frontend/** files changed, so the frontend lint/test/build gates did not trigger.

Code-quality review: all edits are comments, one string constant, one schema `description` and one test name. Behaviour is unchanged. No new FQNs, no dead code. The changes are accurate against the code: `ProposalPanelSupport.buildCreateRequest` exists (ProposalPanelSupport.scala:249), and `PanelConfigCodec` is the panel-create decode path.

### Phase 3: UI Review — PASS
The trigger matched on `schemas/**`, but only a `description` string changed. Its only frontend reference is a doc comment (`frontend/src/features/dashboards/types/proposal.ts:15`), so nothing at runtime consumes it. I ran a smoke check anyway with `start-servers.sh` on 7024/9931 (PASS servers):
- Opened an existing dashboard. Both panel cards render.
- Type badges read "output", which matches the MODIFIED badge scenario.
- 0 console errors on the dashboard route.
- Servers were stopped with `stop-servers.sh` (STOPPED ports=7024,9931).

I did not run the breakpoint and interaction checks: the change has no UI surface.

### Overall: PASS

### Non-blocking Suggestions
- evidence.md "Out of scope, observed", bullet 2, is factually wrong. It says the `create_panel` / `type: "collection"` scenario at mcp-panel-composition-tools/spec.md ~line 34 sits "inside a requirement not named by the ticket's five". In fact spec.md:27-36 is `create-panel-request schema agrees with the MCP type set`, which this change REMOVES, so the scenario goes away at archive. Correct that bullet before Delivery triage so no bogus follow-up is filed.
- The `validatePanel` scaladoc in `ProposalPanelSupport.scala:33-35` lists the type, title, output-binding and divider-orientation checks. It does not mention the `validateSourceBinding`/`validateControlsShape` checks the method also runs. This omission predates the change; consider naming them, or saying "including", so the list does not read as exhaustive.
