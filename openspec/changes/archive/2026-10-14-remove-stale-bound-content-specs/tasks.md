## Standing Constraints

- [C1] Every factual claim in every delta has a verification command and its output recorded in this change's `evidence.md`; a claim that fails verification is corrected to match ground truth, never the reverse.

### Backend

## 1. Verify delta claims (no backend code change expected)

- [x] 1.1 Verify markdown-panel deltas (config.content location, no top-level content, text keeps it, export round-trip; a stray `content` key on output/image/divider/form probed on BOTH create and update, each outcome recorded) from `PanelProtocol.scala`/`*Panel.scala` and a backend/route test; record commands+output in evidence.md
- [x] 1.1a Verify PATCH with `config.content` ABSENT leaves content unchanged (separate probe); record
- [x] 1.1b Verify PATCH with `config.content: null` returns `""` (separate probe, distinct from 1.1a); record
- [x] 1.2 Verify EVERY sentence of the mcp-panel-composition-tools deltas (incl. the divider exclusion reason in `scripts/lib/agentFacingPanelTypes.mjs`, five-type set in `proposal.ts` and the proposal schema; deleted kinds rejected; outputId/dataSourceId authority in `ProposalPanelSupport.scala`); record commands+output
- [x] 1.3 Verify the panel-cross-filtering delta quotes the narrowing requirement's header and target definition byte-exact (`grep -F` both quoted strings in `openspec/specs/panel-cross-filtering/spec.md`); record output
- [x] 1.4 Amend any delta wording a probe contradicts; re-run `openspec validate remove-stale-bound-content-specs --type change --strict` until it passes

### Frontend

## 2. Remove the dead TextRenderer bound path

- [x] 2.1 Prove (grep + call-graph) whether any path supplies non-null row data to a text panel; record in evidence.md
- [x] 2.2 Remove `data` prop, `MappedPanelData` import and `data?.content` read from `TextRenderer.tsx`; drop `data={data}` at `PanelContent.tsx`'s text branch; `npm --prefix frontend run typecheck` passes
- [x] 2.3 Delete any existing test that asserts the bound text path; record which (grep `TextRenderer`/text `data` in tests)

## 3. Single-file test command (item 4)

- [x] 3.1 Run root `npm test -- --testPathPatterns=dashboardsSlice` and `npm --prefix frontend test -- --testPathPatterns=dashboardsSlice` (nice -n 19, HELIO_JEST_MAX_WORKERS=3); record suites/tests counts for both in evidence.md
- [x] 3.2 If the root form does not narrow, change only CLAUDE.md's "Run a single test file" command lines to the narrowing form; else drop item 4 with the evidence

### Tests

## 4. Guard and gates

- [x] 4.1 Add a `PanelContent` guard test: text panel with `config.content: "LITERAL"` and non-null `data.content: "BOUND"` renders LITERAL and not BOUND; passes
- [x] 4.2 Mutation-prove 4.1: temporarily restore the bound read, record the red output, revert; record in evidence.md
- [x] 4.3 Run frontend lint, typecheck, and the panels Jest subset (max 3 workers) green; `openspec validate --strict` green
