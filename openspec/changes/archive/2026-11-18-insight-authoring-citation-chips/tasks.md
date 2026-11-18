## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; never run env-dumping commands. Scripts may read scripts/concertino/.concertino.env but never print it.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; delete DB residue only by exact id with the guarded buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout 600000 on long calls; use sbt testFull, never bare sbt test.
- [C6] RED FIRST: tests before code, red runs recorded in red-evidence.md; every guard has a recorded mutation in mutations.md.
- [C7] Never display cost, model or tokens on any insight surface. No live model call; no production backdoor for rendering.
- [C8] Before any Playwright probe, confirm the page URL and port are this lane's DEV_PORT (7176) / BACKEND_PORT (10083).
- [C9] Scratch and screenshots go in .concertino/scratch/HEL-1744/.
- [C10] Do not duplicate HEL-1743 (L4) code: no render trigger, no refresh endpoint, no model key.

## 1. Red first

- [x] 1.1 Write the jest tests for D1-D7 (picker drift flip, insight card defaults/existing values/config build and patch/limit/upsell, service allow-list mapping, sanitizer hostile markdown and unknown marker, chip accessible name and popover open/focus/return in jsdom, state derivation table incl. viewer collapse and unknown status, footer render time, refresh re-fetch) and run them red; paste the failing lines into red-evidence.md.
- [x] 1.2 Write the backend spec case for D8 (placed / unplaced / placed on another dashboard) and run it red with `sbt -J-Xmx3g testFull` scoped to the spec; record in red-evidence.md.
- [x] 1.3 Write `e2e/hel1744-insight-panel.spec.ts` and `e2e/support/insightSeed.ts` per D9 and run it red against the unchanged UI; record in red-evidence.md.

## 2. Output editor

- [x] 2.1 D1: add insight to the create picker; flip the jest drift test, the backend OutputKindDriftSpec picker case and the openingState test. Verify: jest outputKindDrift + OutputEditorSheet tests green AND `sbt -J-Xmx3g "testOnly *OutputKindDriftSpec"` (via testFull-equivalent that cannot report a cached zero-test pass) green.
- [x] 2.2 D2/D3: InsightKindFields, sameInsightNode (two-root test), pipeline-owner-keyed upsell, reads.windows preservation (four cases), readInsightConfig, params, buildOutputConfig and configPatch cases, saveBlocked >8, free-tier note, model-selector slot comment. Verify: 1.1 editor tests green.

## 3. Insight panel

- [x] 3.1 D4: insightService + allow-list mapping + useInsight with run-terminal re-fetch. Verify: service/hook tests green.
- [x] 3.2 D5: InsightMarkdown with remarkCitationChips. Verify: sanitizer tests green.
- [x] 3.3 D6: extract the provenance popover host, refactor ProvenanceTrigger onto it, add CitationChip. Verify: new chip tests plus every existing ProvenanceTrigger*/usePortalPopover test green unmodified.
- [x] 3.4 D7: usePipelineOwnership, InsightPanelBody states keyed on pipeline ownership, no rows fetch for insight panels, role="status" on InsightNotRenderedState, footer render time, panel refresh re-fetches the insight, in every chrome site (PanelCard, MobilePanelStack, fullscreen, detail modal, public viewer). Verify: state tests and PanelContent tests green.

## 4. Backend public panelId

- [x] 4.1 D8: resolver map, protocol, schema. Verify: 1.2 green; existing OutputInsight public/schema specs green; `npm run check:schemas` green.

## 5. Verification

- [x] 5.1 Record each D10 mutation (command + failing line) in mutations.md, then restore.
- [x] 5.2 Run e2e/hel1744-insight-panel.spec.ts green (light/dark, desktop/phone), plus the full affected specs: hel1756-popover-viewport-fit, hel1632-live-output, hel1705-live-output-refresh, hel1733-draft-outputs-shapes, hel1189-output-panel-controls-live, hel1510-output-editor-table-overflow. Record results.
- [x] 5.3 D11 visual check in the running app (light/dark, desktop/phone), screenshots under .concertino/scratch/HEL-1744/, findings in visual-check.md.
- [x] 5.4 Full gates: npm run lint, npm run typecheck, npm test (frontend, maxWorkers 3), sbt testFull (full backend suite, since OutputKindDriftSpec and the public insight specs are touched), check:schemas; then commit through the pre-commit hook. Write files-modified.md.
