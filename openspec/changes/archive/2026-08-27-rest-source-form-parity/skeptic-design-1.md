## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Worktree HEAD = `f73cee3a` (matches design.md's stated baseline); only untracked change is the change dir.
- `frontend/src/features/sources/ui/forms/RestApiForm.tsx` — 137 lines, has url/method/body/bodyContentType/`jsonPath`→`rootSelector`. Design's HEL-826 claims: ACCURATE.
- `frontend/src/features/sources/services/dataSourceService.ts:32-44` — `RestApiConfigBody` declares `url?`, `connectorId?`, `method?`, `headers?`, `rootSelector?`, `body?`, `bodyContentType?`, `auth?`. It does **not** declare `endpoint`, `queryParams`, or `parameters`.
- `backend/.../DataSourceProtocol.scala:142-159` (`RestApiConfigPayload`) and `domain/model/model.scala:514-524` (`RestApiConfig`) — `connectorId`/`endpoint`/`method`/`queryParams`/`headers`/`body`/`bodyContentType`/`rootSelector`/`parameters` all present. Design's backend claims: ACCURATE; "no backend changes needed": ACCURATE.
- `DataSourceProtocol.scala:344-347` and `SourceService.scala:83-88,186-188,222-224` — `connectorId` + `url` together is a hard 400 ("provide exactly one of connectorId or url"); the `connectorId` path takes the path from `p.endpoint` (`:356`, `getOrElse("")`).
- `RestSourceConnectorMigration.scala:14-34` + `app/Main.scala:136` — boot-time, idempotent, converts legacy rows. Decision 4's core claim: TRUE, **but** the header comment enumerates four branches: only branch 2 (legacy + owned) migrates; branch 3 (ownerless, `owner_id IS NULL`) and branch 4 (malformed) are logged at `error` and **skipped**.
- `frontend/src/features/connectors/ui/CreateConnectorModal.tsx:18-22,64-69` — props are `{ onClose }` only; on success it dispatches `createConnector`, toasts, and calls `onClose()`. It cannot hand the created Connector back to a caller.
- `grep -rl RestApiForm frontend/src` → only `AddSourceModal.tsx` (+ its test). There is **no source edit form** anywhere.
- `AddSourceModal.tsx` — 534 lines; REST config is built in **three** places: `RestApiForm.buildConfig()` (test), `handlePreview` (`:120-130`, infer), `handleSubmit` (`:156-166`, create).
- `helio-mcp/src/tools/write.ts:132-139` — `create_rest_data_source` takes `url`/`method`/`headers`/`auth`. Table row accurate as to the tool. But `SourceService.createRest` (`:80-81`) already rejects any `auth` with a 400 — the MCP tool's auth-bearing call is already broken on main today.
- `CONTRIBUTING.md:24` — ~250-line soft budget, propose a split past ~400 lines.
- `RestApiConnectorDriver.scala:162-181,336-342` — templating resolves only on the `connectorId` path; the ephemeral bare-`url` path deliberately does not interpolate.

### Verdict: REFUTE

The plan is directionally right and its backend/migration research is mostly sound, but as written it would produce a form that **400s on every save**: the `endpoint` field is absent from the plan, the client type, and the tasks, while the backend hard-rejects `connectorId` + `url` together.

### Change Requests

1. **BLOCKING — `endpoint` is missing from the entire plan.** Once the UI emits `connectorId`, it must send the path as `endpoint`, not `url` (`SourceService.scala:83-88` rejects both; `DataSourceProtocol.scala:356` reads `p.endpoint`). Nothing in design.md, the enumeration table, tasks 3.1/3.3, or the spec mentions `endpoint`. Add: (a) an `endpoint?: string` field to `RestApiConfigBody`; (b) a design decision on what the existing "URL" input becomes — a relative endpoint path field, with the Connector's `baseUrl` shown as the prefix — including label/placeholder/validation changes; (c) an enumeration-table row for `endpoint`.

2. **BLOCKING — only one of three REST config builders is in scope.** `RestApiForm.buildConfig()` (test), `AddSourceModal.handlePreview` (`:120-130`, infer) and `AddSourceModal.handleSubmit` (`:156-166`, create) each independently rebuild the REST config today. Task 3.1 names only `buildConfig()`. As written, "Preview schema" and "Create" would silently keep emitting bare `url` (→ 400 or a wrongly-shaped source) while only Test connection is updated. Require a single shared config-composition function used by all three call sites, and say so in tasks.

