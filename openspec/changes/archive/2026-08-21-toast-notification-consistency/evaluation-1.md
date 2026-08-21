# Evaluation Report — Cycle 1 (evaluation-1.md)

Ticket: HEL-535 · Change: `toast-notification-consistency` · Commit under review: `839cd7fe`
Judged against the **re-scoped** `ticket.md` in this change directory (mechanics half only; the
toast-versus-inline policy audit is HEL-771, `PanelList.tsx` / `createDashboard.rejected` is HEL-770).

---

## Phase 1: Spec Review — FAIL

**What passes** (verified, not taken on trust):

- **Charter held: nothing announced today became unannounced.** I diffed the new
  `SUCCESS_TOASTS`/`ERROR_TOASTS` tables entry-by-entry against
  `git show main:frontend/src/features/toasts/state/toastListeners.ts`. All 15 pre-existing success
  entries and all 18 pre-existing error entries survive with byte-identical messages and fallbacks.
  Nothing was removed (task 3.7). The only intentional wording change is `createSqlSource.fulfilled`
  `"… connected."` → `"… created."` (task 3.5 / D6), which is a *de-duplication*, not a removal — the
  action stays announced exactly once.
- Six new entries added exactly as scoped (`updateDashboardLayout`, `updatePanelsBatch`,
  `updatePanelColumnWidths`, `savePipelineSchedule`, `deleteMetric` errors + `deleteMetric` success).
  All five thunks are declared `{ rejectValue: string }` and call `rejectWithValue(<string>)`, so
  `payload ?? fallback` can never render a non-string — no `[object Object]` hazard.
- The self-contradicting header comment is replaced with the "absence means unchanged by this change,
  not deliberately silent" note (task 3.6).
- **Scope fence honoured.** `frontend/src/features/panels/ui/PanelList.tsx` is **not** in
  `git diff --name-only main...HEAD` (task 5.0 / 4.6). Grepping the whole frontend diff for
  `skeleton|isLoading|loading|EmptyState|status ===` returns **zero** hits — no loading branch,
  skeleton, or panel/list/detail render ladder was touched. `git diff --stat main...HEAD -- frontend/src/features/panels/`
  is empty.
- Planning artifacts (proposal/design/tasks/spec deltas) describe the implemented behaviour accurately,
  with one exception recorded below.
- No API/schema surface touched (`check:schemas` clean); frontend-only, as `proposal.md` states.
- D5's "tracked exception" reasoning was **verified in the running app**, not just accepted on paper:
  with the schedule `Modal` open, the toast is rendered but `document.elementFromPoint` at the toast's
  centre returns `ui-modal ui-modal--sm` — the toast is painted below the native `<dialog>` top layer
  and is inert, while the dialog shows its own inline error. So the dialog path genuinely reports the
  failure once, and the header toggle is the entry's only real beneficiary, exactly as designed.

**Issue:**

