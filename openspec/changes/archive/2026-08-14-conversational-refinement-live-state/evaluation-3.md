## Evaluation Report — Cycle 3 (evaluation-3.md, final cycle in normal budget)

Re-evaluation after fix commit `7de52fd6` ("HEL-411 Fix metric/chart aggregation gap in the CREATE
path + add explicit prompt rule") for evaluation-2.md's Change Request. Diff reviewed: `git diff
4ce68985..7de52fd6` (`RefinementEditShape.scala`, `RefinementPrompt.scala`,
`RefinementEditShapeSpec.scala`, `evaluation-2.md`, `workflow-state.md`). Per the resumability
contract, ticket/proposal/design/tasks were not re-read this cycle either.

### Phase 1: Spec Review — PASS

Unchanged from cycles 1-2. This fix touches only prompt content + tests; no AC/task/spec surface
affected.

### Phase 2: Code Review — PASS (cycle-2's Change Request genuinely resolved; one new, lower-severity
finding surfaced — see rationale below for why it's non-blocking)

**Gates (all re-run fresh, at commit `7de52fd6`):** `npm run lint` clean, `npm run format:check`
clean, `npm run check:schemas` clean (48 pairs), `npm run check:scala-quality` clean (0 hard
failures, same 97 pre-existing soft warnings — `RefinementEditShapeSpec.scala` is still well under
budget), `npm test` (helio-mcp 153/153, frontend 159 suites/1601 tests — unchanged, this fix is
backend-only), `npm --prefix frontend run build` succeeds, `cd backend && sbt test` — **2701/2701
tests, 169 suites, 0 failures** (up from cycle 2's 2698 — the +3 delta matches the executor's claimed
3 new CREATE-path `RefinementEditShapeSpec` cases exactly).

**Cycle-2's Change Request — verified resolved, both statically and via extensive live re-testing:**

1. **`RefinementPrompt.Instructions` now states the rule explicitly** (`RefinementPrompt.scala:28-33`):
   metric aggregation always needs `value`+`agg`; chart aggregation always needs
   `groupBy`+`agg`+`yField`, "in EITHER a create or an update edit" — addressing my cycle-2 point that
   a worked example alone doesn't reliably generalize across op context.
2. **New `MetricPanelCreateExample`/`ChartPanelCreateExample`/`TablePanelCreateExample`** added to
   `RefinementEditShape.CreateExample`, with complete aggregation shapes mirroring the UPDATE
   examples. Confirmed the "second defect" claim (a partial `appearance: {chart: {chartType: "bar"}}`
   in a create edit fails `CreatePanelRequest.appearance`'s strict `jsonFormat5` decode, since
   `ChartAppearance.seriesColors`/`legend`/`tooltip`/`axisLabels` have no defaults) is real and
   correctly avoided in the final `ChartPanelCreateExample` (no `appearance` key at all, with an
   explicit code comment explaining why + directing chartType tweaks to a separate follow-up edit).
3. **`RefinementEditShapeSpec` extended to the CREATE path** (3 new cases, 8 total) — each decodes via
   `edit.createPatch.get.convertTo[CreatePanelRequest]` then the real `*PanelConfig.decodeCreate`,
   mirroring `PatchSetApplyResolvers.resolvePanelCreate`'s own `decodeCreatePatch[CreatePanelRequest]`
   call exactly (confirmed by re-reading `PatchSetApplyResolvers.scala:338`) — this is the actual
   apply-time decode path, not an approximation.
4. **Live re-verification — 5 direct real Claude-call trials specifically targeting aggregation
   completeness**, deliberately going beyond the executor's own 4 trials with different phrasings, per
   the orchestrator's explicit request to be thorough on this exact scenario (restarted the backend
   first — confirmed via process-start-time-vs-commit-time that the prior running backend, like cycle
   2's, predated this fix commit; a repeat of the same stale-server trap, now resolved for this run):
   - Metric CREATE ("highest single order amount" / max) → `{"agg":"max","value":"amount"}` ✓.
     Accepted end-to-end: the resulting panel genuinely renders `"30"` (real aggregated data, not
     `"--"`).
   - Metric UPDATE (max → average) → `{"agg":"avg","value":"amount"}` ✓, correctly targeted the real
     panel id. Accepted end-to-end: panel now renders `"20"` (a different, correctly recomputed real
     value) — full proof the original cycle-1 concern (a metric silently rendering no data) cannot
     recur for this exact scenario.
   - Chart CREATE (plain wording, no chart-type implied) → `{"agg":"sum","groupBy":"name","yField":
     "amount"}` ✓, single clean edit.
   - Chart UPDATE (sum → average, on the existing chart panel) → `{"agg":"avg","groupBy":"name",
     "yField":"amount"}` ✓, correctly targeted the real panel id.
   All 5 direct aggregation-shape trials produced fully complete, correct `aggregation` objects. This
   is materially more evidence than cycle 2's single reproduction, and it now points the other way —
   the fix holds up under repeated, varied, real testing.

**New finding — a different, lower-severity issue, in a scenario the fix's own new guidance
introduces (a create + implied-chart-type request):**

Per the orchestrator's ask to try phrasings beyond the executor's own trials, I ran 3 real Claude
calls asking to create a NEW chart panel where the message implied a specific chart type ("bar
chart" / "line chart" — as opposed to the plain "chart panel" wording above, which worked cleanly).
Results were inconsistent across identical/near-identical wording:
- 2 of 3 attempts returned `422` with `"edit 0: patch does not match the expected shape (Expected
  Collection as JsArray, but got {})"` — a structurally malformed attempt, caught cleanly and
  surfaced as a normal, visible, recoverable error (`InlineError` + "Try again") — this is the system
  working exactly as designed (repair-then-reject on genuinely invalid output), not a defect.
