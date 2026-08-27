## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the worktree tree, the diff, gates I
re-ran myself, and the live app — not from evaluation-1/2.md or files-modified.md (read
only as claims).

### What I verified (with evidence)

**Ground truth / diff**
- `git log main..HEAD` → 2 commits (`3402ecc5`, `a95a2db9`). `git diff --stat main...HEAD`
  → 26 files, frontend + openspec only.
- `git diff --stat main...HEAD -- backend/ schemas/ scripts/` → **empty**. Backend is
  byte-identical to `main`; this is a UI-only change, as design.md claims.

**Gates re-run fresh by me (not copied from evaluation-2.md)**
- `npm run lint` → clean, zero warnings.
- `npm run typecheck` → clean.
- `npx jest` in `frontend/` → **263/263 suites, 2879/2879 tests pass**.
  (Root `npx jest` finds 0 tests — root `testPathIgnorePatterns` excludes `/frontend/`
  and `/.claude/worktrees/`; the frontend project is the correct runner.)
- `npm run format:check` → clean.
- `npx openspec validate rest-source-form-parity --strict` → `Change ... is valid`.

**AC1 — UI ≥ MCP parity, enumerated in both directions**
design.md carries the full field-by-field table (MCP `create_rest_data_source` vs backend
`RestApiConfig` vs pre/post UI). I spot-checked the load-bearing claims against the tree:
`RestApiConfigBody` now declares `endpoint`/`queryParams`/`parameters`
(`dataSourceService.ts:32-55`), and the form renders Connector, endpoint, method,
queryParams, headers, body/contentType, rootSelector, template parameters
(`RestApiForm.tsx`). The only MCP-side field the UI does not offer is inline `auth`, which
`SourceService.createRest` already 400s on for every caller. **Met.**

**AC7 / "shared composer eliminates every bare-url code path" — traced exhaustively**
- `grep -rn "createRestSource\|inferFromJson" frontend/src --exclude tests` → exactly two
  non-service call sites, both in `AddSourceModal.tsx` (`:125` preview, `:151` create),
  **both** now passing `restForm.buildRestSourceConfig()`. The third builder,
  `RestApiForm.buildConfig()`, is gone — `TestConnectionAffordance` receives
  `buildConfig={buildRestSourceConfig}` directly. There is no remaining independent
  config-assembly block anywhere in the sources feature.
- `buildRestSourceConfig()` (`useRestSourceForm.ts:104-130`) has **no `url` key at all** —
  it is structurally incapable of emitting the bare-url shape, not merely guarded.
- Guards: `disabled={isLoading || (sourceType === "rest_api" && !restForm.connector)}` on
  "Preview schema" (`AddSourceModal.tsx:318`), `disabled={!connector}` on both the endpoint
  input and `TestConnectionAffordance`, plus a `!restForm.connector` early-return in
  `handlePreview`. Measured live: "Preview schema" `disabled === true` at load.
- Unit + integration tests assert `expect(config).not.toHaveProperty("url")` on the test,
  preview and create payloads — a real assertion on the actual outbound object, not a
  proxy.

**Live end-to-end against the running app** (dev servers restarted/asserted via
`start-servers.sh` + `assert-phase.sh servers` → `PASS servers`, ports 6259/9166)
- Authored a REST source entirely through the new form: selected `Eval HEL-827 Connector`,
  endpoint `/users/{{userId}}`, two duplicate `limit` query-param rows, template values.
- `POST /api/sources/test` → 200, UI showed "✓ Connected" (**AC3 met — test-before-save
  against the composed request**).
- "Preview schema" → real inferred fields from the live upstream (address.*, company.*,
  id:integer …), proving `{{userId}}` was substituted server-side.
