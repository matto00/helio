## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `6b224f1b520d9c8cbf0842394c496820ed80858b` against the live-resolved base `a867001d7b1c4c1484fc587ef34291552403885f`
(`resolve-review-base.sh`). Commits: `9f572d202` (red tests), `6b224f1b5` (implementation).
Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1788/evidence/.concertino/scratch/HEL-1788/`. Every
evidence file below is under that directory and was persisted with `persist-evidence.sh` when it was captured.

### Phase 1: Spec Review — PASS
- AC1 (caption for a non-owner, desktop and phone, light and dark): met. The text is "Your net change this session".
  design.md D3 explains why it differs from the ticket's example, which the ticket permits. It renders for an editor at
  1440, 1100, 768 and 390 px in both themes; see Phase 3.
- AC2 (owner unchanged): met. With `tallyCaption` undefined and `zeroCounterSeed=false`, the owner's code path renders
  what it rendered before. Live check: the owner shows `aria-valuenow=10` (its `initialValue`), no caption and no
  `aria-describedby`.
- AC3 (no `/api/data-sources/*` from a non-owner's page): met. The network log over load, a `+` click (`POST
  /api/panels/:id/submit` 201) and a reload has 0 data-source requests (`eval-editor-network.txt`). The jest test
  "makes no /api/data-sources request while captioned" and the e2e `seen.dataSourceRequests` assertion also cover it.
- AC4 (a test that fails first): met, and I re-ran it myself. In a throwaway worktree detached at `9f572d202`, the two
  jest files give `Test Suites: 2 failed; Tests: 4 failed, 9 passed`. FormFieldControl.test fails at compile time with
  TS2322 on the unknown `tallyCaption` prop. FormPanelView.nonOwner fails 4 assertion tests: caption, zero seed,
  no-data-source and re-seed. This matches the executor's `red-e2e.txt`/`red-jest.txt`. The red commit (22:51:55)
  comes before the implementation commit (22:57:24). It contains only tests plus the caption constant file.
- Scope: frontend only, no out-of-scope changes. `openspec/changes/archive/**` is untouched. Constraints in
  workflow-state.md: `CONSTRAINTS: []`.
- Tasks: everything is ticked except 3.3 (screenshots), which is honestly left unchecked. This evaluation captured that
  evidence (see Phase 3).

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: all files pass.
- `npm --prefix frontend run typecheck`: exit 0.
- `npm test` (3 workers): root 70/70 suites, 617 tests; frontend 873/873 suites, 10315 tests. Exit 0.
- `npm --prefix frontend run build`: exit 0.
- No backend files changed, so `sbt testFull` was not required.

D6 mutation probes. I ran these myself in a throwaway detached worktree at HEAD, then removed it. The form-folder
jest baseline is 84/84 passing.
- M1: `tallyCaption` always set (owner gate dropped). 2 failed.
- M2: `describedBy` no longer appends the caption id. 3 failed.
- M3: `zeroCounterSeed` forced false (seed strip dropped). 2 failed.
- M4: `#zero` dropped from `fieldsKey` (no re-seed when ownership resolves late). 1 failed.

Code quality:
- Tokens only: `--text-sm` and `--app-text-muted`.
- The caption string is a single exported constant.
- The id is appended to `aria-describedby` after the existing error or hint id, never in place of it. Both cases are
  tested.
- `CounterControl` markup is unchanged.
- No `any`, no dead code, no TODOs.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` on 7220/10127 against the lane database `helio_hel1788`. That database
did not exist, so I created it and Flyway migrated it (142 rows in `flyway_schema_history`). The backend ran with
`ANTHROPIC_API_KEY` set to empty. The servers have been stopped.

Fixture: an owner and an editor grantee, plus a compact counter with `step: 5, initialValue: 10`.
- Editor at 1440, light: value 0, not 10. Caption visible (`eval-editor-desktop-light.png`). After one `+` the value
  is 5 and the submit returns 201. After a reload the value is 0 again.
- Editor at 1440, dark: `eval-editor-desktop-dark.png`.
- Owner at 1440, light: value 10, no caption (`eval-owner-desktop-light.png`).
- Accessibility: `aria-describedby` points at exactly the caption's id, and the resolved description is "Your net
  change this session". DOM and reading order is label "Widgets", then Decrease, then spinbutton (valuetext "0, step
  5"), then Increase, then the caption paragraph. The caption is not focusable and adds no tab stop.
- Contrast, measured from rendered device-scale pixels at the default panel opacity (computed opacity 1), using the
  WCAG relative-luminance formula on the darkest glyph pixel against the dominant background pixel:
  - Light: text rgb(100,94,86) on rgb(253,252,250), **6.25:1** (`eval-editor-caption-light.png`).
  - Dark: text rgb(170,164,156) on rgb(26,24,22), **7.17:1** (`eval-editor-caption-dark.png`).
  - Phone (390 px): identical values in both themes (`eval-editor-caption-phone-light.png`,
    `eval-editor-caption-phone-dark.png`).
  - All are at or above 4.5:1.
- Breakpoints: no horizontal overflow at 1440, 1100, 768 or 390 (`scrollWidth` equals the viewport width).
- Console: 0 errors and 0 warnings across the whole session.
- E2E, all four files run in full with 2 workers: hel1784 (all 7, including the new owner test), hel1088, hel1087 and
  hel1090. Result: **17 passed** (`eval-e2e.txt`).

**Pre-existing defect (not caused by this change, does not block):** in the single-column `mobile-panel-stack` (390,
768 and 1100 px with the sidebar open), a compact-counter form card collapses to 30–42 px tall and clips its own
content. Only the title shows. The counter, and therefore the caption, sits inside the card's `overflow-y: auto`
`.panel-content--form` and is only seen by scrolling inside the card. Measurements:
- The **owner's** card is the same 30 px at 390 and 42 px at 1100, with no caption present. The owner's code path is
  unchanged by this diff, so the defect predates it.
- `computeMobilePanelHeight` returns `height: null` (intrinsic) for `form`.

The likely cause, not probed, is container sizing on `.panel-grid-card`. Screenshots: `eval-editor-phone-dark-fresh.png`
(as loaded), `eval-editor-phone-dark.png` and `eval-editor-phone-light.png` (scrolled to the caption), and
`eval-editor-1100-light.png`. The caption is present and correctly associated on phone, so AC1 is satisfied as far as
this change can satisfy it. The phone stack still shows the editor (and the owner) a clipped counter.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- File a follow-up for the pre-existing phone-stack form-card collapse above. On phone it hides the tally and the
  caption for every user, so the owner's "on phone" intent is only fully met once it is fixed.
- design.md D3a describes the mechanism as "FormPanelView passes useFormPanelValues the compact counter field with
  `initialValue` removed (memoised)". The implementation instead passes a `zeroCounterSeed` flag
  (`useFormPanelValues.ts` `seedValues`/`fieldsKey`; `FormPanelView.tsx`
  `useFormPanelValues(config.fields, schema ?? [], isCompactCounter && !isFormOwner)`). Behaviour is equivalent. Reword
  D3a before archive so the artifact matches the code.
- Tick task 3.3 and cite this report's evidence files.
