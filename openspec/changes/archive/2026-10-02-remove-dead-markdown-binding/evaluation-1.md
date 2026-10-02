## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 266f1207cafa7c8d1a78857f0c92973c017ea267 against live-resolved base 8b0e9e05.

### Phase 1: Spec Review — PASS
- AC1 (UI no longer offers/saves rejected binding): met; verified live (below).
- AC2 (other surfaces reject with clear message): backend `validateFieldMapping` is the single funnel (OutputService create :141, merged PATCH :252, PipelineService mirror :676). Live: POST create and PATCH of a markdown Output with `fieldMapping.content` both return 400 "'markdown' has no fieldMapping slots (got: content); send an empty fieldMapping (a markdown Output's text is the literal config.content)". PatchSetUndoService has no `output` target kind at all (grep of restoreOne cases), so the undo-restore path cannot touch Output config. LIMIT: I did not independently drive the MCP/proposal/assistant/analyze surfaces with a request each; I rely on the shared-funnel reading above plus the executor's per-surface enumeration (not in the files I was given).
- AC3 (red on main, green after, mutation): I reverted OutputEditorSheet.tsx/OutputKindFields.tsx/buildOutputConfig.ts to main (8b0e9e05) keeping the new tests: 2 failed (the "literal-only ... saves an empty fieldMapping" test and the legacy-config test), 4241 passed. Restored via `git checkout HEAD -- <dir>`; tree clean. This is both red-on-main and the re-enable-mode mutation.
- AC4 (both themes, running app): done, see Phase 3.
- AC5 (no legacy rows in dev DB): query recorded in design.md D2 (not re-run by me; I created/deleted only my own rows). Legacy handling is covered by the new sheet test (red on main per above).
- Note: tasks.md 4.1 is still `[ ]`; it is now satisfied by this evaluation and the orchestrator/executor should tick it. Not a failure.
- Task 1.1 limit: the executor did not repro on main in a browser, and I did not stand up a main-tree frontend. I did not reproduce main's 400 through the UI. What I can state: the diff shows main's buildOutputConfig persisted `{content:"", fieldMapping:{content:<col>}}` for field mode, and the backend (unchanged logic, only the message differs) 400s any `fieldMapping.content` on markdown; I confirmed that 400 live on the current tree via curl (it is the same rejection main applied, with a better message). Renderer ignoring fieldMapping: PanelContent renders only `cfg.content` (unchanged by the diff).

### Phase 2: Code Review — PASS
Gates, run by me in WORKTREE_PATH: `npm run lint` clean; `format:check` clean; `npm test` 408 suites / 4253 tests pass; `npm --prefix frontend run build` succeeds; helio-mcp `typecheck` clean (helio-mcp has no test script; "helio-mcp tests" in task 3.2 do not exist as an npm target). `sbt testFull` was NOT re-run by me (instructed); I did not independently verify the backend red/green. Backend diff reviewed: small, pure, kind-parametrised message; stale doc comment fixed; no dead code, no TODOs. `BoundOrLiteralState`/`useBoundOrLiteralState` remain used by other kinds (lint/tsc clean, no unused imports). Test edits to buildOutputConfig.test.ts follow an owner-ruled contract change, acceptable.

### Phase 3: UI Review — PASS
Servers via canonical script; `readlink /proc/<pid>/cwd`: frontend (6571) -> .../HEL-1139/frontend, backend (9478) -> .../HEL-1139/backend. Dev login matt@helio.dev.
- Dark: New output sheet, Kind=Markdown: Content is a plain textarea, no mode toggle (`[role=group]` count 0; buttons only Cancel/Save). Literal save succeeded (row persisted `{content:"# HEL1139 literal\nHello **world**", fieldMapping:{}}`). A panel (type output) bound to it rendered `H1 "HEL1139 literal"`, `P Hello <strong>world</strong>`.
- Light (helio-theme=light): panel renders the heading/bold text; Edit sheet reopens literal with content, no toggle; edited and saved literal again OK (persisted "Hello **light**", fieldMapping {}).
- Console: only a pre-existing 404 for GET /pipelines/:id/schedule (no schedule set); no errors from the feature.
- Legacy config in the running app: not feasible with only my data (API rejects creating one by design); covered by the unit test, which fails on main.
- Evidence (persisted): /home/matt/Development/helio/.concertino/runs/HEL-1139/evidence/.evidence-tmp/hel1139-{dark-sheet,dark-panel,light-sheet,light-panel}.png
- Only the mechanical checks; visual-design judgment left to skeptic. Breakpoint resizing (1100/768/0) not exercised beyond the default 1280 viewport; the change is a single textarea row.
- Dev DB residue: created and deleted by exact id: output be8c05aa-cae4-4b74-b928-db0ac5207f72, panel b85a0e7a-37fb-45f4-8dac-9ed8623917ef, dashboard 3e3c5512-9837-4db0-8839-74ca84ed85fc (each confirmed 204/200; output absent from GET afterward). The two rejected create/PATCH probes created nothing. Browser localStorage theme restored to dark. Dev servers left running.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Tick tasks.md 4.1; record in the PR that Task 1.1 was not repro'd on main in a browser.
- Playwright wrote screenshots to the main checkout root (stray hel1139-*.png) and I moved them into the worktree before persisting; main checkout status is clean.
