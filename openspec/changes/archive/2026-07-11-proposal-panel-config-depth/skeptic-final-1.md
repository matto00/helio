## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established (cold, no reliance on evaluation-1.md):**
- Read `ticket.md` (3 ACs), `proposal.md`, `design.md` (6 decisions), `tasks.md`, `skeptic-design-2.md`
  (prior design-gate CONFIRM, confirming the Decision 6 validation-timing fix was resolved before
  implementation started), and the 6 spec deltas under `openspec/changes/proposal-panel-config-depth/specs/`.
- `git diff main...HEAD --stat`: 36 files, matches `files-modified.md`'s inventory exactly (spot-checked
  every backend/frontend/MCP file listed against the real diff).

**Code matches design decisions 1–6, verified by reading the actual diffs (not the narrative):**
- Decision 6 (the critical one, after a design-gate REFUTE/fix cycle): `DashboardProposalService.scala:57-85`
  — `validateStructure`/`validatePanel` call `RequestValidation.validateChartType`/`validateDividerOrientation`
  and run entirely before `preValidateBindings`/`createAll` (`apply`, lines 42-53). `applyAppearance`
  (lines 245-267) performs no validation of its own, exactly as Decision 2 requires once Decision 6 gates
  upstream. Confirmed `RequestValidation.scala:74-88` has both allow-lists (`bar|line|pie|scatter`,
  `horizontal|vertical`).
- Decision 1/3: `buildNonDataConfig`/`buildDataConfig` (`DashboardProposalService.scala:168-190`) build
  per-type config JSON from the new `ProposalPanel` fields exactly as specified (including `url→imageUrl`
  rename and metric-only `label`/`unit` threading).
- Decision 3: `MetricPanel.scala` — `MetricPanelConfig` gained `label`/`unit` (`jsonFormat3→jsonFormat5`),
  full absent-vs-null `Patch`/`applyPatch` support, mirroring the existing `aggregation` pattern.
- Decision 5 (the "HEL-292 whitelist gotcha," applied proactively): `PanelRepository.scala`'s `replace`
  explicit column tuple and `PanelTable.*` both include `metricLabel`/`metricUnit`; `PanelRowMapper.scala`
  reads/writes them for the metric branch only. New `V44` migration adds nullable TEXT columns.
- Decision 2/4: `ChartAppearance.Default` in `model.scala:108-126` mirrors the frontend default; `usePanelData.ts`
  applies the literal label/unit override AFTER the `fieldMapping`-derived value, outside the early-return
  guard, exactly matching Decision 4's precedence rule.

**Automated verification — re-ran myself, did not trust pasted output:**
- `sbt test` (full backend suite, not just the touched specs): **973/973 passed**, 58 suites, 0 failures.
- `npm test` (full frontend suite): **763/763 passed**, 64 suites.
- `npm run lint` (`eslint src --max-warnings=0`): clean, zero warnings.
- `npm run build` (Vite production build): succeeds, no type errors.
- `npx tsc --noEmit` in `helio-mcp/`: clean.
- Read `DashboardApplyProposalSpec.scala` in full: the tests are real route-level assertions with
  atomicity checks (`dashboardCount() shouldBe before` after every rejection case), not tautologies.
- Read the two new `ApiRoutesSpec.scala` tests (label/unit PATCH-then-reload, explicit-null-clear): both
  re-read via a fresh `GET .../panels` query (not the PATCH response), correctly guarding the Decision-5
  whitelist gotcha.

**Acceptance criteria — traced to independently-produced live evidence (not the evaluator's leftover dashboards):**
I authenticated against the running backend myself (`POST /api/auth/login`, matt@helio.dev) and called
`POST /api/dashboards/apply-proposal` directly with a proposal I authored, then viewed the result in the
browser:
1. **"An agent can propose a markdown panel with real content and it renders that content on apply."**
   Applied a markdown panel with `content: "# Netflix Overview\n\nKey findings:\n- Titles skew mature\n- Growth steady"`.
   Rendered live as a "Netflix Overview" heading + paragraph + bullet list — screenshot `skeptic-independent.png`.
2. **"An agent can propose a bar chart with named axes and it applies as a bar with those axes."**
   Applied a chart panel with `chartType:"bar"`, `xAxisLabel:"Person"`, `yAxisLabel:"Amount"`,
   `seriesColors:["#2255ee"]` bound to a real 3-row DataType (alice/bob/carol, amounts 10/20/30). Rendered
   live as a blue bar chart with "Person"/"Amount" axis titles — screenshot `skeptic-independent.png`.
3. **"No post-apply manual editing required... for the Netflix overview."** Confirmed via the same
   single `apply-proposal` call: all three panels (markdown, chart, metric) rendered final-looking with
   zero follow-up edits, including a metric panel with `label:"Average Amount (literal)"`, `unit:"USD"`,
   and a bound `avg` aggregation — rendered as "20 USD" / "AVERAGE AMOUNT (LITERAL)", correctly computed
   from the real data (avg of 10/20/30 = 20) with the literal label/unit taking precedence, per Decision 4.
4. **Atomicity of the Decision-6 fix, checked live (not just via the test suite):** dashboard count was 10
   before and 10 after a proposal with `chartType:"bogus"` — got `400` with message `"Invalid chartType
   value: 'bogus'. Valid values: bar, line, pie, scatter"` and nothing was created.
5. Light/dark parity: toggled theme on the evaluator's pre-existing "HEL-293 Full UI Check" dashboard
   (screenshots `hel293-dark-wide.png` / `hel293-light-wide.png`) — bar chart, metric, divider (confirmed
   via DOM inspection to be a real `divider-panel--vertical` 1px rule, not blank), and markdown all render
   correctly in both themes with no layout shift or contrast issues.
6. No console errors during any of the above (`browser_console_messages` → 0 errors across both sessions).

**Design-standard scope check:** This ticket adds **no new frontend UI components** (types/hooks only,
per its explicit Non-Goals — no `BindingEditor`/manual editor). All rendering is done by pre-existing
renderers (`MetricRenderer`, chart renderer, markdown renderer) that were not touched, so there is no new
surface for a DESIGN.md token/spacing/component-reuse review — confirmed by re-reading the frontend diff
(`usePanelData.ts`, `panelNarrowing.ts`, two `types/*.ts` files only, no `.tsx` changes).

**No placeholders/scope drift:** grepped the touched backend/frontend/MCP files for `TODO`/`FIXME`/`XXX`
— none found. `files-modified.md` explicitly and honestly calls out two pre-existing gaps as spinoff
candidates (frontend `ProposalPanel` missing `aggregation`; `PanelMutationOps.batchUpdate`'s narrower
whitelist gotcha) rather than silently leaving them or over-fixing out-of-scope code — verified both
claims are real and unrelated to this ticket's task list.

### Verdict: CONFIRM

### Non-blocking notes
- `specs/markdown-panel/spec.md`'s second scenario title still says "Proposal chart/markdown panel with
  no content" (copy-paste artifact noted already in `skeptic-design-2.md`, round 2) — cosmetic, scenario
  body is correct.
- The divider panel in both screenshots renders as a subtle 1px vertical rule inside a wide horizontal
  card — correct behavior for a `vertical` orientation in that card shape, not a defect of this change
  (pre-existing divider-panel rendering, unmodified by HEL-293).
