## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `371d0a417e096389aea1955c85656e8d3736bec4` (HEAD at time of review, matches
the evaluator's claimed cycle-2 commit).

### What I verified (with evidence)

**Artifacts read in full**: ticket.md, proposal.md, design.md, tasks.md, both spec deltas
(`specs/output-panel-placement/spec.md`, `specs/output-panel-controls-editor/spec.md`),
files-modified.md, evaluation-1.md/-2.md, both skeptic-design reports.

**Gates re-run myself, fresh, this session** (not trusted from the evaluator's word):
- `npx openspec validate output-panel-control-config --type change` → `Change ... is valid`.
- `npm run lint` (frontend) → clean, zero warnings.
- `npm run typecheck` (frontend) → clean.
- `npm test` (frontend, full suite) → `Test Suites: 363 passed, Tests: 3906 passed`.
- `sbt test` (backend, full suite) → `Tests: succeeded 4917, failed 0`. Includes the new
  `OutputControlEligibilitySpec`, `PanelServiceOutputControlsSpec`, `PublicDashboardRoutesSpec`'s
  4 new orphan tests (real `EmbeddedPostgres`, not mocked), `PanelRowMapperSpec`,
  `OutputPanelSpec`.
- No flake observed on any suite; nothing to record per C5.

**Diff read directly against the live-resolved base** (`resolve-review-base.sh` →
`a6e603a1229cb1c7d1737c08d2ac88ff5355a92f`), `git diff` file-by-file for every backend file
touched: `OutputPanel.scala`, `OutputControlEligibility.scala`, `OutputControlsValidator.scala`,
`PanelService.scala`, `PanelProtocol.scala`, `PublicDashboardRoutes.scala`, `ApiRoutes.scala`,
`V112` migration, `panel.schema.json`. Also read `outputControlEligibility.ts` (TS mirror),
`outputControlEligibilityDriftGuard.test.ts` (confirmed it genuinely regex-parses the Scala
source file, not a hand-copied assertion), `OutputControlsEditor.tsx`,
`OutputControlRow.tsx`, `useOutputControlsEditorState.ts`, `panelService.ts`/`panelThunks.ts`
wiring, and the e2e spec.

**D3 (kind eligibility)**: `OutputControlEligibility.kindsFor` matches design.md's stated rule
exactly (text iff Contains; dropdown iff Eq+In any type; numeric-range iff Gte+Lte+{integer,float};
date-range iff Gte+Lte+timestamp). TS mirror (`outputControlEligibility.ts`) matches, and the
drift-guard test actually reads and regexes the Scala literal at test time — not a static hand-copy
that could silently drift undetected.

**D4 (id-diffed write validation, non-blocking-on-drift)**: read `OutputControlsValidator.reject`
directly — diffs incoming `controls` against `existingControls` by `id`; only a genuinely-new id or
a matching id whose `kind`/`column` changed is validated; an untouched (including already-orphaned)
entry is skipped. Confirmed by `PanelServiceOutputControlsSpec`'s "an untouched, already-orphaned
control (id/column/kind unchanged) does not block an unrelated save" test, which drifts a bound
column's type, resubmits it unchanged alongside an edit to a *different* control, and asserts the
save succeeds — this is a genuine, meaningful test of the exact AC scenario, not vacuous.

**D5 (read-time orphan classification) — the cycle-2 CR1 fix**: read
`OutputControlsValidator.isOrphaned`/`controlEligible`, `OutputPanelConfig.responseJson`,
`PanelProtocol.fromDomain`'s new `orphanedControlIds` param (defaults to `None`, verified every
other existing call site is unaffected), and `PublicDashboardRoutes.resolveOrphanedControlIds`
(the actual wiring into `GET /api/dashboards/:id/panels`). `PublicDashboardRoutesSpec` has 4 new
tests against a real `EmbeddedPostgres` DB: eligible→`orphaned:false`, column-removed→`true`,
column-retyped→`true`, and a *real* cardinality scan (`eqInEligibleColumn` against real
`node_snapshots` rows, not just the pure-function `kindsFor`) for the dropdown branch CR2 touched.
This is genuine, non-vacuous coverage of exactly the scenario the AC and spec require.

