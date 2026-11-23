## 1. Inventory and red tests

- [x] 1.1 `cd frontend && nice -n 19 npm ci`; re-derive the edit-affordance inventory with a script over the paths named in design.md, write `.concertino/runs/HEL-1794/evidence/edit-affordance-inventory.md` (every hit, its file:line, desktop/phone, and the gate it will get), and list any affordance missing from design.md's table — verify the file exists and every design.md row is matched
- [x] 1.2 Add the new API surface as inert stubs (design.md D4 "Red-first mechanics", C15: `canEditFromUi` true for every role, `editable`/`readOnly` accepted and ignored, viewer copy constants equal today's strings), then write `e2e/hel1794-viewer-read-only.spec.ts` (exact allow-list scan desktop+phone x light+dark with a seeded schedule, whole-flow network watch with the named read-only POST allow-list, viewer-cannot-create-draft, editor control) and the D4 jest tests including the copy table (hoist the role above `usePipelineDraft` per D2); run the full spec files against the lane DB servers and record the red runs in `red-run/red-e2e.txt` and `red-run/red-jest.txt` (each jest red quoting its failing ASSERTION line; zero compile/tsc failures) — then commit the stubs + red tests + evidence with `git commit -n`, naming the bypass in the commit message, before any implementation

## 2. Role predicate and draft guards

- [x] 2.1 Add `canEditFromUi` (design.md D1) and expose `page.canEdit` from `usePipelineDetailPage` — verify the truth-table jest test passes
- [x] 2.2 Guard `usePipelineDraft` mutators with `editable` (discard, re-base and kept-draft restore unguarded) — verify the hook jest tests (no draft for a viewer, kept draft restored and discardable)
- [x] 2.3 Guard `usePipelineDraftRouting` handlers (immediate and draft branches, temp-step path), the rename save, `handleToggleScheduleEnabled`, schedule dialog save/clear and `onRemoveRoot` — verify the routing jest test (no service call, no op)

## 3. Desktop and phone UI gating

- [x] 3.1 Header (desktop `PipelineSpineHeader`, phone `MobilePipelineHeader`): name as text, menu items omitted, empty menu not rendered, schedule chip and schedule menu items absent (owner PUTs a schedule in the e2e as a guard) — verify header jest tests for viewer/pending/editor/owner
- [x] 3.2 Spine: Add source, Add Outputs from a shape, + Add step hidden; `menuItemsFor` → `[]`, `reorderFor` → `undefined`; `SpineStepRow` renders no trigger/grip for them; `SpineSourceCard` read-only; New output hidden; memo comparators updated (HEL-1809) — verify spine/row/outputs jest + memoComparator tests
- [x] 3.3 `StepCardFocused` `readOnly` (actions hidden, fieldset disabled) and every escaping config control from 1.1 gated; `MobileStepSheet` title + empty actions menu — verify jest
- [x] 3.4 Read-only presentation: `step-focused__fieldset--readonly` and `output-editor-sheet--readonly` modifiers (full-opacity value text, default cursor, existing tokens only) — verify value-text contrast >= 4.5:1 light and dark with `e2e/support/stateContrastProbe.ts` selectors + `e2e/support/stateContrast.mjs` math, ancestor opacity included, recorded in evidence
- [x] 3.5 `OutputEditorSheet` `readOnly` (disabled fields, no Save/Delete/Add tail, Close, title), `PipelineDetailDialogs` passes it and compares `canEdit`; every viewer copy variant in design.md D3's copy table plus any found by 1.1's string grep — verify the copy jest assertions

## 4. Verification

- [x] 4.1 Run the new e2e spec plus `e2e/hel1661-*.spec.ts`, `e2e/hel1782-viewer-shell.spec.ts`, and every e2e spec whose title or selectors touch a changed accessible name (grep `e2e/`), full files, against the lane DB — all green; record screenshots (viewer desktop/phone light/dark, editor pending→resolved) under `.concertino/runs/HEL-1794/evidence/`
- [x] 4.2 Run the mutations in design.md D4 and record, per mutation, the named test that turns red, in `openspec/changes/pipeline-viewer-read-only/mutations.md`
- [x] 4.3 `npm run lint`, `npm run typecheck`, `npm run format:check`, and the full frontend jest suite (3 workers) green; commit

## Standing Constraints

- [C15] Red-first jest reds fail on an assertion, never on tsc: the red commit carries inert stubs of the new API surface (canEditFromUi true for every role; editable/readOnly accepted and ignored); any pre-commit hook bypass is named in the commit message and PR

## Lane constraints (driver, restated to every sub-agent)

- C1 never read/print any .env file (nor `.concertino.env`); no env-dumping commands; start servers only via `scripts/concertino/start-servers.sh`; never copy env files or directories containing them.
- C2 quoted heredocs only (`<<'EOF'`).
- C3 no pkill/pgrep/killall; exact PIDs; stop servers with `stop-servers.sh`; test residue by exact id; plain emails.
- C4 jest 3 workers, Playwright 2 workers total (never two Playwright batches at once), sbt -J-Xmx3g, nice -n 19.
- C5 Bash timeout 600000; polling loops well under it; no background run past the tool timeout.
- C12 red first with mutations; full spec files; commit the red run before implementation.
- C13 scratch only in the MAIN checkout's `.concertino/scratch/HEL-1794/`; TMPDIR for git hooks/test-gate-in-isolation = `/tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1794`.
- C14 lane DB `helio_hel1794` for servers, Playwright, cleanup and any DB-touching jest/hook run (`DB_USER=$USER`); backend started with `ANTHROPIC_API_KEY` exported empty.
- Shared Playwright MCP browser: check for an open dialog and that the page is on this lane's dev port (7226) before any UI result; never navigate another lane's page; discard drafts before navigating away.