3. **Client wire type must be extended — say so explicitly.** design.md states "this ticket wires the UI to fields that already exist," which is true server-side but false client-side: `RestApiConfigBody` lacks `endpoint`, `queryParams`, and `parameters`. Task 3.1's "resolved template parameter values" must name the actual wire field `parameters: Record<string,string>`. Add these three fields to the Impact/tasks explicitly.

4. **BLOCKING — task 4.2 references a form that does not exist.** There is no source edit form (`RestApiForm` is used only by `AddSourceModal`). "Open that source in the (updated) edit form" is unexecutable, and the Risks section's "editing always operates on the already-migrated `connectorId` shape … there is no code path where the old shape is user-visible post-migration" rests on a non-existent surface. Replace task 4.2 with an executable check (e.g. the legacy-created source still previews/fetches rows and its pipeline run still succeeds after the change), and delete/correct the editing claim.

5. **Decision 4 / Risks overstate the migration.** `RestSourceConnectorMigration`'s own header (`:28-33`) skips ownerless (`owner_id IS NULL`) and malformed rows, logging at `error`. So "**every** existing source in a running deployment is already migrated" is false. Restate as "every owned, well-formed legacy row"; state what happens to the skipped rows (they remain legacy-shaped and un-authorable from the UI) and whether that is acceptable for AC7's "does not orphan".

6. **Decision 1's "`CreateConnectorModal` unmodified" is false.** Its props are `{ onClose }`; it cannot return the new Connector's id (`CreateConnectorModal.tsx:18-22,64-69`). Decide and record: add an optional `onCreated?(connector: Connector) => void` (backwards-compatible for `ConnectorsPage`), or select by reading the newest id from `connectorsSlice` after the modal closes (racy — prefer the callback). Also correct proposal.md's "`frontend/src/features/connectors/*` (reused, not modified)". Additionally, the plan does not address that this is a **modal launched from inside another modal** (`AddSourceModal` is itself a `Modal`) — specify stacking/focus-return behavior per DESIGN.md, since task 1.2 promises "return focus to the REST source form without losing other field values."

7. **Decision 3's rationale is partly counterfactual (conclusion may still stand).** It leans on "the still-live legacy MCP write path posts `url`/`method`/`headers`/`auth` inline" — but `SourceService.createRest:80-81` already 400s on any `auth`, so that specific dependency is already dead on main. The surviving dependency is the *no-auth* bare-`url` create only. Correct the reasoning (and the table's "auth | yes" MCP row, which should read "accepted by the tool, rejected by the server since HEL-822") and re-affirm the keep-backend-acceptance conclusion on the accurate basis. Note the table's "child 7 not re-verified live" hedge is unnecessary — `helio-mcp/src/tools/write.ts` is in this repo and verifiable.

8. **Spec requirement is self-weakening.** `specs/sources/rest-source-authoring/spec.md`: "SHALL NOT submit a create request that omits `connectorId` … **once a Connector is selected**" is a tautology and contradicts task 3.3 ("require a Connector before the save action is enabled"). Restate as: the form SHALL require a Connector and SHALL never submit a create request carrying a bare `url`.

9. **File-size plan ignores the file that is actually over budget.** `AddSourceModal.tsx` is already 534 lines (CONTRIBUTING.md:24 says propose a split past ~400) and this change adds four more pieces of REST state plus template detection to it. Decision 5 only plans splits of the 137-line `RestApiForm.tsx`. Add an explicit plan for `AddSourceModal.tsx` — e.g. lift all REST field state + the shared config builder into a `useRestSourceForm` hook / `RestApiForm`-owned state.

### Non-blocking notes

- Decision 2 (ordered `{key,value}[]`, non-blocking duplicate flagging) is sound and correctly mirrors HEL-826's decode-is-total invariant.
- Template parameters only resolve on the `connectorId` path (`RestApiConnectorDriver.scala:336-342`); worth stating in the spec that the parameter editor is meaningful only with a Connector selected, so a `{{name}}` typed before selection is not silently sent literally.
- The Gate-Chain checklist is correct (no `.husky/**` or hook-invoked script touched).