1. **Task 2.7 is marked `[x]` but the behaviour it claims is not delivered.** "Add the 44px tap-target
   floor to `.toast__close` at ≤768" is checked off, and the spec delta
   `specs/toast-surface-behavior/spec.md` carries a normative scenario ("The dismiss control meets the
   tap-target floor → its dismiss control meets the mobile minimum tap-target size"). In the running
   app the floor never applies — see Change Request 1. A task marked complete against a spec-delta
   scenario that the shipped code does not satisfy is a Phase-1 miss, not only a code bug.

---

## Phase 2: Code Review — FAIL

### Gates — re-run independently in `WORKTREE_PATH` (not trusted from the commit message)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0, zero warnings (`--max-warnings=0`) |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm run check:schemas` | in sync (66 checked / 47 protocol files; 7 panel-type surfaces) |
| `npm run check:scala-quality` | clean (128 pre-existing soft warnings, informational) |
| `npm test` | **226 suites / 2471 tests, all passing** — exactly the commit's claim, up from the 224/2427 baseline |
| `npm --prefix frontend run build` | succeeds (pre-existing chunk-size advisories only) |

**The `git commit -n` bypass is legitimate and complete.** `.husky/pre-commit` runs six checks; I ran
all six. Five pass. The only failure is `npm run check:openspec`, and its sole output is
`change "toast-notification-consistency" is complete (42/42) but not archived` — precisely the HEL-657
false positive the commit message discloses. Nothing else was bypassed.

### Issues

1. **`.toast__close`'s 44px mobile floor is dead code — CSS source-order defect.** (blocking; see CR1)
2. **`toast.css.test.ts`'s 44px guard cannot catch (1).** (blocking; see CR2)
3. **Two of the three auto-save fallback strings task 3.2 specified are unreachable**, and the copy the
   user actually sees is the wire-phrased wording that task explicitly forbade. (blocking; see CR3)
4. **`aria-atomic="true"` on the multi-message live regions re-announces already-announced toasts**,
   contradicting D2's own stated rationale. (blocking; see CR4)

### What the code review found *good* (recorded so it isn't re-litigated)

- **DRY / modular:** the D7 rewrite is a genuine de-duplication — 446 → 214 lines, back under
  `CONTRIBUTING.md:24`'s ~400-line threshold, with 33 near-identical `startListening` blocks collapsed
  into two typed row-builders (`success()` / `error()`) plus two loops. The `AsyncThunkResultCreator`
  helper's `(...args: any[])` is the one `any` in the diff; it is load-bearing (it is what lets `A` —
  and therefore `message`'s payload parameter — be inferred at each call site) and carries a written
  justification citing RTK's own `TypedActionCreator`. `CONTRIBUTING.md:37` says avoid `any` *without*
  justification; this qualifies. Lint passes at zero warnings with no `eslint-disable`.
- **Type safety:** `Toast.duration` correctly tightened to always-present on stored state while
  `ToastInput` keeps it optional for callers — the cap, coalescing and tests then all read one value.
- **Reducer-side cap is the right call:** state itself never exceeds the cap, so it is directly
  assertable, and the sticky-exemption loop (`toastsSlice.ts:82-86`) breaks correctly when every entry
  is exempt rather than spinning or dropping the push.
- **Behaviour-preserving where required:** the only drive-by behaviour change in
  `PipelineDetailPage.handleRemoveStep` is the optimistic-restore, which the plan explicitly required
  (D5) and which brings the handler into line with its five siblings. Nothing else in that file moved.
- **Tests are meaningful** apart from the two gaps in CR2/CR3: `toastListeners.test.ts` is a real
  regression guard over every pre-existing entry, and `toastsSlice.test.ts` pins the exact eviction
  ordering (`["Applied.", "Toast 3", "Toast 4"]`), which would catch a silent change to the exemption.
- **No dead code, no leftover TODO/FIXME, no over-engineering** in the diff.
- `renderWithStore`'s `withToastListeners` option is opt-in, defaults off, and is guarded against
  double-registration per test file — no behaviour change for any existing caller.

---

## Phase 3: UI Review — FAIL

Servers started with the canonical script on the assigned ports; `assert-phase.sh servers` → `PASS servers`.
Driven with an **own headless Chromium instance** (`node_modules/playwright`), never the shared MCP
Playwright session, per the run constraints.

### Verified working (live, against real mutations and real failures)

- **Live regions are mounted unconditionally from first render.** With zero toasts on a freshly loaded
  page, both regions are present: `role="status" aria-live="polite"` and `role="alert" aria-live="assertive"`,
  both `class="sr-only"` resolving to the canonical `clip: rect(0,0,0,0); position: absolute; 1px×1px`
  recipe. Not lazy. This is the single most important thing this change claimed, and it holds.
- **Intent routing is correct.** `deleteMetric` failure → message in the assertive region, polite empty.
  `deleteMetric` success → polite region, assertive empty. Both live simultaneously → each in its own region.
- **The visible card carries no live-region semantics**: `role`, `aria-live`, `aria-atomic` all absent
  on `.toast`; `.toast__message` is `aria-hidden="true"` with an id (`toast-message-1`) referenced by
  `aria-describedby` from the dismiss button. Dismiss is focusable (`tabIndex: 0`), and **Enter dismisses**.
- **Six newly-reported failures — driven for real:**
  - `deleteMetric.rejected` (Metrics page, Delete → Confirm, forced 500) → exactly one error toast.
  - `deleteMetric.fulfilled` → exactly one "Metric deleted." success toast (new entry works).
  - `savePipelineSchedule.rejected` via the **header toggle**, activated by keyboard (focus + Space) →
    exactly one error toast, assertive region. Previously this control silently refused to move.
  - `deletePipelineStep` rejected → **step restored to the view** (5 cards before, 5 after; server step
    count unchanged) **and** exactly one error toast carrying the server's reason. This is the D5
    optimistic-restore requirement, confirmed end-to-end.
  - `updatePanelColumnWidths.rejected` via a real keyboard column-resize on a table panel → one error
    toast (see CR3 for its copy).
  - `updateDashboardLayout` / `updatePanelsBatch`: wiring covered by the new unit tests; both thunks
    always supply a string `rejectValue`, so the emission path is identical to the four observed above.
- **Cap behaves predictably under a burst.** Four *distinct* real failures fired in quick succession →
  toast state and the DOM both hold exactly **3**; the oldest was evicted, the three newest retained in
  order, stacked cleanly bottom-right with no overflow.
- **Coalescing works.** Three *identical* real failures → exactly **1** card and **1** child in the
  assertive region.
- **`prefers-reduced-motion` genuinely disables the entrance, not shortens it.** Sampled 60 ms into the
  entrance window: with the preference, `animation-name: none`, `opacity: 1`, `transform: none` — the
  toast simply appears. Without it: `toast-slide-in`, `0.28s` (= `--transition-slow`), mid-flight
  `opacity: 0.34` and a 13 px translate — a single entrance animation. Dismissal removal latency
  **13 ms** with the preference vs **213 ms** without: the JS exit delay is genuinely elided.
- **Both themes, tokens only.** light: surface `#ffffff`, text `#211d19`, error accent `rgb(199,58,42)`,
  success `rgb(26,127,78)`. dark: surface `#262320` (= `--app-surface-strong`), text `#f2efe9`, error
  `rgb(240,117,97)`, success `rgb(76,195,138)`. Body type `12px` (= `--text-xs`) in both. Opaque strong
  surface, 3px intent border-left, no literal colours anywhere in `toast.css`. Light/dark parity holds.
- **Mobile nav clearance works.** At 768 and 430 the viewport resolves to `bottom: 72px`
  (`--bottom-nav-height` = `calc(40px + 1rem + 0px)` = 56 px, matching `BottomNav`'s measured 56 px, plus
  `--space-4`). Toast bottom 828 vs nav top 844 at 768; 788 vs 804 at 430. Clears with a 16 px gap.
- **Breakpoints 1440 / 1100 / 768 / 430 all render without layout breakage.**
- **Zero console errors and zero unhandled exceptions** across every flow, in both themes, at every
  breakpoint — the only console output was the 4xx/5xx I injected deliberately.
- Feature verified from three entry points (Metrics page, Pipeline detail page, Add-source modal).

### Issues

1. **The 44px tap-target floor does not apply at any mobile breakpoint** — the headline Phase-3 finding.
   See CR1. Measured, not inferred: at width 430 and width 768,
   `window.matchMedia('(max-width: 768px)').matches === true`, yet the computed style of
   `.toast__close` is `width: 20px; height: 20px; margin: -2px -4px 0px 0px` — the *base* rule's values,
   including its margin, not the media block's `44px` / `-12px -12px 0 0`. Visually confirmed in the
   430 px screenshot: the dismiss × is the desktop 20 px square on a phone.
2. **A rejected column resize reads "Failed to persist column widths."** in the live app, not the
   "Failed to resize columns." the table declares and the test asserts. See CR3.
3. **Stacked toasts re-announce.** Under the burst the assertive region held three sibling children
   while carrying `aria-atomic="true"`, so each new failure re-presents all three. See CR4.

---

## Overall: FAIL

Four change requests. The substance of the ticket — the charter (no toast removed, no announcement
posture altered), the cap, the exemption, coalescing, the always-mounted live regions, intent routing,
the reduced-motion opt-out, the mobile nav clearance, the six closed failures, the optimistic restore,
and the one-toast-one-wording add-source fix — all hold up under live verification. CR1 and CR3 are
narrow, mechanical misses inside otherwise-correct work; CR2 and CR4 are the guardrail and the a11y
polish that go with them.

---

## Change Requests

### 1. `toast.css` — the 44px mobile tap floor is overridden by source order (blocking)

`DESIGN.md` §3 *Control metrics* is tagged **[mechanical]**: "A fifth, mobile-only value applies at the
430/768 breakpoints: interactive controls reachable on phone … get a literal `44px` min-height/min-width
tap-target floor … this is intentional, not drift". D4 accepted this explicitly ("it gains only the 44px
tap floor at ≤768 that §3 requires regardless"). The rule was written but never takes effect.

Root cause (probe-confirmed): in `frontend/src/shared/ui/toast.css`, the
`@media (max-width: 768px)` block sits at **lines 24–34**, *above* the base `.toast__close` rule at
**lines 140–158**. Both selectors have specificity (0,1,0), so the cascade resolves on source order and
the later base rule wins. `.toast-viewport`'s offset in that same media block works *only* because its
base rule (line 5) precedes the block — which is why the nav clearance passed and the tap floor did not.

Evidence at width 430 and width 768 (`matchMedia('(max-width: 768px)').matches === true` in both):

```
{"mqMatches768":true,"width":"20px","height":"20px","margin":"-2px -4px 0px 0px","rect":{"w":20,"h":20}}
```

**Change:** split the `.toast__close` mobile override out of the line-24 media block and place it in a
`@media (max-width: 768px)` block *after* the base `.toast__close` rule (i.e. after line 163, following
`.toast__close:hover`). Keep the `.toast-viewport` offset where it is — it is correct there. Re-measure
`getComputedStyle` at 430 and 768 and confirm `44px` / `44px` and the `-12px -12px 0 0` margin actually
resolve before marking task 2.7 done.

### 2. `toast.css.test.ts` — the 44px guard cannot fail on CR1 (blocking)

`frontend/src/shared/ui/toast.css.test.ts:126-132` asserts only that the media block's *text* contains
`width: 44px;` / `height: 44px;`, and separately (`:135-144`) that the base rule's text contains
`20px`. Both assertions pass today while the shipped app honours neither the 44px nor the media block's
margin. This is exactly the "tests would catch a real regression" bar not being met — the whole point of
the `*.css.test.ts` convention is to stand in for the layout jsdom cannot evaluate, and here it does not.

**Change:** make the guard order-aware. The cheapest sufficient form: assert that the source index of the
`@media (max-width: 768px)` block containing `.toast__close` is **greater than** the source index of the
base `.toast__close {` rule, with a comment naming CR1 as the regression it exists to catch. The existing
helper `mediaBlockEnd` already computes the indices this needs.

### 3. `toastListeners.ts` — two of the three auto-save fallback strings are unreachable, and the shipped copy is the wording task 3.2 forbade (blocking)

Task 3.2 required each new auto-save fallback be "phrased as what the user did (a column *resize*, not
'update panel column widths')". The table strings say the right thing but never render: every one of
these thunks wraps its body in `try { … } catch { return rejectWithValue("<its own string>") }`, so
`.rejected.payload` is *always* a defined string and `payload ?? fallback` always takes `payload`.

