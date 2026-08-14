## Evaluation Report — Cycle 2 (evaluation-2.md)

Re-evaluation after the executor's fix commit `4ce68985` ("HEL-411 Fix metric worked example's
missing aggregation.value + regression coverage") for evaluation-1.md's sole Change Request. Diff
reviewed: `git diff 1c37d524..4ce68985` (5 files: `RefinementEditShape.scala`, new
`RefinementEditShapeSpec.scala`, `RefinementChatDrawer.test.tsx`, `evaluation-1.md`,
`workflow-state.md`). Resumed context per the resumability contract — ticket/proposal/design/tasks
not re-read; this cycle's diff + the new handoff message are the review surface.

### Phase 1: Spec Review — PASS

No change from cycle 1's PASS. The fix commit touches only `RefinementEditShape.scala` (prompt
content), a new test file, and one added assertion in an existing frontend test — no AC, task, or
spec-delta surface is affected. No scope creep: the diff is exactly the fix cycle 1 asked for, plus
the one non-blocking suggestion the executor also picked up.

### Phase 2: Code Review — FAIL

**Gates (all re-run fresh by me, in `WORKTREE_PATH`, at commit `4ce68985`):**
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm run check:schemas` — clean, 48 pairs checked (unchanged from cycle 1 — this fix touches no
  schema-relevant surface).
- `npm run check:scala-quality` — clean, 0 hard failures, same 97 pre-existing soft warnings (the
  new `RefinementEditShapeSpec.scala` is 76 lines, well under budget).
- `npm test` (root + frontend) — helio-mcp 153/153, frontend **159 suites / 1601 tests** (same count
  as cycle 1 — the fix added one assertion to an existing test case, not a new test).
- `npm --prefix frontend run build` — succeeds (same pre-existing >500kB chunk warning, unrelated).
- `cd backend && sbt test` — **2698/2698 tests passed, 169 suites** (up from cycle 1's 2693/168 —
  the +5 delta is exactly `RefinementEditShapeSpec`'s 5 new test cases; 0 failures).
- Commit message accurate: same single `check:openspec` archive-timing bypass as cycle 1, for the
  same stated reason; every other gate genuinely ran clean per my own fresh run, not the executor's
  self-report.

**Cycle-1's Change Request — CONFIRMED RESOLVED, verified three independent ways (not just
"the diff looks right"):**

1. **Static verification**: `RefinementEditShape.MetricPanelExample` now reads
   `"aggregation": { "value": "revenue", "agg": "sum" }` (`RefinementEditShape.scala:74`) — both
   `MetricAggregation`-required keys present. The other four panel examples (chart/table/collection/
   timeline) are unchanged and were already correct.
2. **The new `RefinementEditShapeSpec` genuinely catches this class of defect, confirmed by
   mechanism, not just by existing**: I did not mutate source to re-run a live regression (that would
   violate this role's read-only guardrail), so I traced the assertion against the real decode path
   instead. `MetricPanelConfig.Patch.decode`'s `aggregation` branch (`MetricPanel.scala`) does
   `Some(o: JsObject) => Some(Some(o))` — it preserves the JSON's fields verbatim, no defaulting. The
   spec's assertion `aggregation.fields.keySet should contain allOf ("value", "agg")` requires BOTH
   keys present in that verbatim `JsObject`; had the pre-fix example (`{"agg": "sum"}`, no `value`)
   still been in place, `aggregation.fields.keySet` would be exactly `Set("agg")`, and `contain allOf
   ("value", "agg")` fails by ScalaTest's own well-defined semantics (all elements must be present).
   This is a sound, mechanical proof the test would have failed pre-fix and is not a tautology or a
   test that merely echoes the implementation. Confirmed live: `sbt test`'s fresh run above shows all
   5 `RefinementEditShapeSpec` cases passing against the actual fixed source.
3. **Live re-verification against a real Claude call** (see Phase 3) — a real "rename this panel"
   UPDATE-op refinement round-tripped correctly, and a real metric-aggregation UPDATE-adjacent prompt
   text is now grounded with the correct worked shape.

**New issue found during the requested live metric-aggregation spot-check — the underlying risk
class is not fully closed, only the one specific line cycle 1 flagged:**

Per the orchestrator's specific ask ("a fresh live UI spot-check of a metric-aggregation refinement
request specifically"), I restarted the backend (it was still serving cycle-1's pre-fix compiled
code — `sbt run` does not hot-reload; this was a genuine environmental trap worth flagging on its
own, now resolved by restart) and ran two independent real Claude calls asking to **add a new metric
panel** with an aggregation (a `create`-op refinement, not `update`):

- Trial 1 — "Add a metric panel showing the total (sum) revenue amount, aggregated across all rows"
  → returned a `create` edit with `"config": {"aggregation": {"agg": "sum"}, "fieldMapping": {"value":
  "amount"}, ...}` — **`aggregation` is again missing `value`**, the exact same defect class cycle 1
  flagged, reproduced live, on the FIXED code.
- Trial 2 (different wording) — "Add a new metric panel that shows the average order amount" →
  returned `"aggregation": {"agg": "avg", "value": "amount"}` — correct this time.

Root cause: `RefinementEditShape.CreateExample` (unchanged by this fix) only demonstrates a `table`
panel create — it has no metric-panel create example, and no aggregation example at all in a create
context. The fixed `MetricPanelExample` lives entirely under the UPDATE-examples section; the model
is left to extrapolate the correct shape for a CREATE op with no direct guardrail, and — confirmed
empirically, 1 of 2 real trials — does not always extrapolate it correctly. This is not hypothetical:
I reproduced the exact silent-failure defect cycle 1 identified, on a real Claude call, seconds after
confirming the backend was running the fixed commit. I independently confirmed nothing downstream
would catch it: `MetricPanelConfig.decodeCreate` is a bare alias for `decode`
(`MetricPanel.scala:73`), which treats `aggregation` as an opaque `JsObject` with zero content
validation on the create path either, and `PatchSetPreviewService.preview`/`PatchSetApplyResolvers`
still never reference `aggregation` (re-grepped, unchanged from cycle 1). A user asking for exactly
what the ticket's own example scenario describes ("show total revenue" / "add a card showing total
X") has a real, non-trivial chance of getting a silently-broken metric panel with this fix as it
stands.

- [ ] **Fix required**: extend `RefinementEditShape`'s CREATE-context coverage so a metric panel
      create with an aggregation is directly grounded, not left to cross-context extrapolation from
      the update example alone. Two complementary options, either sufficient on its own, ideally both:
      1. Add a metric-panel (and ideally chart-panel) CREATE worked example to `CreateExample` showing
         a complete `aggregation` object, mirroring the update section's now-correct shape.
      2. Add an explicit RULE to `RefinementPrompt.Instructions` (not just an example) —
         e.g. "Whenever emitting a metric panel's `config.aggregation`, ALWAYS include both `value`
         and `agg`; for a chart panel's `config.aggregation`, ALWAYS include `groupBy`, `agg`, and
         `yField` — never emit a partial aggregation object, in either a create or update edit." A
         rule generalizes across create/update in a way a single worked example does not — this
         review's own live A/B (trial 1 fail, trial 2 pass, same underlying gap) shows a worked
         example alone doesn't reliably generalize across op context.
      Recommend extending `RefinementEditShapeSpec` (or a sibling) to cover the CREATE path the same
      way it now covers UPDATE, once the above lands.

Everything else re-confirmed clean, no new findings beyond the above:
- No inline FQNs, ACL triad, DRY, dead code, type safety, error handling — all unchanged from cycle
  1's clean Phase 2 findings; the fix commit's diff is narrow (prompt text refactor into
  individually-testable vals, one new test file, one added assertion) and introduces nothing new to
  flag on any of those axes.
- Design-standard mechanical rules: N/A for this commit (no CSS/markup changed).

### Phase 3: UI Review — PASS (with a process note)

**Environmental note (not a code defect, but worth recording for future cycles on this ticket):**
`scripts/concertino/start-servers.sh` correctly reuses an already-healthy backend without checking
whether it's serving the currently-checked-out commit. The backend process from cycle 1 (started at
14:10, before the 4ce68985 fix landed) was still running and NOT recompiled (`sbt run`, not `~run` —
no hot reload) when I began cycle 2. I killed it and let `start-servers.sh` cold-start a fresh
`sbt run`, confirmed healthy, before doing any live verification against this cycle's fix. Anyone
re-running this ticket's dev servers across cycles should do the same — a stale long-lived backend
process is a real trap for "verify the fix live" work specifically.

Re-verified live against the restarted (fixed-code) backend, with a real `ANTHROPIC_API_KEY`-backed
Claude call:
- UPDATE-op happy path re-confirmed (rename-panel style turn → thread appends, stays open, Review &
  apply → PatchSetReviewPage renders the real diff → Reject leaves the dashboard's panel byte-for-byte
  unchanged, confirmed via network log showing no `PATCH`/`apply` calls, only read-only `preview`
  calls).
- Two CREATE-op metric-aggregation trials (the requested spot-check) — see Phase 2 for the substantive
  finding; both times the drawer/review-page rendering itself worked correctly (no console errors, no
  broken UI, clean diff rendering of whatever patch set came back) — this is a prompt-content defect,
  not a UI defect. Both patch sets were rejected; nothing was written to any resource in either trial.
- No console errors or warnings at any point across this session (checked repeatedly).
- No CSS/markup changed in this cycle's diff, so a full breakpoint re-sweep was not repeated (nothing
  visual to regress); cycle 1's 1440/1100/768/320 breakpoint checks already cover
  `RefinementChatDrawer`'s unmodified UI.

### Overall: FAIL

### Change Requests

1. **`backend/src/main/scala/com/helio/services/RefinementEditShape.scala`** (`CreateExample` +
   `RefinementPrompt.Instructions`) — the metric-aggregation-missing-`value` defect cycle 1 flagged is
   fixed for the UPDATE worked example, but the same defect still reproduces live (1 of 2 real trials)
   for a `create`-op metric-panel refinement, because `CreateExample` has no metric/aggregation
   example and nothing generalizes the update example's shape to a create context. Add a metric-panel
   CREATE worked example with a complete `aggregation` AND/OR add an explicit completeness rule to
   `RefinementPrompt.Instructions` (see Phase 2 above for exact wording suggestion) so this can't
   recur regardless of which op the model chooses. Extend `RefinementEditShapeSpec` (or add a sibling)
   to cover the CREATE path once fixed, the same way it now covers UPDATE.

### Non-blocking Suggestions

- None new this cycle — cycle 1's suggestion (explicit `toHaveBeenCalledTimes(1)`) was picked up by
  the executor and verified present in `RefinementChatDrawer.test.tsx`.
