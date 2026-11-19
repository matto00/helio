## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; no env-dumping commands; only scripts may read scripts/concertino/.concertino.env (never print it).
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; test residue deleted by exact id (buildUserDeleteSql); plain emails.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull, never bare sbt test.
- [C12] Red first with mutations; full spec files; red runs recorded and committed before implementation code (this overrides the "tests last" ordering rule).
- [C13] Scratch in .concertino/scratch/HEL-1781/; lane DB helio_hel1781 with DATABASE_URL (and DB_USER if needed) for start-servers.sh AND Playwright.
- [C14] No live model call: backend started with ANTHROPIC_API_KEY exported empty; ask tested via scripted transport / committed fixtures.
- [C16] A mutation counts as proof only if it reaches the tested path and the case goes red; a mutation left green is recorded as such, never as proof.
- [C15] Do not touch HEL-1784 files (FormRenderer.tsx, FormPanelView.tsx, PanelService submit, per-panel schema route, V146); no migration.

### Tests (red first)

- [x] 1.1 Add AskSeamSpec case: dashboard editor grant, no pipeline grant, cited answer -> 200 equal to ask-200-no-pin.json (D3b)
- [x] 1.2 Add the D4 RLS spec (role probe rolbypassrls=false, viewer rows+history data, no get_history_rows offered, pin null, owner control, payload refusal)
- [x] 1.3 Add/adjust unit tests: DashboardMetaRow.roles, CommandBar, AskAnswerCard/AskDrawer (D6); update tests asserting Ask hidden for grantees: DashboardMetaRow.roles.test.tsx "neither shares nor asks", CommandBar.test.tsx :278 and "viewer: no kebab at all" :283, e2e/hel1773-viewer-grantee-dashboard.spec.ts :333/:463
- [x] 1.4 Add e2e/hel1781-ask-shared-dashboard.spec.ts (D6) and update hel1773 e2e expectations on Ask
- [x] 1.6 Label backend cases 1.1/1.2 as guards proven by mutation (server already correct), not red-first; D3b mutation threads the asked board id through AskDataService.finish -> AskPinBuilder.build (record it); D4 uses AskApiHarness's NOBYPASSRLS role instead of TwoUserRlsApiFixture -- state that deviation in files-modified
- [x] 1.5 Red run recorded (jest only, 8 frontend cases red at base: red.txt; chip-selector warning red: red-cr1.txt). The e2e file was NOT run red at base; its red is recorded under the two mutations in 4.2. Backend cases are guards, not red-first.

### Backend

- [x] 2.1 Only if 1.2 exposes an RLS read defect: fix server-side with explicit check then privileged read (no RLS loosening)

### Frontend

- [x] 3.1 DashboardMetaRow: Ask button and kebab item for any selected dashboard; Share stays owner-only (D1)
- [x] 3.2 CommandBar: Ask kebab item for any selected dashboard (D1)
- [x] 3.3 AskAnswerCard: non-owned dashboard scope -> per-panel provenance source with mapped panelId; unmatched -> plain ordinal (D2)
- [x] 3.4 Confirm popover public variant makes no /api/outputs or /api/pipelines call; confirm public viewer renders no Ask entry

### Tests (green and mutations)

- [x] 4.1 Re-run every touched spec file in full (jest, sbt testFull for touched specs, Playwright full file) -> green
- [x] 4.2 Mutations run and recorded. Backend: AskPinBuilder `case _ => Some` -> seam viewer+editor red (M1); pin on dashboard access -> seam editor red (M2); AskGranteeRlsSpec: offer `get_history_rows` unconditionally -> red (RLS-A), AskPinBuilder `case _ => Some` -> red (RLS-C), skipping the grant check inside `historyRows` -> STAYED GREEN (RLS-B, not proof; the payload lookup is a second guard); removing that grant check AND the RLS-scoped `outputRepo.findById` in `payloadRows` -> payload-refusal case red (RLS-D). Frontend e2e (full hel1781 file): chip authenticated -> viewer desktop+phone red, other 3 green (e2e-mutation-a); Ask re-gated on isOwner -> viewer, editor, free red, owner green (e2e-mutation-b). Jest: chip authenticated and CommandBar Ask disabled red (run earlier, not persisted).
- [x] 4.3 Save and persist the RLS transcript (.concertino/scratch/HEL-1781/rls-ask.txt)
- [x] 4.4 Grep e2e/ for every selector/label changed; lint, typecheck, format