| Table entry | Declared fallback | What the user actually sees |
| --- | --- | --- |
| `toastListeners.ts:174` `updatePanelColumnWidths` | "Failed to resize columns." | **"Failed to persist column widths."** (`panelThunks.ts:308`) |
| `toastListeners.ts:173` `updatePanelsBatch` | "Failed to save panel changes." | "Failed to update panels." (`panelThunks.ts:417`) |
| `toastListeners.ts:172` `updateDashboardLayout` | "Failed to save dashboard layout." | same string — OK, no action needed |

The first row is **confirmed live**: a real keyboard column-resize on a table panel with the PATCH forced
to 500 produced the toast `Failed to persist column widths.` — the wire-call phrasing the task named as
the counter-example.

`toastListeners.test.ts:289-303` asserts the table strings by dispatching `payload: undefined`, a state
these thunks cannot produce, so the tests confirm the dead branch and miss the live one.

**Change:** pick one source of truth. Simplest and safest: edit the two thunks'
`rejectWithValue` strings to the user-phrased copy — `panelThunks.ts:308` → `"Failed to resize columns."`
and `panelThunks.ts:417` → `"Failed to save panel changes."` — then keep the table fallbacks identical to
them. I grepped for consumers: `updatePanelsBatch.rejected` and `updatePanelColumnWidths.rejected`
payloads are read by **nothing** outside `toastListeners.ts`, so this is contained. Then update
`toastListeners.test.ts:289-303` to assert the reachable path (dispatch with the thunk's real
`rejectWithValue` string as `payload`) rather than `payload: undefined`.