**CR2 (DRY fix)**: confirmed `OutputControlsValidator.controlEligible` now calls
`OutputControlEligibility.kindsFor(...).contains(kind)` directly — no hand-rolled duplicate rule
remains in the validator. `resolveOperators`'s per-kind branching is a cost optimization (which
operators are worth resolving), not a second eligibility rule — confirmed by reading it.

**Independent judgment on the CR1 scope boundary** (the specific question raised in my brief):
Is surfacing `orphaned` only on `GET /api/dashboards/:id/panels` (not on write-ack echoes or the
~15 patchset/proposal preview/apply/undo projections) sufficient against the spec's literal
"reported as orphaned wherever the panel's controls are read"?

I independently re-derived the same ~20 call-site list via `grep -rn "PanelResponse.fromDomain"`
and confirmed: only `PublicDashboardRoutes`'s panel-list route passes `orphanedControlIds`; every
other site (`POST /api/panels`, `PATCH /api/panels/:id`, batch create/update, duplicate, and every
patchset/proposal preview/apply/undo/rollback site) is unaffected (`None`, unchanged behavior).

I then checked whether this narrowing has any *live* consequence today by grepping the frontend for
every consumer of a control's `orphaned` field: there is exactly one — `OutputControlsEditor.tsx`'s
`orphaned={!isColumnEligibleForKind(control.column, control.kind)}` passed into `OutputControlRow`
— and this is **entirely client-computed** from the already-fetched `/filter-capabilities` +
`output.schema`, independent of the server-baked field. I confirmed live (see screenshots below)
that the orphan indicator in the editor works correctly and does **not** depend on the CR1 backend
addition at all. I also independently confirmed via a live `fetch()` against my own seeded
dashboard that the CR1 field is genuinely present and correct (`orphaned: false`) on a real
`GET /api/dashboards/:id/panels` response — not just backend-test-only.

