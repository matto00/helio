## Standing Constraints

- [C1] The migration is V141 (driver decision; ledger V140 HEL-1755, V141 HEL-1740, V142 HEL-1742). Before merge, check the highest V-number on origin/main; if V141 is not above it, renumber to max+1, update references, re-run gates (Flyway has no outOfOrder).

## 0. Fail-first and site enumeration

- [x] 0.1 Add the route test POST insight Output -> 201; run it red (400) and record command + output in fail-first.md
- [x] 0.2 Re-enumerate every Output-kind site (incl. HEL-1733 draft files) and the six write paths; list in sites.md

### Backend

## 1. Backend

- [x] 1.1 OutputKind.Insight + fromString/asString + compiler-complete OutputKind.all; compile passes
- [x] 1.2 V141 widens outputs.kind CHECK (verify highest migration on main first); migration applies on dev DB
- [x] 1.3 InsightConfig.parse in domain/outputs with defaults; unit spec covers every key, range and default
- [x] 1.4 KnownKeys(Insight) + insight value validation in OutputConfigValidation, 400 naming the key; spec green
- [x] 1.5 InsightReadsCheck on validating paths 1-3 (design D4), only when reads is written/changed; restore paths 4-6 skip
- [x] 1.6 OutputBindingSpec.Insight, default panel size 6x3, node capabilities + parity fixture; KeysDoc excludes insight
- [x] 1.7 JSON schemas: insight in the five kind enums + node-capabilities prose + per-kind config docs (D8a)

### Frontend

## 2. Frontend

- [x] 2.1 Add insight to the Output kind type and an exported OUTPUT_KINDS; tsc passes. Exhaustiveness guard actually used: `OUTPUT_KIND_SET: Record<OutputKind, true>` plus a `const _exhaustive: never = kind` in OutputPreviewPane (the one dispatcher whose `kind` is typed `OutputKind`); the other dispatchers (OutputPanelContent, LiveOutputRender) take `kind: string` from the wire, so each is pinned by a jest test + recorded mutation instead
- [x] 2.2 InsightNotRenderedState in OutputPanelContent and LiveOutputRender; rawRows ignored, no new endpoint
- [x] 2.3 Editor: picker excludes insight; existing insight opens without crash; config passes through unchanged
- [x] 2.4 crossFilterRows / nodeCapabilities / outputSheetDraft / OutputPreviewPane handle insight like markdown

### Tests

## 3. Tests

- [x] 3.1 Route specs: unknown key, foreign reads.outputs, self read, >8 reads, bad window, bad refresh -> 400 naming key
- [x] 3.2 Reads check per validating path; insight-reads-insight 400; dangling-reads PATCH {prompt} 200; rollback not refused
- [x] 3.3 OutputSummaryReducer spec: insight summary has null metric and series
- [x] 3.4 OutputKindDriftSpec (backend) + outputKindDrift.test.ts (frontend) per design D8; both green
- [x] 3.5 drift-mutations.md: one recorded red run per pinned site and one per exclusion; sources restored after
- [x] 3.6 Jest component tests: insight panel and live column show "Not yet rendered"; KeysDoc specs updated
- [x] 3.7 Grep proof of no model call: no ClaudeClient/InsightModelClient reference in the diff
- [ ] 3.8 (NOT RUN, environmental: shared dev DB has a migration above V141, Flyway refuses it out-of-order so the backend cannot boot; covered by jest component tests) Manual UI check: insight placed on a dashboard, light + dark, desktop + phone; screenshots under scratch
- [x] 3.9 Delete own dev-DB residue (pipelines/outputs/dashboards created for checks) by exact id; list ids