### 4. `Toast.tsx` — `aria-atomic="true"` on the multi-message live regions re-announces prior toasts (blocking)

`Toast.tsx:155` and `:160` carry `aria-atomic="true"`. D2 justified this as "its `aria-atomic` goes with
the role it qualified" — but on the old design that attribute sat on a node holding exactly **one**
message, where `true` is correct. The regions now hold up to `MAX_VISIBLE_TOASTS` children, and
`aria-atomic="true"` instructs assistive tech to present the *entire* region on any change. So the third
stacked error re-reads all three. That directly contradicts D2's own stated goal ("so nothing is
announced twice") and makes a burst noticeably worse for a screen-reader user than the per-node design
it replaced.

Confirmed live under the burst — the assertive region held three sibling `<span>` children at once:

```
assertive children: ["Failed to delete step: locked by run 2",
                     "Failed to delete step: locked by run 3",
                     "Failed to delete step: locked by run 4"]
```

**Change:** remove `aria-atomic="true"` from both regions in `Toast.tsx:155` and `:160` (the default,
`false`, announces only the added node — which is exactly what the id-keyed children are designed to
deliver, and it preserves the coalesced-repeat re-announcement CR-free). Add a short comment recording
why atomic is wrong for an N-message region so it isn't "restored" later. `Toast.test.tsx:212-223`
already asserts the *card* has no `aria-atomic`; consider a companion assertion that the regions don't
either.