- 1 of 3 attempts returned `200` with a 2-edit patch set: edit 0 (the chart create, `aggregation`
  fully correct) plus an UNSOLICITED edit 1 — a `panel update` whose `target.id` is the REAL id of
  the pre-existing, unrelated "Highest Single Order Amount" **metric** panel from earlier in this
  session, patching in a full `appearance.chart.chartType: "bar"` object. Root cause: the fix's own
  new instruction ("omit appearance from the create and add a SEPARATE follow-up 'panel' update edit
  targeting the new panel instead") asks the model to reference a panel that doesn't exist yet at
  prompt-composition time — there is no real id for it to use, so on this sample it substituted an
  unrelated real panel's id instead of correctly omitting the appearance tweak entirely.

**Why this is a genuine finding but NOT a blocking Change Request (unlike the two prior aggregation
defects):**
- `PatchSetPreviewService.preview` DID accept it (target existence/ACL is all it checks — the id is
  real, just semantically wrong), so this is not caught mechanically. But critically, AC2's core
  safety invariant ("nothing is written until the user accepts") held throughout: the mistargeted
  edit was fully visible in the `/patch-sets/review` diff — I confirmed the rendered diff clearly
  shows `"type": "metric"` on both Before/After of the second edit, right next to an incongruous
  `appearance.chart` addition, which a reviewing user has a real chance to notice before accepting.
  This is categorically different from the two now-fixed aggregation bugs, whose failure mode was
  silent — a metric rendering `"--"` is visually indistinguishable from ordinary "no data yet," with
  no diff-review signal pointing at the problem.
- Worst-case blast radius if accepted anyway: an inert `appearance.chart` sub-object on a metric
  panel, which `MetricRenderer` never reads — no visible corruption, no data loss.
- One of the two failure modes (422) is the system's own safety net working correctly, not a defect.
- This is a narrower trigger (create a new chart panel + imply a specific chart type + another panel
  already exists on the dashboard) than "ask for a metric/chart aggregation," which is closer to the
  most common possible refinement request and was the actual subject of 2 prior fix cycles.

Given this, I'm treating it as a **non-blocking suggestion** rather than reopening a third
Change-Request cycle over what is a different, narrower, and structurally-safer-by-design edge case
— see below for the specific recommendation.

Everything else re-confirmed clean, no new findings beyond the above on any other axis (DRY,
readability, type safety, error handling, dead code, over-engineering, ACL triad, no inline FQNs).

### Phase 3: UI Review — PASS

**Environmental note (repeat of cycle 2's, worth flagging again since it recurred):** the dev backend
was again found running code that predated the just-landed fix commit (`sbt run` process started
14:37:29, commit landed 14:42:40) despite the executor's report claiming a restart. I killed it and
cold-started a fresh `sbt run`, confirmed (via `ps -o lstart` vs `git log --format=%cI`) that the new
process start time is after the commit's author/commit time, before doing any live verification.
Recommend the executor's own restart step explicitly verify this ordering going forward, given it's
now recurred twice.

Live re-verification against the confirmed-fresh backend, with 8 real `ANTHROPIC_API_KEY`-backed
Claude calls total this cycle (5 direct aggregation-shape trials + 3 chart-create-with-implied-type
trials): no console errors beyond the two expected/handled `422` network-log entries (not JS
exceptions — the app degraded gracefully via its existing error UI both times); every accepted patch
set (2 of the 8 trials — a metric create, a metric aggregation update) applied cleanly and rendered
real, correct, distinct aggregated values (`"30"` then `"20"`) confirming end-to-end correctness, not
just JSON-shape correctness; every rejected patch set (6 of 8) left the network log showing only
`preview`/no-op `refinements` calls, zero `PATCH`/unintended `apply` calls. No CSS/markup changed
this cycle, so a full breakpoint re-sweep was not repeated (nothing visual to regress).

### Overall: PASS

### Change Requests

None blocking.

### Non-blocking Suggestions

1. **Chart-create-with-implied-chart-type can produce a mistargeted follow-up edit** (see Phase 2
   finding above) — `RefinementEditShape.CreateExample`'s guidance to "add a SEPARATE follow-up panel
   update edit targeting the new panel instead" is structurally impossible to satisfy correctly within
   the SAME patch set (the new panel's real id doesn't exist yet at prompt-composition time).
   Recommend either: (a) explicitly instruct the model that a chart-type override for a
   newly-created panel is NOT achievable in the same turn — create with the default appearance and
   mention in the summary that chart type can be changed in a follow-up message once the panel
   exists, or (b) since `CreatePanelRequest.appearance` does support a full object at create time,
   extend `ChartPanelCreateExample` to demonstrate the complete `ChartAppearance` object (not just a
   partial `chartType`) as the correct way to set a non-default chart type at create time. This is
   lower severity than the two aggregation defects fixed this cycle — the diff-preview UI already
   makes any mistargeted edit visible before acceptance (AC2's safety invariant held in every trial),
   and the inert-field blast radius is harmless — but worth closing given `RefinementEditShape` has
   now needed 3 rounds of live-testing-driven correction on adjacent create-path edge cases.
2. Consider adding a `RefinementEditShapeSpec`-style regression case (or a `RefinementServiceSpec`
   integration case with a stubbed multi-edit response) asserting that a `create` edit's own
   `dashboardId`/target and any same-patch-set follow-up edit's `target.id` are never
   fabricated/aliased onto an unrelated real resource — this is harder to express as a static
   worked-example decode test (the current pattern) since the defect is about model *behavior* across
   multiple edits, not a single hand-maintained example's shape; may be better suited to a
   `RefinementService`-level test with a scripted two-attempt fake transport reproducing this exact
   shape, if a follow-up ticket picks this up.

### Summary for the human (informational — Overall is PASS, no escalation required)

Three cycles: cycle 1 found the UPDATE-path metric-aggregation defect (fixed, verified); cycle 2's
live spot-check found the same defect class recurring in the untouched CREATE path (fixed, and this
cycle verified with 5 additional live trials — all correct, including 2 full accept-and-render
round-trips producing real, distinct, correct aggregated values). Cycle 3's expanded testing (per this
cycle's explicit ask to go further than the executor's own trials) surfaced one more, structurally
different and lower-severity edge case (documented above as a non-blocking suggestion) in a
create-plus-implied-chart-type scenario introduced by this cycle's own new "separate follow-up edit"
guidance. Given that edge case's failure modes are either a safe, visible 422 or a reviewable
(not silent) mistargeted edit — never a silent wrong-data render like the two fixed defects — I did
not judge it severe enough to warrant a fourth cycle; recommend a human decide whether to spin off a
quick follow-up ticket for the non-blocking suggestion above before/after merge, at their discretion.
