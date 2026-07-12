## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

All checks below were performed cold, independently of evaluation-1.md/evaluation-2.md's
narrative, against fresh reads of source and a live dev-server session
(`localhost:5426`/`localhost:8333`, confirmed healthy via `assert-phase.sh servers` → `PASS`).

1. **`table-layout: fixed` scoping — correct, re-derived from source, not leaking.**
   Read `DataGrid.css:40-42`: `.ui-data-grid--full .ui-data-grid__table { table-layout: fixed; }`
   — a descendant-combinator selector requiring the `--full` class on an ancestor `<div>`, with the
   plain `.ui-data-grid__table` class on the `<table>` itself carrying no layout rule. Confirmed via
   live `getComputedStyle` on two real preview surfaces I navigated to myself (not reused from the
   evaluator's session): Type Registry → `TypeDetailPanel`'s schema preview grid
   (`ui-data-grid--preview`, `tableLayout: "auto"`, 0 resize handles) and a pipeline's
   `PipelinePreviewModal` (dry-run populated with 200 rows, same result: `auto`, 0 handles,
   columns visibly content-sized in a screenshot). Also `grep`-verified all 5 preview consumers
   (`StepCard.tsx:236`, `PipelinePreviewModal.tsx:41`, `TypeDetailPanel.tsx:195`, `SqlTab.tsx:217`,
   `SourceDetailPanel.tsx:129`) pass `variant="preview"` and neither `columnWidths` nor
   `onColumnResize` — matching files-modified.md's claim exactly.

2. **`DEFAULT_COLUMN_WIDTH` (160px) regression risk on existing Table panels — checked live,
   no regression found.** Queried the actual Postgres DB (`psql`) for pre-existing `type='table'`
   panels with `column_widths IS NULL` predating this ticket (e.g. `Helio Profit Breakdown`,
   created 2026-05-03, 2 columns: `date`/`profit`). Navigated to it live: renders at ~181px per
   column (table-layout:fixed stretches the two 160px-declared columns proportionally to fill the
   panel's actual width, per the CSS2 fixed-table-layout algorithm) — visually clean, no squashing,
   no oversized/broken layout (screenshot taken). This is a legitimate independent check beyond
   what evaluation-2.md covered (that report used only its own newly-created 30-column fixture).

3. **Independent live re-verification of the core drag-to-resize fix (not reused from the
   evaluator's browser session).** Loaded the same `HEL-254 Scroll Verification` dashboard fresh,
   dispatched a real `mousedown`→`mousemove`→`mouseup` sequence via `window` listeners (matching
   the component's actual event wiring) on a previously-untouched column (`col_1`). Result: style
   width and `getBoundingClientRect().width` matched exactly (160px → 320px), sibling columns
   (`col_0`, `col_10`, `col_11`...`col_29`) were confirmed byte-unchanged in the same pass — no
   redistribution. Confirmed via `browser_network_requests` that a `PATCH /api/panels/:id` → 200
   fired. Reloaded the page (fresh navigation) and confirmed `col_1` rendered at 320px in both
   `style` and computed rect — persistence is real and user-visible, not just DB-level.

4. **Backend integration — read `TablePanel.scala`, `PanelRepository.scala`,
   `PanelRowMapper.scala`, `V53__panel_column_widths.sql` in full (diffed `00e8284..6e81104`).**
   `column_widths` is a nullable JSONB column; `PanelRowMapper.tableConfig`/`domainToRow` handle
   `None` gracefully via `.flatMap(parseColumnWidths).getOrElse(Map.empty)` /
   `if (widths.isEmpty) None else Some(...)`. Confirmed via direct `psql \d panels` that the
   column exists and is nullable, and confirmed via `select` that pre-existing rows have `NULL`
   `column_widths` without any decode error (verified live by loading their panels above).
   `Patch.isEmpty` (flagged as a design-gate non-blocking risk in skeptic-design-2.md) was in fact
   correctly updated to include `columnWidths.isEmpty` (`TablePanel.scala:48`).

5. **Full backend suite re-run fresh (not trusted from evaluation-2.md's paste):** `sbt test` →
   **1259/1259 passed**, 53 migrations applied cleanly including V53, no duplicate migration
   number conflicts (`V52`→`V53` sequential). `sbt "testOnly com.helio.domain.PanelSpec"` isolated
   run also green (51/51), including the cross-field-isolation cases (`columnWidths`-only patch
   leaves `dataTypeId`/`fieldMapping` untouched, and vice versa).

6. **Full frontend suite re-run fresh:** `npx jest` → **895/895 passed**; `npm run lint` → clean
   (zero-warnings policy honored); `npm run format:check` → clean; `npm run build` → succeeds
   (pre-existing >500kB chunk-size warning only, unrelated). `npm run check:schemas` → in sync.
   `npm run check:scala-quality` → clean (41 pre-existing soft-budget warnings only, same set
   evaluation-2.md cites, no new ones — `PanelRepository.scala` at 322 lines is the only file this
   change touched that appears in that list, consistent with a 12-line net addition).

7. **Pre-commit-hook bypass reasoning — verified legitimate, not just asserted.** Read
   `.husky/pre-commit` (runs lint, format:check, check:schemas, check:openspec,
   check:scala-quality, test) and `scripts/check-openspec-hygiene.mjs` in full: it fails specifically
   when an active change's tasks are 100% complete but not yet archived (`status === "complete"`),
   which is *expected* at this point in the pipeline (archiving is a distinct, later phase). Cycle 1's
   commit message (`860cd87`) states this exact reasoning explicitly and lists every other gate as
   passing fresh before the `-n` bypass — consistent with the hygiene-check's actual code, and with
   the stated precedent across prior tickets (HEL-251/254/252/293/295/296/297). This is a legitimate,
   narrowly-scoped bypass, not a substantive-gate skip, and both commits (`860cd87`, `6e81104`)
   document it/its non-recurrence transparently.

8. **HEL-255 scope boundary — no accidental config-UI surfacing.** Opened the "..." panel-actions
   menu (Rename/Customize/Duplicate/Delete — no width control) and the "Customize" (expanded) panel
   view for a real Table panel live; no dropdown, reset button, or any width-configuration affordance
   exists anywhere in the UI. The only user-facing surface for this feature is the drag handle itself
   plus the new keyboard nudge — exactly matching the ticket's Non-Goals and the recorded HEL-255
   boundary decision.

9. **Git hygiene** — `860cd87`/`6e81104` have clean, ticket-prefixed, descriptive commit messages
   (`git log`); no WIP/fixup commits; each cycle's commit accurately describes what changed and why.
   `git status` on the worktree shows nothing unexpected (only `workflow-state.md` mid-flight edits
   and the new `evaluation-2.md`, both expected pre-archive artifacts, not stray files).

10. **DESIGN.md token compliance** — `DataGrid.css`'s new rules use only existing tokens
    (`--space-2`, `--app-border-strong`, `--app-transition`, `--app-accent`); the new
    `:focus-visible` rule (`outline: 2px solid var(--app-accent); outline-offset: 2px`) is a
    verbatim match of DESIGN.md's own mechanical global focus rule (DESIGN.md:219), not a bespoke
    pattern. Light-theme parity checked live via the in-app theme toggle — table/resize-handle
    render correctly in light mode (screenshot taken), no light/dark-specific regression found.

11. **DoD traced item-by-item to evidence:** drag handle on right edge (`DataGrid.tsx:217-234`,
    live-confirmed) · 60px minimum (`MIN_COLUMN_WIDTH`, live-confirmed via a shrink-drag) ·
    debounced persistence via the existing PATCH path (`TableRenderer.tsx`'s 400ms ref+setTimeout,
    network-confirmed) · independent per-column resize, no redistribution (live-confirmed, sibling
    columns byte-identical across two independent drag tests) · preview variants expose no resizing
    (live-confirmed on 2 of 5 preview surfaces + source-grep on all 5).

### Minor gap noted, not blocking

- The codebase's own established precedent for a new persisted `TablePanelConfig` field
  (`aggregation`, added via the exact `V43` migration this change says it followed "exactly") has a
  dedicated `ApiRoutesSpec.scala` HTTP-route-level PATCH round-trip test (`ApiRoutesSpec.scala:1255-
  1336`, `2018-2063`). `columnWidths` has no equivalent route-level test — only the domain-level
  `PanelSpec.scala` coverage plus this change's own live/manual verification (mine and cycle 2's).
  The route/service dispatch layer is fully generic and shared with `fieldMapping`/`aggregation`
  (low risk of a columnWidths-specific silent break), and I independently confirmed the full
  HTTP→DB round-trip live and via direct `psql` inspection, so I am not treating this as blocking —
  but it is a real, actionable inconsistency with the change's own stated precedent, worth a
  follow-up test for future-regression protection.

### Verdict: CONFIRM

Every DoD item, the cycle-1→cycle-2 fix, the HEL-255 scope boundary, the backend persistence
integration, and DESIGN.md compliance were independently re-derived from source, a live browser
session I drove myself, and fresh gate re-runs (1259 backend + 895 frontend tests, lint, format,
schema/scala-quality checks, build) — all green, all consistent with the evaluator's claims and
with no new defect found. This ships.

### Non-blocking notes
- Consider adding an `ApiRoutesSpec.scala` PATCH-route test for `columnWidths` (see above),
  mirroring the existing `fieldMapping`/`aggregation` route-level tests, for regression protection
  the domain-level `PanelSpec.scala` coverage doesn't provide.
- Carried over from cycle 2 (still valid, still non-blocking): `DataGrid`'s `liveWidths` local state
  has no reset-on-`panelId`-change guard — independently confirmed not reachable today, since
  `PanelGrid.tsx:239` keys each panel card by `panel.id`, forcing a full unmount/remount of
  `DataGrid` on panel-identity change.