---

## Non-blocking Suggestions

- **`PipelineDetailPage.tsx:460-461` doubles its own message on a non-HTTP failure.**
  `Failed to delete step: ${extractErrorMessage(err, "Failed to delete step.")}` renders as
  "Failed to delete step: Failed to delete step." whenever the error isn't an axios error with a body
  (e.g. offline). Not raised as a change request because all five siblings in the same file
  (`:390`, `:420`, `:502`, `:521`, `:548`) share the identical pattern and the plan explicitly said to
  mirror them — diverging at one site would trade one wart for an inconsistency, which is the opposite of
  this ticket's premise. Worth a follow-up ticket fixing all six together.
- **`--bottom-nav-height` is defined but only one of three consumers uses it.** `theme.css` now names the
  calc, yet `BottomNav.css:27` and `App.css:424` still inline it, so the duplication count is unchanged
  (two literals + one token). Converting those two call sites is a two-line change that would complete
  what the token was introduced for. Deliberately out of the stated Impact scope, so: suggestion only.
- **`Toast.tsx:61-63`'s exit `setTimeout` is not stored in `timerRef` and not cleared on unmount.**
  Harmless today (dispatching `dismissToast` for an already-removed id is a no-op filter), but a toast
  evicted by the cap mid-exit leaves a pending timer. Assigning it to `timerRef.current` would close it.
- **At 430 the 340px viewport with `right: var(--space-6)` leaves an asymmetric ~66px left gutter.**
  Pre-existing, and the spec delta explicitly blesses the `340px` literal, so not a finding here — but
  it is the kind of phone-width proportion the skeptic may want to look at.
- **On desktop the stack overlaps the pipeline detail footer's "Run pipeline" button** for its 4s life.
  Pre-existing consequence of §7's mandated bottom-right placement, unchanged by this ticket.
- **Dev-DB side effects from this review, disclosed:** one step was really deleted from
  `union-eval-pipeline` (an HEL-384 eval artifact) when a route intercept missed the real
  `/api/pipeline-steps/:id` path on my first attempt; and a static source was created and then deleted
  again through the UI. A pipeline schedule created for the header-toggle test was cleared afterwards
  ("No schedule set" verified). No other shared state was modified.

---

## Verification provenance

Every gate result above is from my own fresh run in `WORKTREE_PATH` at commit `839cd7fe`
(`EVALUATOR_CLEAN_WORKTREE: false`, so gates ran in the delivery worktree as normal). No result in this
report is carried over from the executor's report. Every Phase-3 claim is from a live browser
observation, not from reading a test.
