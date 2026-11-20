## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `cf1d120d289e0cfc7d6d06d7db1b4b8162f05548` against base `894a72c565e06afc90bde4c4fd0f56cf86b31164`. The base was resolved live with `resolve-review-base.sh`. There are three commits: the guard red, the e2e red, then the gating.

### Phase 1: Spec Review — PASS
Issues: none.

- **AC1 (every `:hover` gated or allowlisted).** On HEAD the new guard `frontend/src/featureHoverGating.css.test.ts` passes. Its allowlist has exactly one entry, the DashboardList reveal.
  - My own scan (`.concertino/scratch/HEL-1735/eval/gated-nonhover.mjs`) covers the 62 changed stylesheets. It found 173 rules inside `@media (hover: hover)`. Every gate is the innermost at-rule. No gated rule has a non-hover selector, so no focus, active or selected rule was pulled into a gate.
  - A second scan (`gated-decls.mjs`) found no gated rule that sets display, visibility, opacity, clip, size, position, pointer-events or overflow. No reveal was gated as if it were a fill.
  - The only `:hover` in TS/TSX is a comment (`PipelineListTable.tsx:131`). There are no stylesheets outside `frontend/src`.
- **AC2 (the guard covers them).** The guard walks `frontend/src/**/*.css` and excludes `shared/` and `PIPELINE_GUARDED_FILES`.
  - It includes a rot check, non-vacuity floors, and a check that every pipeline-guarded file exists.
  - The red commit `16619916b` contains no stylesheet edits. Its transcript fails on the ungated selectors.
  - The mutation transcript shows 62 of 62 single un-gates failing and naming the file and selector. The mixed-list, allowlist-rot and new-file mutations also fail.
- **AC3 (desktop unchanged).** I re-ran the D5(a) structural check myself: 62 files, 1438 groups, 0 differing.
  - Its three committed detection mutations each fail the check. The desktop e2e fixture is identical between red commit `e7d50ef45` and HEAD (`git diff e7d50ef45 HEAD -- e2e` is empty), and it passes on HEAD.
- **Tasks.** All tasks are ticked and match the diff. DESIGN.md §5 names the third guard and drops the "not yet covered" sentence (D8).
- **Constraints C1–C5:**
  - C1 is honoured: both red runs were committed before any stylesheet edit.
  - C2: only red instances are asserted; P2, P3 and T4 are probe-only.
  - C3: `git diff` is empty for hel1675-shared-hover, `e2e/support/**`, every HEL-1789 split spec, `frontend/src/shared/**` and the nine pipeline files.
  - C4: the reveal keeps its touch path.
  - C5: desktop reads go through `trackPointer`, `settleToRest` and `settleToHover`, imported only.

**Deviations verified:**
- **One reveal render site.** Verified. `SidebarItemList.tsx:440` renders `ActionsMenu` only when `onDelete !== undefined`. Its only consumer, `AssistantContextList.tsx:82`, passes no `onDelete`. `DashboardList.tsx` is the only other `.dashboard-list__item-row` with an actions menu; `SidebarRowsSkeleton` has none. The live probe agrees: the conversation row has 0 popovers.
- **D5(a) merge applied to the before side.** Sound. Only adjacent entries with the same chain and byte-equal declarations merge, so it cannot hide a reorder between different declarations. Mutations (ii) and (iii) still fail under it. My non-hover-in-gate scan independently closes the one gap the normalization has: stripping `@media (hover: hover)` would otherwise make a non-hover rule wrongly placed inside a gate look equal.
- **Pre-existing test edits change no behaviour assertion:**
  - `tokenAuditSweep.css.test.ts`: the three shifted lines hold byte-identical literals. Base and HEAD were compared line by line: `gap: 2px;`, `padding: 4px 4px;` and `padding: 2px;`.
  - `shell.css.test.ts`: `split("{").slice(-2)[0]` returns the same selector as `split("{")[0]` for an un-nested rule. For a gated rule it returns the rule's own selector, not the media prelude. The expected values did not change.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates were run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: all files formatted.
- `npm run typecheck`: exit 0.
- `npm test` (3 jest workers, nice 19): exit 0. Root jest ran 70 suites and 617 tests; frontend jest ran 874 suites and 10320 tests, all passing.
- `npm --prefix frontend run build`: exit 0.
- No backend files changed, so `sbt testFull` was not required.

Code checks:
- `PIPELINE_GUARDED_FILES` is extracted once. The pipeline guard re-relativizes each entry, so its allowlist and assertions are byte-identical (DRY).
- The pure CSS wrapping is mechanical and preserves behaviour, as proven above.
- The design-standard [mechanical] rules are unaffected: no token or value changed. The structural check found byte-equal declaration blocks.

### Phase 3: UI Review — PASS
Issues: none.

Setup:
- Servers were started with `start-servers.sh` on ports 7167 and 10074, with the lane DB `helio_hel1735` and `ANTHROPIC_API_KEY` empty. `assert-phase servers` returned PASS.
- Servers were stopped with `stop-servers.sh`.

Runs:
- `e2e/hel1735-feature-hover.spec.ts`, `hel1675-shared-hover.spec.ts` and `hel1790-hover-probe.spec.ts`: 16 passed.
  - Touch P (390x844) and T (1024x768) were green in light and dark.
  - The desktop hover fixture matched at 390 and 1280, in both themes.
  - Reveal: on the dashboard row, a row tap widens the trigger from 3x24 to 24x24, and tapping the trigger opens the menu.
- Additional blast-radius specs the executor did not run: hel1782-viewer-shell, hel813-mobile-touch-target-floor, focus-presence-guard, hel1003-actions-menu-keyboard-reach, hel510-keyboard-shortcuts and hel1762-popover-clears-bottom-nav. All 62 passed.
- The executor's D7 runs cover the HEL-1789 split specs (run only, not edited).

Red on unchanged CSS (`e2e-red-run-main-css.txt`):
- I did not re-run this myself. It was corroborated in two ways:
  - **Commit content:** `e7d50ef45` touches only the spec and evidence files.
  - **Values:** the sticky values in the transcript equal the independently committed DESKTOP_HOVER fixture. For example, T5 dark gives `rgb(38, 35, 32)`.
- Six instances were red, four of them in context T, which meets D6's escalation thresholds.

Breakpoints and layout:
- The change cannot alter layout on any breakpoint. No non-hover rule moved into a gate, and every declaration block is byte-equal.
- The e2e runs exercised 390, 1024 and 1280.
- No evidence artifact beyond this report is load-bearing, so nothing extra was persisted.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `e2e/hel1735-feature-hover.spec.ts:487-490` and `:523`: the describe header comment and the test title still say the reveal "has two render sites" and "both render sites", but the body (and files-modified.md) establish there is one. Reword the header and title to match the single render site plus the guard probe on the Assistant row.
- `e2e/hel1735-feature-hover.spec.ts:528-533`: replace `const credentials = await registerAndLogin(...); void credentials;` with a plain `await registerAndLogin(...)`. The binding is never used.
- `e2e/hel1735-feature-hover.spec.ts` is 570 lines, well over CONTRIBUTING's ~250 soft budget. Lines 217-440 are the DESKTOP_HOVER fixture data. Move them into an `e2e/support/hel1735DesktopHover.ts` (or JSON) module, or note the split in the PR description as CONTRIBUTING asks.
