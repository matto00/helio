## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed explicitly:
  - "Reading a dashboard through the MCP `get_dashboard` tool yields panels each with a stable `id`" — verified: `helioApi.ts#getDashboard` spreads `snapshot.panels` verbatim, and the backend now emits `id` on every export panel entry, so this flows through without MCP-side logic changes (confirmed live via a real export call: `id == snapshotId == <real panel id>`).
  - "Export snapshot still round-trips through import unchanged" — verified via live import of an unmodified fresh export (existing tests) and via a hand-built legacy payload (see Phase 3).
  - "If `id` is added to the export wire, it equals the panel's real id and is additive" — verified in code (`fromDomain` sets `id = Some(panel.id.value)` alongside unchanged `snapshotId = panel.id.value`) and live (`samplePanel.id === samplePanel.snapshotId`).
  - Test coverage AC — met: `ApiRoutesSpec` asserts `id == snapshotId == panel.id.value` on export, and a dedicated test imports a snapshot with `id` stripped from every panel entry and asserts success.
  - helio-news simplification AC — correctly deferred to a spinoff (helio-news is a separate repo outside this monorepo's git tree); design.md D6 documents this explicitly, matching the orchestrator pre-brief's guidance.
- No AC silently reinterpreted. The ticket's "Preferred" path (additive server-side `id`) was chosen, with design.md D1–D6 documenting why this also satisfies the "Or" (MCP-side normalization) path for free — a legitimate synthesis, not a reinterpretation.
- All 25 task items in tasks.md are marked done and match what was implemented (verified by diff read, not just the checkbox).
- No scope creep: `git diff main...HEAD --name-only` touches exactly the files enumerated in files-modified.md/design.md's Impact section — backend protocol + 3 test files, 2 helio-mcp files, 1 frontend type file, plus the changeset's own planning docs. No `DashboardSnapshotRepository`/`DashboardServiceValidation` edits (confirmed empty diff on both), consistent with "verify unaffected, don't touch."
- No regressions: full `ApiRoutesSpec` + `AggregatorRegressionSpec` + `DashboardSnapshotValidationSpec` suite (213 tests) passes; live UI smoke test of export/import round-trip and a stripped-`id` legacy-payload import both succeed against the running dev server.
- No schema file changes — correctly justified (D4): no `schemas/*.schema.json` covers this wire shape today, `check:schemas` passes clean (29 protocols checked, in sync).
- Planning artifacts (design.md, spec delta) accurately reflect the final implemented behavior — cross-checked field-by-field against the diff; no drift found.

### Phase 2: Code Review — PASS
Issues: none.

- **CONTRIBUTING.md mechanical compliance**: `npm run check:scala-quality` exits clean (0 inline-FQN violations introduced; the 70 pre-existing file-size soft-budget warnings are informational-only per policy and none newly attributable to this diff — `DashboardProtocol.scala` is 223 lines, well under the 250-line soft budget). Imports in the touched file are all top-of-file (`backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala:1-6`), no inline FQNs added. `npm run check:schemas` and `npm run check:openspec` both pass (the latter's only flag is "complete but not archived," expected at this workflow stage, not a code issue).
- **Per-domain JSON formatters** rule honored: the new `id` field's format lives in `DashboardProtocol.scala`'s own `dashboardSnapshotPanelEntryFormat` (`jsonFormat5` → `jsonFormat6`), not added to the aggregator directly.
- **DRY**: no duplication introduced; the `fromDomain` change is a single added line (`id = Some(panel.id.value)`) reusing the same source value as `snapshotId`.
- **Readable**: field ordering (`snapshotId`, `id`, `title`, ...) matches `jsonFormat6`'s positional requirement; the field-level Scaladoc on `DashboardSnapshotPanelEntry` (lines ~70-75) and inline comments in `dashboard.ts`/`types.ts` clearly state intent and the decode-tolerance rationale. No magic values.
- **Type safety**: `Option[String]` is the correct type for decode-tolerance (verified: spray-json's `jsonFormatN` requires an `Option` wrapper for a field absent from older payloads to decode as `None` rather than throwing `DeserializationException`); TS mirrors use `id?: string`, consistent with existing `?`-optional conventions in both files.
- **Error handling**: import path correctly ignores `id` entirely (verified `DashboardSnapshotRepository.scala` and `DashboardServiceValidation.scala` diffs are empty — both still pattern-match exclusively on `entry.snapshotId`); no new failure mode introduced on old-format payloads (verified live, see Phase 3).
- **Tests meaningful**: the new `ApiRoutesSpec` test explicitly constructs a legacy-shaped payload by stripping `id` from every panel entry of a real export and re-imports it, asserting `201 Created` and correct panel count — this would catch a real regression (e.g., an accidental required-field encoding). The `DashboardSnapshotValidationSpec` helper defaulting to `id = None` doubles as validation-layer coverage. The `AggregatorRegressionSpec` round-trip test was correctly updated for the new required constructor arg.
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff.
- **No over-engineering**: correctly rejected a versioned envelope and a new schema file (D3, D4) — proportionate to a single additive field.
- **Behavior-preserving**: this is additive, not a refactor; `CurrentVersion` intentionally not bumped (still `2`, verified at `DashboardProtocol.scala:186`), consistent with D3's reasoning that old exports remain valid version-2 payloads.
- Backend test suite: 213/213 passing (`sbt "testOnly com.helio.api.ApiRoutesSpec com.helio.api.protocols.AggregatorRegressionSpec com.helio.services.DashboardSnapshotValidationSpec"`).
- Frontend: `dashboard.ts`-scoped Jest suite (46 tests, 5 suites) passes; `eslint src --max-warnings=0` clean.
- helio-mcp: `npx tsc` (its actual build script) compiles clean.

Note (non-blocking): a raw `npx tsc --noEmit` in `frontend/` surfaces ~55 pre-existing type errors in unrelated files (`toastListeners.ts`, `listenerMiddleware.ts`, `env.ts`) that are not touched by this diff and are not part of the project's actual gates (`npm run build` uses `vite build`, not raw `tsc`). Confirmed pre-existing, not caused by this change — not a change request.

### Phase 3: UI Review — PASS
Triggered by `frontend/**` changes (type-only). Dev servers started cleanly via `scripts/concertino/start-servers.sh` + `assert-phase.sh servers` → `PASS servers`.

- **Happy path**: live export of an existing 4-panel dashboard via the authenticated dev session returns `200 OK` with each panel entry carrying `id == snapshotId == <real panel id>` (e.g. `"id": "c6d29025-3c78-4742-9c25-b7cfc9636c8f"`).
- **Backward-compatibility path**: took that same live export, stripped `id` from every panel entry (simulating a pre-existing exported file), and POSTed it to `/api/dashboards/import` — returned `201 Created`, correct dashboard name, correct panel count (4), fresh panel IDs assigned. Cleaned up the created test dashboard afterward (`DELETE` → `204`).
- **No console errors** on normal page load/reload (0 errors, 0 warnings). The only console errors observed were from my own two manual `fetch()` probes before I added the required `X-Helio-Requested-With` CSRF header (`httpClient.ts:14`) — expected CSRF enforcement working correctly, not an app defect, and not present during normal UI-driven flows.
- No visible UI surface changed (type-only frontend edit, per design.md's own risk assessment) — no component/breakpoint checks applicable; this was confirmed rather than assumed by grepping for any FE logic branching on `id`/`snapshotId` (none found beyond the type declaration).

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- None beyond the pre-existing, unrelated `tsc --noEmit` drift noted in Phase 2 (informational only; not caused by this change, not part of the project's actual gates).
