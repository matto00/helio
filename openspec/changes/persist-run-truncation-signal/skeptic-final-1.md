## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of HEAD `e237f322` (ff79ebe2 + 2f7e13b8 + e237f322). Every conclusion below is
derived from the tree, the diff, re-run gates, a live backend/frontend, or a screenshot I looked
at — not from evaluation-1/2/3.md or the executor's files-modified.md, which I read only as claims.

### The gap the loop could not close — CLOSED

The loop never rendered the UI because the shared dev DB is at V103 (`V103__pending_connectors.sql`,
HEL-955) while that file is absent from this branch, so Flyway refuses to boot the backend against it.
I closed this **without touching the shared database and without `flyway repair`**, by standing the
backend up against a throwaway database:

- `CREATE DATABASE helio_hel873` (same cluster, same `helio_privileged` role; precedent exists —
  `helio_hel947`/`helio_hel818`/`helio_hel620` are prior runs' leftovers).
- Pointed the worktree's own gitignored `backend/.env` at it, ran
  `scripts/concertino/start-servers.sh . 6305 9212 HEL-873` → `READY backend`/`READY frontend`;
  `assert-phase.sh servers` → **`PASS servers`**.
- Flyway applied `V104` cleanly on a fresh schema:
  `104 | V104__pipeline_run_truncation_signal.sql | t`, and
  `pipeline_runs.truncated_reads = jsonb`, `pipelines.last_run_truncated = boolean`.
- Teardown: killed both servers, restored `backend/.env` byte-for-byte from a backup,
  `DROP DATABASE helio_hel873 WITH (FORCE)`, then **verified the drop by query**:
  `select count(*) from pg_database where datname='helio_hel873'` → `0`.
  Shared `helio` DB re-checked afterwards and is untouched: `flyway_schema_history` still at
  `installed_rank 103`, and `information_schema.columns` still has **0** rows for
  `pipeline_runs.truncated_reads`. Nothing HEL-955 or HEL-1003 depends on was mutated.

### What I verified (with evidence)

**Gates, re-run by me (not read from a report)**
- `sbt "testOnly …PipelineRunRepositorySpec …PipelineRepositorySpec …PipelineRunServiceSpec
  …PipelineRunRoutesSpec …OutputRoutesSpec"` → `Tests: succeeded 228, failed 0`, `EXIT=0`.
  These run against real embedded Postgres with `stringtype=unspecified`, so the JSONB write is
  genuinely exercised (this also validates the diff's claim that no explicit `jsonbStringType` is
  needed: `application.conf:32/109` sets `properties.stringtype = "unspecified"` on both pools).
- `npm run lint` → 0, `npm run typecheck` → 0, `node scripts/check-schema-drift.mjs` → 0,
  `prettier --check` on the touched trees → 0.
- `npx jest --testPathPatterns="(PipelineDetailPage|PipelineListTable|RunHistoryModal|rawElementGuardHel440)"`
  → 5 suites, 148 tests, all pass.

**AC 1 — "a truncated run's row count is still identifiable as partial after a page reload"**
Traced end to end against the running app, not only unit tests. I created a real user, a real
1500-row CSV source and a real pipeline through the live API, ran it, then wrote a truncated
signal into the isolated DB in exactly the shape the real write path emits (verified first: a live
run persisted `{"reads": [], "primaryAvailableRowCount": null}`), and did a **cold browser
navigation** to `/pipelines/<id>` — a genuine fresh load with empty Redux run state. Screenshot
`hel873-detail-dark.png` shows the banner rendering the full recomposed notice
(`Source "big-csv-1500" truncated: this run read the first 1000 rows returned, out of 3303
available, because of the 1000-row run cap. …`) and the footer showing `Rows written: 1,000 ⚠ Partial`.
The notice is genuinely **recomposed on read** — it is not in the persisted column at all, and
`GET /run-history` returns it. AC met, live.

**AC 2/3/4 — persistence, no false positives, all display surfaces**
- List table (`hel873-list-light.png`): "Truncated Pipeline 1,000 rows ⚠ Partial" vs
  "Complete Pipeline 3 rows" (unmarked). No false positive.
- Run history modal (`hel873-history-dark.png`): the truncated run marked; a row I inserted with
  `truncated_reads = NULL` (the pre-change shape) renders `900 rows` with **no** marker — not-recorded
  is not rendered as complete.
- `GET /api/pipelines` live: `Truncated Pipeline 1000 lastRunTruncated=True`,
  `Complete Pipeline 3 lastRunTruncated=False`; `GET /run-history` live: recorded row has a
  `truncation` key, legacy row has **no `truncation` key at all**. The three-state model is real on
  the wire, not just in tests.

**Light/dark parity** — toggled via `data-theme`. `--app-warning` is defined in both themes
(`theme.css:167` `#f5b944` dark, `:213` `#99621e` light). Light-mode badge measured
`rgb(153,98,30)` on `rgb(244,242,237)` ≈ 4.6:1 contrast at 12px/600 — passes 4.5:1.
`hel873-detail-light.png` shows correct light rendering.

**Breakpoints** — the hypothesised `white-space: nowrap`-in-a-table-cell failure is **refuted**.
At 390×844 (`hel873-list-narrow-scrolled.png`) the table uses its existing horizontal-scroll
pattern; measured `td.scrollWidth == td.clientWidth == 143` and the badge's right edge is inside
the cell (`overflow: false`). No clipping, no layout break.

**Console** — on my port (6305) the only errors are two pre-login `401 /api/auth/me` and two
`404 …/schedule` (no schedule set; pre-existing). No JS exceptions. The `ShareDialogHost` /
`shareDialogDashboard` / `useRef` ReferenceErrors in the shared Playwright console log are from
ports 6022/6387/6405/6435 — **other worktrees**, not this change.

**Three-state model — every write path audited**
`grep` over all call sites of `updateLastRun` / `updateLastRunInternal` / `updateRunTerminal` /
`updateRunTerminalInternal` / `insertDryRun*`: every one passes an explicit non-null value
(`EmptyTruncationJson` or a real payload), the defaults were deliberately removed so a forgotten
site fails to compile, and the **only** NULL-writing site is `insertRunInternal`'s queued row —
non-terminal, no row count, so no number needs qualifying. No path collapses not-recorded into
complete.

**`parseTruncationRecord` totality** — the whole decode (including `parseJson`'s own
`ParsingException`, the non-`JsArray` `reads` case, and missing required fields) is inside one
`Try`; `Failure` logs and returns `None`. Confirmed it degrades to *not-recorded*, never to
empty-and-complete, and the spec test proves one bad row does not fail the whole request.

**CR1 (the cycle-1 defect) — can the primary-scoped scalar carry a secondary's number?** No.
`truncationFields` (PipelineRunService.scala:120-141) returns `primaryStats.availableRowCount`
directly; it is not derived from `allReads` in any way, and it is threaded verbatim through
`onRunSuccess`/`onDryRunSuccess` into `truncatedReadsToJson`, then read back verbatim. The spec
test's `should not be Some(RestBigTotalRows.toLong)` anchor is a genuine red arm against the old
`reads.headOption` inference, not a same-source re-derivation.

**Hygiene** — no forbidden file touched (`ApiRoutes.scala`, `Connector*`,
`RestApiConnectorDriver`, `ConnectorRepository`, `helio-mcp/src/{types,helioApi}.ts`,
`frontend/src/shared/chrome/**`, `DashboardList.css` — grep over `--name-only`: zero hits).
Migration is `V104`, the only migration file touched, and no applied migration was edited.
`schemas/` and `openspec/` are updated in the same change. No inline FQNs introduced (the only
`com.helio.*` additions in the Scala diff are `import` lines). Tokens used are all real
(`--space-1`, `--app-warning`, `--text-xs`, `--weight-semibold`).

### Verdict: REFUTE

One reproduced, visible rendering defect on the ticket's own new UI element, on two of the three
surfaces it ships to. It is small and its fix is one line, but it is exactly the class of defect
that only browser verification could surface, and it is a failure of the component's own stated
intent (the `{" "}` is there and does nothing).

### Change Requests

1. **`frontend/src/features/pipelines/ui/TruncatedRowCountBadge.tsx:19` — the intended leading
   space never renders; the badge collides with the row count.**
   The `{" "}` is placed *inside* the badge `<span>`, whose CSS is
   `display: inline-flex` (`TruncatedRowCountBadge.css:5`). A flex container trims leading
   whitespace in its text content, so the space is swallowed and the badge butts directly against
   the preceding number. Reproduced in the live app in both themes and confirmed in the DOM:
   `td.textContent` is `"1,000 rows ⚠ Partial"` but the rendered output is `1,000 rows⚠ Partial`
   (see `hel873-list-light.png` and `hel873-history-dark.png`).
   - Affected: `PipelineListTable.tsx:127` (badge follows a bare string inside a fragment) and
     `RunHistoryModal.tsx:132` (badge follows a template literal).
   - **Not** affected: `PipelineDetailFooter.tsx:114`, where JSX happens to emit a space *outside*
     the span — which is why the footer looks right in `hel873-detail-dark.png` and hides the bug.
   - Fix at the component, not the three call sites (that is the whole point of the shared
     component): drop the no-op `{" "}` from inside the span and give the badge
     `margin-left: var(--space-1)` (or equivalent) in `TruncatedRowCountBadge.css`, so every call
     site is spaced identically without each having to remember. Please re-check all three
     surfaces in a browser after the change — a Jest `getByText(/Partial/)` assertion cannot see
     this.

### Non-blocking notes

- **`RunTruncationRecord`'s TS type overstates what the wire produces.**
  `pipelineStep.ts:581-586` declares `primaryAvailableRowCount: number | null` and
  `notice: string | null` as required, but spray-json **omits** `None` fields, so a real complete
  run returns `{"truncated":false,"reads":[]}` — I confirmed this against the live API. Nothing
  reads either field on a complete run (`PipelineDetailPage.tsx:177` uses `?.notice ?? null`,
  which is `undefined`-safe), so this is inert today, but the frontend test fixtures assert a shape
  the API does not actually emit. Declaring both `?: number | null` / `?: string | null` would make
  the type honest. (The JSON Schema is already correct — neither is in `required`.)
- **A run that fails *after* a truncated read persists `[]` / `last_run_truncated = false`**, i.e.
  "recorded, nothing truncated", which is not strictly true of the read that happened. It is
  harmless because a failed run also persists `rowCount = None`, so there is no number to
  misqualify and the UI shows `—`, and the spec reasons this way explicitly. Worth a sentence in
  the spec delta acknowledging the read-then-fail case by name rather than only the
  never-attempted case.
- **`check-schema-drift.mjs`'s unbalanced-paren regex** is now documented with an explicit
  field-ordering workaround in `PipelineProtocol.scala`. The comment is honest and the spinoff is
  named; just note that the workaround is load-bearing — moving `truncation` after `assertions`
  would silently remove it from drift checking with no warning.