- Created it, then read the persisted row back from `GET /api/data-sources?limit=500`:
  ```json
  {"connectorId":"d0803125-…","endpoint":"/users/{{userId}}","method":"GET",
   "parameters":{"lim":"5","userId":"1"},"queryParams":{"limit":"2"}}
  ```
  `connectorId` + `endpoint` + `parameters` + `queryParams` round-trip; **no `url` key**.
  (**AC4 met** — template params editable with values, detected across endpoint *and*
  query-param values.)

**AC7 — retirement does not orphan existing sources (I re-derived this independently, and
disagree with nothing but the executor's framing)**
- All 7 `rest_api` sources in the dev DB are `connectorId`-shaped; **zero** legacy bare-url
  rows remain (`RestSourceConnectorMigration` already converted them at boot).
- I previewed **every** pre-existing REST source: 1 × 200, 5 × 500. I did not accept the
  executor's "environment" explanation — I probed it. `psql` on `connector_credentials`
  shows three distinct `key_id` values in the shared dev DB (`eval-test-key` 29,
  `dev-local-1` 3, `local-dev-2026-08` 4), while this worktree's `backend/.env` has
  `CONNECTOR_MASTER_KEY_ID=dev-local-1`. Joining connectors→credentials: **every** 500'ing
  source's connector is wrapped under `local-dev-2026-08` or `eval-test-key`; the single
  200 is the one wrapped under `dev-local-1`. The correlation with `key_id` is 6/6; the
  correlation with this change is 0/6, and the backend is byte-identical to `main`, so
  `main` reproduces the same 500s on the same rows. This is the known shared-dev-Postgres
  master-key artifact, **environmental and pre-existing** — not a regression, and not a
  BLOCKER for this gate since the retirement claim is provable without it (no legacy rows
  exist, no read path was touched, and a `connectorId`-shaped source previews cleanly).

**Iron Laws**
- `verification-before-completion`: every claim above is backed by output I read in this
  session.
- `systematic-debugging`: the two bugs found during execution (form-in-form nesting; React
  synthetic submit bubbling through a portal) each record a real probe and its output, and
  each has a test that would catch a regression — the inline-create test asserts the
  Connector ends up selected *and* that the previously-typed source name survives, which is
  exactly the path bug 2 broke. Verified the fix is present: `e.stopPropagation()` in
  `CreateConnectorModal.handleSubmit`, `createPortal(..., document.body)` in
  `ConnectorSelectField`.

**DESIGN.md judgment (my domain) — screenshots taken and looked at**
- 1440 dark (`hel827-1440-dark.png`, `hel827-1440-filled-dark.png`,
  `hel827-1440-bottom-dark.png`), 1100 light (`hel827-1100-light.png`,
  `hel827-1100-light-dup.png`), 768, 430 dark (`hel827-430-dark.png`), plus
  `hel827-connector-open.png` and `hel827-preview.png`.
- **Tokens:** all three new stylesheets use only `--space-*`, `--text-*`, `--weight-*`,
  `--app-*`, `--font-mono`. I verified `--app-warning`, `--app-border-strong`,
  `--app-radius-sm`, `--app-transition` all exist in `theme.css` in **both** light and dark
  blocks. No hardcoded colors or raw spacing in the new files. The 4 `tokenAuditSweep`
  baseline edits are a pure +18-line renumber of pre-existing `AddSourceModal.css`
  entries — no baseline entry was suppressed.
- **Shared primitives:** `TextField`, `Textarea`, `Select`, `IconButton`,
  `TestConnectionAffordance`, `CreateConnectorModal`/`ConnectorCredentialField` all reused;
  nothing credential-related reimplemented, so HEL-824's shown-exactly-once contract is
  inherited intact.
- **Light/dark parity:** toggled the theme and re-shot. Labels, muted hints, the mono
  baseUrl prefix, the dashed "+ Add row" affordance and the duplicate-key warning all
  render correctly in both; the warning reads as amber in dark and a legible brown-amber in
  light. No dark-only assumptions.
- **Touch targets (measured, not eyeballed):** at **768** every new interactive control is
  exactly 44px — Connector select 44, Method select 44, both "+ Add row" 97×44, "Remove
  query params row" 44×44, "Test connection" 44. At **430** the same holds; the only sub-44
  elements are text inputs (32px) and the pre-existing `SourceTypeToggle` chips (25px).
  DESIGN.md:199-201 scopes the 44px floor to "buttons, select triggers/options, CTAs" — text
  inputs are not in scope, and the new inputs match the sibling "Source name"/"JSON path"
  inputs exactly. The cycle-1 finding is genuinely fixed, and correctly scoped to ≤768
  (desktop reverts to 33px).
- **Responsive:** key/value rows and template-parameter rows collapse to one column at 430;
  no overflow, no clipping, modal scrolls internally at every width.
- **Console:** zero errors from the authoring flow. The only errors on port 6259 are the 5
  preview 500s I deliberately triggered above. (The historical log also shows entries from
  ports 6256/6258 — other worktrees sharing the Playwright profile, not this app.)
- **Legibility of the "no auth field" explanation (AC2):** the picker shows
  "Requests use **Eval HEL-827 Connector** (rest_api) — its saved credential is applied
  automatically; there is no separate auth field here", and an unselected state that says a
  Connector is required. This reads as intentional, not broken. **Met.**

### Verdict: CONFIRM

Ships. All seven acceptance criteria trace to evidence I gathered myself; the composer
genuinely eliminates every bare-url path (structurally, not by guard); the retirement is
proven safe by construction plus a probed, key-id-correlated explanation of the dev-DB
500s; and the UI holds up at all four breakpoints in both themes.

### Non-blocking notes

1. **`AddSourceModal.tsx` is still 512 lines** (534 → 512). design.md Decision 5's stated
   goal was to bring both files under `CONTRIBUTING.md`'s ~250-line budget; the file
   shrank and gained no new inline state, but it remains well past 400. `CONTRIBUTING.md:24`
   asks that a file over ~400 lines get a split **proposed in the PR description** — please
   do that rather than leaving it silent. (`RestApiForm.tsx` at 149 and the four new files
   at 44-153 are all comfortably within budget.)
2. **`ConnectorSelectField` does not filter by `connector.kind`.** It lists every Connector
   the user owns. Only `rest_api` exists today (verified: `select distinct kind from
   connectors` → one row), so there is no reachable defect — but `Connector.kind` is a
   deliberately open `string` ("future SQL/S3/GCS/BigQuery/Sheets", per
   `types/connector.ts:8-10`), and the day a second kind ships this picker silently offers
   a non-REST Connector for a REST source. A one-line `.filter(c => c.kind === "rest_api")`
   now is much cheaper than the bug later.
3. **Both "+ Add row" buttons share the accessible name "Add row"** (the `addLabel` default
   isn't scoped by field, unlike the remove button's `Remove ${label} row`). A screen-reader
   user hears two identical buttons for Query params and Headers. Suggest defaulting to
   `Add ${label.toLowerCase()} row`.
4. **The Connector `baseUrl` prefix truncates aggressively** — at 1440 it rendered as
   `https://jsonplaceho…` (`max-width: 40%`, no `title`). design.md's stated intent was
   "so the composed URL stays legible"; a `title={connector.baseUrl}` (or wrapping instead
   of ellipsizing) would deliver that without a layout change.
5. **A detected template parameter can be left blank and still saved** — the composer emits
   `parameters[name] = parameterValues[name] ?? ""`, so a blank field silently substitutes
   an empty string (e.g. `/users/` rather than `/users/1`). The spec's wording is
   technically satisfied (a literal `{{name}}` is never submitted), but requiring a value
   for each detected parameter would be more honest.
6. Observed while probing note 5's territory: `authType: "none"` connectors still fail
   decryption when the master key rotates (all four `local-dev-2026-08` rows 500 despite
   needing no credential). That's backend behavior untouched by this ticket, but it may be
   worth a spinoff — a no-auth connector arguably shouldn't need a decryptable credential.
