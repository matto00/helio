## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### Context

Round 1 (`skeptic-final-1.md`) REFUTEd on one specific, live-reproduced bug: `BindingEditor.tsx`'s
`metricDeprecated` fallback (`metricBinding.selectedMetric?.deprecated ?? panel.config.metricDeprecated ?? false`)
couldn't distinguish "user explicitly cleared the metric selection this edit session" from "metrics list
hasn't loaded yet" — both produce `selectedMetric === null` — so clearing a panel's binding away from a
deprecated metric, before saving, left a stale "deprecated" badge visible. Everything else in round 1
(schema placement, backend implementation, all gates, all four ACs, the rest of the live UI review) was
already confirmed sound and is not re-litigated in depth here; this round verifies the fix commit fresh
and re-checks nothing else regressed.

### What I verified (with evidence)

**1. Fix commit read in full, not trusted from the commit message.** `git show 38c7ccc1` —
`frontend/src/features/panels/ui/editors/BindingEditor.tsx:159-168`:
```ts
const metricDeprecated =
  metricBinding.selectedMetricId === null
    ? false
    : (metricBinding.selectedMetric?.deprecated ?? panel.config.metricDeprecated ?? false);
```
Cross-checked against `useMetricBindingState.ts` (read in full): `selectedMetricId` is initialized
synchronously from `panel.config.metricId ?? null` at mount (**not** derived from the async-loaded
metrics list), and only changes via explicit `setSelectedMetricId` calls. So `selectedMetricId === null`
correctly and unambiguously means "unbound from the start" or "explicitly cleared" — it is never `null`
merely because the metrics list hasn't loaded yet (that ambiguity only ever existed on `selectedMetric`,
which the new gate no longer relies on for the null case). This is the correct root-cause fix, not a
symptom patch — it directly targets the state-conflation bug identified in round 1.

**2. Regression test read and re-run fresh.** `BindingEditor.metricBinding.test.tsx`'s new test ("hides
the indicator immediately after clearing a deprecated-bound metric's selection, before saving") reproduces
the exact round-1 repro sequence (bind to deprecated metric → badge shows → clear to "— None —" → assert
badge gone, before any save). Ran it in isolation fresh in this worktree:
`cd frontend && npx jest --testPathPatterns=BindingEditor.metricBinding.test.tsx` → **10/10 passed**.
Full frontend suite: `npx jest` → **1506/1506 passed** (148 suites), confirming no regression elsewhere.
`npm run lint` → 0 warnings. `npm run format:check` → clean.

**3. Live re-reproduction of the exact round-1 repro, end to end** (Playwright, `DEV_PORT=5992`/
`BACKEND_PORT=8899`, `assert-phase.sh servers` → `PASS`, servers already healthy/reused):
- Bound the dashboard's "Isolation Pie" panel to "Eval Test Metric" while active, saved.
- Deprecated "Eval Test Metric" via the metric detail page, saved.
- Reopened the panel editor: "Bind to metric" showed the **"deprecated" badge** and selection
  "Eval Test Metric" — correct starting state, matches AC3.
- Clicked the metric combobox, selected "— None —" — **without saving**.
- Accessibility snapshot immediately after: `generic: Bind to metric` with **no adjacent "deprecated"
  generic**, combobox now reads "— None —", dialog header shows "Unsaved changes". Screenshot confirms
  the same visually (badge gone, "— None —" selected, unsaved).
- Re-selected "Eval Test Metric" (still offered — it's the panel's originally-bound metric, per
  `useMetricBindingState.ts`'s `m.id === initialMetricId` exception) in the same session, without
  saving: badge **reappeared** immediately — confirms the fix is correctly bidirectional (it only
  short-circuits on the explicit-clear state, not on every re-render).
- Zero console errors throughout (`browser_console_messages`, level=error, all=true → 0 across the
  whole session).
- Test data restored to pre-review baseline: panel unbound and saved, metric un-deprecated and saved
  (confirmed via fresh page loads showing "active" status and an unbound panel with 0 diff beyond the
  fix commit + benign `workflow-state.md` bookkeeping).

This is a stable, reproduced result (re-checked the badge-gone state via both the accessibility tree and
a screenshot, and re-checked the reverse direction too) — not a single anomalous reading.

**4. Nothing else moved.** `git diff main...HEAD --stat` — 54 files changed total, same shape as round 1
plus the one fix commit (`BindingEditor.tsx` + its test file) and the round-1/round-2 report files
themselves. `git status --porcelain` shows only `workflow-state.md`'s bookkeeping line changed
(`LAST_SKEPTIC_VERDICT` annotation) — no other uncommitted code. The fix is frontend-only, so I did not
re-run the backend suite (round 1 already ran `sbt test` fresh — 2464/2464 — and this change touches no
backend file).

### Verdict: CONFIRM

The round-1 change request is correctly and robustly addressed: the fix targets the actual root cause
(state conflation between "not yet loaded" and "explicitly cleared" on `selectedMetric`, resolved by
gating on the synchronously-initialized `selectedMetricId` instead), a regression test exercises the
exact previously-uncaught sequence, and I independently re-reproduced the original bug's repro live and
confirmed it no longer occurs — including the reverse-direction case (re-selecting brings the badge back)
to make sure the fix isn't overly broad. Combined with round 1's already-confirmed schema/backend/AC/gate
verification (unaffected by this frontend-only fix), this change is sound to ship.

### Non-blocking notes

- Round 1's two non-blocking notes (hardcoded `999px` border-radius matching a pre-existing repo-wide
  pattern; evaluator's spec-file soft-budget-split and disable-confirm-while-loading suggestions) still
  apply and are still not blocking.
