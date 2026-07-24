## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `specs/connection-test-endpoint/spec.md`,
  `specs/sql-database-connector/spec.md` (new this round), `tasks.md`, `workflow-state.md`, fresh —
  not diffed against prior rounds' reports, which I treated only as claims to re-verify.
- `openspec validate connection-test-endpoint --strict` → `Change 'connection-test-endpoint' is valid`
  (ran it myself).
- **Round-2 CR1 (missing spec delta) — verified fixed and format-correct.** Diffed the new
  `specs/sql-database-connector/spec.md`'s MODIFIED "Frontend SQL Database tab" requirement against
  the live `openspec/specs/sql-database-connector/spec.md:111-136` requirement it modifies (read both
  in full). The delta is a **complete transformation of the entire block**, not a partial rewrite:
  all pre-existing content is preserved (field list, port-default scenario, password-masking scenario,
  verbatim) or correctly renamed in place ("Test connection shows schema preview" →
  "Infer schema shows schema preview", "Connection error shown inline" → "Infer schema error shown
  inline"), plus two wholly new scenarios for the new "Test connection" control. Nothing from the base
  requirement is silently dropped. `proposal.md`'s Capabilities section now lists
  `sql-database-connector` under Modified Capabilities with rationale, and its Impact section lists the
  spec file. Confirmed the repo's actual convention for this: none of the four sibling archived
  changes in this epic (`openspec/changes/archive/2026-07-24-{connector-secret-redaction-seam,
  connector-spi-shared-trait,reusable-schema-inference-facade,uniform-fetch-error-envelope}`) have a
  dedicated `tasks.md` line item for their own `specs/*/spec.md` delta file either — the delta lives in
  `specs/` and is applied at archive time, per `proposal.md`'s own Impact-section note here ("MODIFIED
  at archive time per this change's ... delta"). Round 2's ask for "a corresponding tasks.md item" is
  satisfied in substance by this established pattern; not a gap.
- **Round-2 CR2 (missing `type="button"`) — verified fixed and internally consistent.** Read
  `AddSourceModal.tsx:414-449` directly: the `<form id="add-source-configure-form"
  onSubmit={(e) => void handlePreview(e)}>` wraps `SqlTab`/`RestApiForm`/`CsvForm` exactly as
  design.md Decision 5a and skeptic round 2 described (line numbers drifted by ~1 from the cited
  413-449 due to intervening edits — immaterial). `design.md` Decision 5a, `tasks.md` 2.2 ("The button
  MUST render `type=\"button\"`"), 2.4 ("Confirm ... clicking it does not submit ... form"), and 3.4
  (explicit regression test asserting no `inferFromJson` call / no `step` advance) are all mutually
  consistent and consistent with the real form structure.
- Read `SqlTab.tsx` in full: confirmed the *existing* "Test connection" button (lines 186-193) is the
  sole `inferSqlSource`/`inferredFields` trigger and gates `disabled={isSaving || isTesting ||
  inferredFields === null}` on "Create source" (line 199) exactly as design.md Decision 6 describes —
  the planned rename-to-"Infer schema" + additive `TestConnectionAffordance` leaves this gating
  mechanism untouched.
- Read `RestApiForm.tsx` and `AddSourceModal.tsx`'s `handlePreview` (lines 54-86): confirmed
  `RestApiForm` already receives `url`/`jsonPath` as props (needed for task 2.4's planned
  `buildConfig`), and `handlePreview`'s REST config assembly (`{ url: url.trim(), method: "GET",
  ...(jsonPath.trim() ? { jsonPath: jsonPath.trim() } : {}) }`) is the shape design.md/tasks.md 2.4
  say the new affordance's `buildConfig` should mirror — feasible without a `RestApiForm` props-
  interface change.
- Read `backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala` in full: confirmed the
  `infer` dispatch's `.getOrElse(DataSourceKind.RestApi)` type-sniff and nested-SQL/flat-REST
  `convertTo` split, exactly as design.md Decision 2 and tasks.md 1.5 describe for `/test` to mirror.
- Read `backend/src/main/scala/com/helio/services/SourceService.scala`: confirmed `inferSql`/
  `inferRest`/`refreshSql`/`refreshRest` all map connector `Left` to `ServiceError.BadGateway` — the
  precedent design.md Decision 1 reconciles against, cited accurately (both the favorable
  `CreateSourceEnvelope` 200-with-flag precedent and the unfavorable `BadGateway` precedent are named).
- Read `SqlConnector.testConnection` (`domain/SqlConnector.scala:122-134`, open+close, no query exec)
  and `RestApiConnector.testConnection` (status-only, no body parsing) — both match design.md's stated
  semantics verbatim.
- Read `dataSourceService.ts`: confirmed `inferSqlSource` posts `{ type: "sql", config }` (nested) and
  `inferFromJson` posts the config object directly (flat, no wrapper/no `type`) — matches design.md
  Decision 2's asymmetry claim and `specs/connection-test-endpoint/spec.md`'s scenarios.
  `RestApiConfigBody` and `InlineError` (`frontend/src/shared/chrome/InlineError.tsx`) both exist as
  design.md assumes.
- Confirmed `--app-success` is defined in both light and dark theme blocks
  (`frontend/src/theme/theme.css:110,154`).
- Confirmed `SqlTab.test.tsx` currently has exactly two tests clicking a button named "Test connection"
  (lines 64, 84) — matches tasks.md 3.5's claimed scope for the required test-file update.
- `git status --short` — no uncommitted code changes outside the OpenSpec planning artifacts; this is
  still purely a design-gate round (no implementation yet), as expected.

### Verdict: CONFIRM

Both round-2 change requests are genuinely resolved, not just asserted: the new `sql-database-connector`
spec delta is a complete, correctly-transformed copy of the live requirement (not a partial rewrite that
would lose detail at archive time), and design.md Decision 5a / tasks.md 2.2, 2.4, 3.4 form a consistent,
code-grounded chain (real form-wrapping hazard → explicit `type="button"` requirement → explicit
regression test) rather than an unenforced assertion. I re-verified every prior round's fix against
current code rather than trusting the reports, and found no new contradictions, placeholders, or
unenforced claims this round.

### Non-blocking notes

- `proposal.md`'s "What Changes" line ("Error messages reuse `testConnection`'s existing curated
  categories ... unmodified") is still imprecise for the REST non-2xx branch, which embeds the raw
  upstream response body rather than a short curated category — design.md's Risks section already
  states this accurately and design.md is the more authoritative artifact here. Same non-blocking note
  round 2 raised; still true, still not worth blocking on.