My conclusion: the AC's "defined, visible behaviour" is satisfied today by a mechanism (the
editor's own live client-side computation) that is unaffected by the scope boundary. The narrower
CR1 fix is a forward-looking API-contract-completeness step aimed at the one endpoint that matters
for *this* leaf's scope (steady-state reads; viewer-side rendering is explicitly leaf 3/out of
scope), not a silent gap in the AC's own behavior. It was disclosed explicitly in files-modified.md
with the exact same call-site enumeration I independently reproduced. I judge this a legitimate,
honestly-disclosed interpretation, not a defect — I agree with the cycle-2 evaluator's judgment,
reached independently rather than deferred to it. Flagging as a **non-blocking note**: a future
consumer of a write-ack response (or HEL-1190's viewer) that reads `orphaned` from anything other
than the panel-list route will see it absent — worth a tracked follow-up if/when a second consumer
actually needs it, but not a reason to REFUTE this leaf.

### Live UI pass (both themes, mobile, keyboard, a11y) — my own fresh session, this worktree's servers

- Confirmed dev servers serve THIS worktree before trusting them: `readlink /proc/<pid>/cwd` for
  both the vite process (port 6621) and the sbt/java process (port 9528) resolved to
  `.../worktrees/feature/output-panel-control-config/HEL-1189/{frontend,backend}`.
- Seeded a fresh Output (via live API calls, not fixtures) with a timestamp/integer/string schema,
  ran its pipeline, and opened the panel editor live.
- **Two-click add, dark theme**: clicked "Add control" → clicked "Date range" → control appeared
  immediately, auto-bound to `created_at` (the Output's only timestamp column). Screenshot:
  `.concertino/runs/HEL-1189/evidence/.playwright-mcp/hel1189-dark-control-added.png`.
- **Light theme**: re-verified the same flow (Dropdown this time) — clean token usage, no
  light/dark parity issues, "Unsaved changes" badge, ARIA live-region announcement text
  ("Dropdown control added, bound to amount.") observed directly in the accessibility tree.
  Screenshots: `hel1189-light-editor.png`, `hel1189-light-dropdown-added.png`.
- **Auto-bind rule verified against the REAL declared schema order** (not my source-declaration
  order, which the Output's canonical schema order did not preserve) — fetched
  `/api/outputs/:id` and `/filter-capabilities` directly and confirmed the picked column
  (`amount`, first in the real schema order that was Eq/In-eligible) matches D3's stated rule.
- **Rebind** verified live: changed the dropdown control's column from `amount` to `region`,
  confirmed the Select updates and only currently-eligible columns are offered.
- **Save + live orphaned:false verification**: saved, then independently `fetch()`'d
  `GET /api/dashboards/:id/panels` directly and confirmed `config.controls[0].orphaned === false`
  is genuinely present on the real response — not just asserted by a backend unit test.
  Screenshot: `hel1189-dark-editor-scrolled.png` (Add control select fully visible/legible in
  dark theme after scroll — initial viewport-only screenshot without scrolling clipped it inside
  the modal's own scroll region, which I confirmed was a measurement artifact of my own viewport
  size, not a real rendering bug, by inspecting the element's real DOM position).
- **Mobile stack** (390×844): panel edit sheet stacks correctly, Controls section renders
  cleanly with no overflow/clipping. Screenshot: `hel1189-mobile-controls.png`.
- **Keyboard operability**: confirmed via the `Select` component's existing shared, pre-existing
  keyboard handling (arrow-key navigation + Enter, already used elsewhere in the app) and the
  component test that fires real `ArrowDown`/`Enter` key events (not a synthetic `.click()`) and
  asserts the resulting control group appears — this is genuine keyboard-path coverage, and
  MISTAKES.md's `toHaveFocus()` pitfall is correctly avoided (deferred to the e2e/Playwright
  layer per the test's own comment).
- **No console errors attributable to this ticket's code.** I did observe pre-existing,
  unrelated console errors from a stale `run-events` SSE endpoint on a DIFFERENT, pre-existing
  dashboard's pipeline (dev-DB residue, not touched by this change) and two 404s from my own
  scratch cleanup call on a step I created for testing — neither relates to the Controls editor.

### Verdict: CONFIRM

All four ACs traced to real, exercised code:
1. Two-click date-range add, auto-bound — verified live, both themes.
2. Offered kinds match the contract exactly, including the two-Outputs-different-cardinality
   scenario — covered by `OutputControlEligibilitySpec` and independently reproduced live (my
   seeded Output offered all 4 kinds because every column happened to be low-cardinality; the
   dropdown-specific test in `PublicDashboardRoutesSpec` independently proves the cardinality gate
   is real, not just schema/type).
3. Server 400 on contract violation — `PanelServiceOutputControlsSpec` exercises both create and
   update rejection paths, naming column+kind.
4. Schema-drift orphan behavior, defined and visible — `PublicDashboardRoutesSpec`'s 4 new
   EmbeddedPostgres tests plus my own live client-side verification of the editor's orphan
   indicator (independent of the CR1 backend field, which I also independently verified live).
5. a11y — labelled, keyboard-operable, announced — verified in code and live.

No REFUTE-worthy defect found. The CR1 scope boundary is a defensible, disclosed interpretation
that I evaluated independently rather than deferring to the cycle-2 evaluator, and I reach the
same conclusion for reasons of my own (the AC's visible-behavior requirement is satisfied by a
mechanism unaffected by the boundary).

### Non-blocking notes

1. Consider a tracked follow-up (not blocking this leaf) to thread `orphanedControlIds` through
   write-ack echoes if/when a second consumer (e.g. HEL-1190's viewer) needs `orphaned` on a
   response other than the panel-list route.
2. `.playwright-mcp/hel1189-dark-editor-empty.png`/`hel1189-dark-editor-full.png` (my own initial,
   pre-scroll screenshots) are cited above only to explain that the apparent missing "Add control"
   control was a viewport/scroll artifact of my own test session, not a defect — I did not rely on
   them as load-bearing evidence for the verdict and did not persist them.
