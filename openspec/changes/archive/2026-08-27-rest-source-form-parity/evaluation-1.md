## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket acceptance criteria addressed:
  - Parity enumeration table present in design.md, both directions (MCP surface vs. UI, pre/post).
  - Connector selection is clear; absence of auth explained via `ConnectorSelectField`'s note text ("its saved credential is applied automatically; there is no separate auth field here" / "A Connector must be selected before this source can be tested or saved.").
  - Test-before-save verified to hit the composed request (`buildRestSourceConfig()`, wired into `TestConnectionAffordance`).
  - Template parameters editable (`TemplateParametersField.tsx`), verified live with `/users/{{userId}}` detecting `userId`.
  - Touch-target sweep done at 430/768 (see Phase 3 — one violation found).
  - Built from shared primitives (`TextField`, `Select`, `Textarea`, `IconButton`), DESIGN.md tokens used throughout new CSS (`--space-*`, `--text-*`, `--app-*`).
  - Retirement-of-bare-url verified live: created a fresh Connector + REST source end-to-end (see Phase 3); pre-existing legacy source's preview 500 is independently confirmed environmental (`CONNECTOR_MASTER_KEY_ID` mismatch), not a regression — this diff touches zero backend files (`git diff --name-only main...HEAD` confirms no `backend/**` paths), so it structurally cannot be responsible for that decrypt failure.
- No AC silently reinterpreted.
- All `tasks.md` items ([x]) match implemented behavior — verified 1.1–1.3 (composer + wire type), 2.1–2.4 (Connector picker + modal-over-modal + explanatory note), 3.1–3.4 (endpoint/queryParams/headers/template params), 4.1–4.2 (retirement verification), 5.1–5.3 (gates) against the diff and live app.
- No scope creep: diff is confined to `frontend/src/features/sources/**`, `frontend/src/features/connectors/ui/CreateConnectorModal.tsx` (additive, backwards-compatible `onCreated` prop), `frontend/src/test/renderWithStore.tsx` (test-store wiring), and `frontend/src/theme/tokenAuditSweep.css.test.ts` (mechanical baseline update for shifted line numbers this diff's new CSS caused).
- No regressions to existing behavior: `CreateConnectorModal`'s existing no-arg usage (`ConnectorsPage`) is unaffected (`onCreated` optional); full Jest suite green (2879/2879).
- No API-contract/schema changes needed or made (non-goal, backend already accepted these fields — confirmed via design.md's own verification against `DataSourceProtocol.scala`/`model.scala`, and no `backend/**` or `schemas/**` files appear in the diff).
- design.md/tasks.md reflect the final implemented behavior; files-modified.md's two documented bugs (nested `<form>` fixed via `createPortal`, submit-bubbling fixed via `e.stopPropagation()`) are both present in the diff and independently reproduced/verified below.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` (not trusted from the executor's report):
- `npm run lint` — pass, zero warnings.
- `npm run format:check` — pass.
- `npm test` — pass, 263/263 suites, 2879/2879 tests.
- `npm --prefix frontend run build` — pass (production build succeeds; the >500kB chunk warning is pre-existing app-wide, unrelated to this diff).

Code-quality review (CONTRIBUTING.md, DESIGN.md):
- **`buildRestSourceConfig()` single-composer requirement — verified structurally, not just by grep.** All three call sites use it: `RestApiForm.tsx:144` (`TestConnectionAffordance buildConfig={buildRestSourceConfig}`), `AddSourceModal.tsx:125` (`handlePreview` → `inferFromJson(restForm.buildRestSourceConfig())`), `AddSourceModal.tsx:153` (`handleCreate` → `createRestSource(name, restForm.buildRestSourceConfig(), fields)`). No other REST-config-building code path exists in the diff. Live-verified: created a fresh Connector, ran Test connection (200), Preview schema (200), Create source (succeeded) — all three requests went through, and the resulting source (`Eval HEL-827 REST Source`) previews successfully post-creation (200), while the composer's own unit tests (`useRestSourceForm.test.ts`) assert it never emits a bare `url`.
- **`connectorId` required before save/test — verified.** `useRestSourceForm.ts:113` only includes `connectorId` when a connector is set; there is no `url` fallback path at all in the composer (`endpoint` is always sent instead — matches design.md's stated wire contract). `RestApiForm.tsx:145` disables `TestConnectionAffordance` on `!connector`; `AddSourceModal.tsx:318` disables "Preview schema" the same way; `AddSourceModal.tsx:115-119` additionally guards `handlePreview` itself against a missing connector even if the disabled attribute were somehow bypassed (defense in depth). Live-verified: with no connector selected, Test connection and Preview schema buttons are `disabled=true`.
- **Endpoint field + Connector baseUrl prefix — matches design.md.** `RestApiForm.tsx:62-74`: `connector.baseUrl` rendered read-only via `.add-source-modal__endpoint-prefix`, endpoint input disabled until a connector is selected, placeholder `/v1/accounts` as specified.
- **File-size budget:** `RestApiForm.tsx` = 149 lines (well under the 250-line soft budget). `AddSourceModal.tsx` = 512 lines — over CONTRIBUTING.md's "propose a split" 400-line threshold (down from 534 pre-change, so the diff moves in the right direction by lifting REST state into `useRestSourceForm`, but the file remains over threshold; the budget check is informational-only per `check:scala-quality`'s own script comment, not a hard gate). Non-blocking — see suggestions below.
- **DRY:** `KeyValueListField` is genuinely reused for both `queryParams` and `headers` (not a one-off), matching design.md's explicit intent. `toRecord()` collapse logic lives once in the hook.
- **Readable/modular:** hook cleanly separates state/composition from presentation; extracted field components are small and single-purpose; no magic values beyond well-named constants (`HTTP_METHOD_OPTIONS`, `BODIED_METHODS`, `PLACEHOLDER_PATTERN`).
- **Type safety:** no `any`; `RestApiConfigBody` extended with properly optional fields.
- **Error handling:** `handlePreview`/`handleCreate` catch and surface `InlineError`; `ConnectorCredentialField`'s existing validation is inherited unchanged.
- **Tests meaningful:** `useRestSourceForm.test.ts` exercises the composer directly (never emits bare `url`, dedup collapse, template-parameter detection/resolution, body only for bodied methods); `AddSourceModal.test.tsx` covers connector-required disabling, composed-request shape, and the inline-create round trip; both bugs documented in files-modified.md have a corresponding regression test (form-in-form nesting caught by RTL's `validateDOMNesting` warning check, submit-bubbling caught by asserting no stray error appears after inline Connector creation).
- **No dead code**, no leftover TODO/FIXME in the diff.
- **No over-engineering:** `KeyValueListField` is appropriately generic without gold-plating; no premature abstraction.
- Both of the executor's self-reported bugs (nested `<form>` fixed via `createPortal` in `ConnectorSelectField.tsx:70-87`; submit-bubbling fixed via `e.stopPropagation()` in `CreateConnectorModal.tsx:50`) are present in the diff with clear systematic-debugging-law-compliant root-cause comments, and were independently reproduced live in this review (creating a Connector inline produced no spurious "A Connector is required." error, and the newly created Connector was correctly selected with the REST field state intact).

### Phase 3: UI Review — FAIL

Dev servers force-restarted fresh (per HEL-742 stale-Vite-cache gotcha) rather than trusting the executor's already-running instances — killed processes on 6259/9166, cleared `frontend/node_modules/.vite`, re-ran `start-servers.sh`.

**Passing checks:**
- Happy path end-to-end: created a fresh Connector ("Eval HEL-827 Connector", `rest_api`, `https://jsonplaceholder.typicode.com`) inline from the REST source form, selected it automatically (Bug 2 fix confirmed live — no spurious error), set endpoint `/users/1`, ran Test connection (200), Preview schema (200 with correct inferred fields), and Create source (succeeded, toast shown). Re-opened the new source and confirmed its own Preview succeeds (`GET /api/sources/{id}/preview` → 200) — this is exactly the retirement-verification evidence design.md Decision 4 / tasks 4.1-4.2 call for.
- Retirement-verification cross-check: the pre-existing legacy source "HEL-758 Eval REST Source" independently fails Preview with a 500, confirmed to be the `CONNECTOR_MASTER_KEY_ID` mismatch the executor flagged (`dev-local-1` locally vs. whatever key originally wrapped that row) — this diff touches zero `backend/**` files (confirmed via `git diff --name-only main...HEAD`), so it cannot be the cause; this is the same pre-existing, environmental, shared-dev-Postgres artifact the executor called out, not a regression.
- No console errors beyond the one pre-existing 500 (unrelated legacy source).
- Feature reachable from its one entry point (Add source → REST API).
- Interactive elements have accessible names (`aria-label` on Connector/Method/Endpoint/JSON path/Test connection); keyboard support inherited from shared `Select`/`TextField`/`IconButton`.
- 1440/1100/768/430 all render without layout breakage or clipping (screenshots taken; key/value rows correctly collapse to a single column at ≤430px via `KeyValueListField.css:50-54`'s `@media (max-width: 430px)` rule).
- Loading/empty/error states present and legible (`InlineError`, toast on success, disabled-button loading labels).

**Failing check — mechanical DESIGN.md touch-target violation (new code):**

`frontend/src/features/sources/ui/forms/KeyValueListField.css:27-43` defines `.key-value-list-field__add` ("+ Add row" button, used for both Query params and Headers) with no `@media (max-width: 768px)` rule bumping it to the DESIGN.md-mandated 44px mobile tap-target floor. Measured live at both 430px and 768px viewports: **33px height** (`getBoundingClientRect()` on the live "Add row" button). DESIGN.md `Control metrics` section states plainly: "interactive controls reachable on phone (buttons, select triggers/options, CTAs) get a literal `44px` min-height/min-width tap-target floor" at the 430/768 breakpoints, and this is explicitly marked **[mechanical]**. This button is new code introduced by this diff (not a pre-existing shared component whose behavior predates the ticket) — `IconButton.css:98-104` in the same diff-adjacent file set correctly applies the identical mobile floor to the row's "Remove" button (verified live at 44×44px), so the pattern was applied inconsistently within the same new file set rather than omitted for a documented reason.

This is the touch-target sweep the ticket's own acceptance criterion explicitly calls out ("Covered by the touch-target sweep at 430px and 768px") — the sweep was run and it did not pass.

### Overall: FAIL

### Change Requests

1. `frontend/src/features/sources/ui/forms/KeyValueListField.css:27-43` — add a `@media (max-width: 768px) { .key-value-list-field__add { min-height: 44px; } }` rule (matching the pattern already used in `IconButton.css:98-104` for the same row's "Remove" button), so the "+ Add row" CTA clears the DESIGN.md mobile 44px tap-target floor at both 430px and 768px. Re-verify with a live `getBoundingClientRect()` measurement at both breakpoints, not just a visual screenshot check.

### Non-blocking Suggestions

- `AddSourceModal.tsx` is 512 lines, still over CONTRIBUTING.md's "propose a split" 400-line threshold (down from 534 pre-change — the lift into `useRestSourceForm` moved it in the right direction, just not far enough). The bulk is the six mutually-exclusive per-source-type configure blocks (static/text/pdf/image/sql/rest+csv) sharing near-identical name-field JSX; a future pass could extract a shared `<SourceNameField>` component to cut the repetition, independent of this ticket's scope.
