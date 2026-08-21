## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Ticket: HEL-535 · Change: `toast-notification-consistency` · Branch head `745a8841` (base `89e438f6`).

Derived cold from ground truth. I read `ticket.md`, `design.md`, both spec deltas and the full
`git diff 89e438f6...HEAD`, then drove the running app at 5967/8874 with my own headless Chromium
(no MCP Playwright). Prior reports were read as claims, not facts. Round 1's three findings are
re-verified separately at the end, each with the instrument that would catch a fake fix.

---

### What I verified (with evidence)

#### Gates — all four re-run fresh by me

```
npm run lint            → eslint . --max-warnings=0                    LINT_EXIT=0
npm run format:check    → All matched files use Prettier code style!   FMT_EXIT=0
npm test                → Test Suites: 226 passed, 226 total
                          Tests:       2475 passed, 2475 total          EXIT=0
npm --prefix frontend run build → PWA v1.3.0, precache 28 entries      BUILD_EXIT=0
```

`scripts/concertino/assert-phase.sh servers … → PASS servers`.

#### AC 1 — "no failure in the six named paths is left reported nowhere; each emits exactly one error toast"

Verified live, with the request stubbed at the exact endpoint so nothing reached the backend:

| path | how | result |
| --- | --- | --- |
| `deletePipelineStep` | `DELETE /api/pipeline-steps/:id` → 500 `{"error":…}` | `Failed to delete step: step is referenced by running job 2` |
| `deleteMetric` (error) | `DELETE /api/metrics/:id` → 500 | `Failed to delete metric.` (one toast, assertive region) |
| `deleteMetric` (success) | `DELETE /api/metrics/:id` → 204 | `Metric deleted.` (one toast, polite region) |
| `savePipelineSchedule` (header toggle) | `GET …/schedule` stubbed to a live schedule, `PUT …/schedule` → 500 | `Scheduler is offline.` — the toggle no longer refuses silently |
| `updatePanelColumnWidths` | evaluator's pasted live output (`evaluation-2.md` CR3): forced-500 keyboard column resize → `Failed to resize columns.` | matches `panelThunks.ts:308` |
| `updateDashboardLayout`, `updatePanelsBatch` | table rows keyed off the real imported thunk creators; `toastListeners.test.ts` dispatches each thunk's **real** `rejectWithValue` string (not `payload: undefined`) and asserts exactly +1 toast | wiring identical to the four I drove live |

`handleRemoveStep`'s optimistic-removal rollback is real, not just a toast: steps in view before/after a
failed delete were **20 → 20** for both a bodyless 500 and a hard network failure.

#### AC 2 — one action, one toast, one wording

Real static-source create through the add-source modal (thunk path, which used to double-toast):

```
toasts:    ['Data source "alpha" created.']     ← exactly one
polite:    ['Data source "alpha" created.']
assertive: []
requests:  ['POST /api/data-sources']
```

(The source got named "alpha" because I mis-targeted a form field — my error, not the app's; cleaned up,
see the side-effect ledger.) `AddSourceModal.test.tsx` now asserts `toHaveLength(1)` on both a
direct-service path and the thunk path (with `listenerMiddleware` genuinely wired in via
`renderWithStore`'s new `withToastListeners`), replacing the `.some()` assertions that could not fail.

#### AC 3 — cap, eviction, sticky exemption, one duration

Real burst: four **distinct** step-delete failures fired in ~1.5s through the UI.

```
STUBBED: 4 (all intercepted; BLOCKED list empty — nothing reached the backend)
toasts:  ["…running job 2", "…running job 3", "…running job 4"]   ← 3, oldest evicted
rects:   [1076,681,340,60] [1076,749,340,60] [1076,816,340,60]    ← 8px gutter, newest at the bottom
```

Two identical failures coalesced to one entry live. Auto-dismiss measured end-to-end at **4565 ms**
(4000 + 200 exit + overhead). Sticky/`duration: 0`/action-bearing exemption and the all-exempt admit are
covered by `toastsSlice.test.ts` (I read them; they assert order, not just length).

#### AC 4 — announcement semantics, verified in Chrome's computed accessibility tree

`Accessibility.getFullAXTree` over the live page, with toasts present:

```
{"role":"status","live":"polite",   "atomic":false,"relevant":"additions text"}
{"role":"alert", "live":"assertive","atomic":false,"relevant":"additions text"}
LIVE REGION status children: []
LIVE REGION alert  children: [{"role":"StaticText","name":"Metric is bound to 3 panels."}]
```

- Routing by intent is correct in the live DOM: errors only in assertive, success/info/warning only in polite.
- `.sr-only` computes to the real clipped recipe (`position:absolute; 1px×1px; clip:rect(0,0,0,0); overflow:hidden; visibility:visible`) — not `display:none`, so the regions are genuinely exposed.
- The visible message is `aria-hidden`, but the dismiss button's **computed description** is the message
  text (`description: "Metric is bound to 3 panels."`) — a directly-referenced hidden node still feeds
  `aria-describedby`, so the controls are not orphaned. Checked, not assumed.
- **Net coverage does not regress.** I diffed the base file's 33 `actionCreator:` entries against the new
  tables: all 33 survive (15 success + 18 error), plus 6 additions (5 error + `deleteMetric` success).
  One wording change only (`createSqlSource` "connected." → "created."). Nothing announced today became
  unannounced; the per-node `role="alert"` was replaced by regions that carry every message.
- Keyboard: 2 × Tab reaches `.toast__close`; `:focus-visible` computes `2px solid rgb(249,115,22)` at
  `outline-offset: 2px` (DESIGN.md §8's global rule); Enter dismisses.

#### AC 5 — surface, motion, mobile (measured, not read)

| viewport | `.toast__close` | `.toast__close` margin | viewport `bottom` | BottomNav top | overlaps nav? |
| --- | --- | --- | --- | --- | --- |
| 1440 | 20 × 20 | `-2px -4px 0 0` | 24px | (no nav) | — |
| 768 | **44 × 44** | `-12px -12px 0 0` | 72px | y=968, card bottom 952 | **false** |
| 430 | **44 × 44** | `-12px -12px 0 0` | 72px | y=876, card bottom 860 | **false** |

Both themes at all three widths; identical geometry, correct token colours
(dark `--app-surface-strong` = `rgb(38,35,32)` / light `rgb(255,255,255)`; error accent
`rgb(240,117,97)` dark / `rgb(199,58,42)` light; success `rgb(76,195,138)`).

Motion:

```
reducedMotion=reduce         entrance: animationName "none", transform "none", opacity 1
                             exit:     toast already removed, 27 ms — no exit animation at all
reducedMotion=no-preference  entrance: toast-slide-in 0.28s  (--transition-slow, §3's entrance token)
                             exit:     toast-fade-out 0.2s, removed after ~638 ms
```

Reduced motion **disables**, it does not shorten. DESIGN.md's blessing of the 20px dismiss is real —
line 223 names "`Toast`'s 20px dismiss button" verbatim as the sub-24px carve-out, and it carries both
`aria-label` and `title` as that carve-out requires. Surface token is right per line 85
(`--app-surface-strong` = "modals/popovers/toasts").

#### Design judgement — the part the evaluator can't make

I looked at the screenshots, in both themes, at 1440/768/430.

- The stack reads as one system with HEL-539's error surfaces. Side by side (`fetchPanels` forced to 500
  renders the `StatusMessage` banner and the toast simultaneously): same `--app-radius-md`, same
  `var(--space-3) var(--space-4)` padding, the same `color-mix(in srgb, <intent> 30%, transparent)`
  hairline, the same leading-icon flex row. The toast differentiates itself as an *overlay* — neutral
  elevated surface with a 3px intent bar — where the inline banner tints its own background. That
  distinction is legible and deliberate rather than accidental drift.
- Copy is action-shaped, not "Error": `Failed to resize columns.`, `Failed to save dashboard layout.`,
  `Metric deleted.`, `Dashboard "X" created.`. The step-delete fallback now reads as a reason, not a
  restatement.
- Stacked errors at 1440 look ordered and calm; the 8px gutter and 3-item cap keep the corner from
  becoming a wall.
- Nothing here feels cheap or off-pattern to me. I would ship this surface.

#### Scope fence

`git diff --name-only` touches 15 frontend files; `PanelList.tsx` is **not** among them, no loading
branch/skeleton/render ladder is touched, and HEL-528's worktree, branch and ports were never accessed.
`toastListeners.ts` 446 → 214 lines (back under CONTRIBUTING.md's threshold). One `any` in
`AsyncThunkResultCreator`, documented as mirroring RTK's own `TypedActionCreator` bound; no
`eslint-disable` anywhere in the diff and lint is clean at `--max-warnings=0`.

---

### Round 1's three findings — re-verified independently

1. **Atomic live regions — genuinely fixed.** Chrome's computed AX tree now reports `atomic: false` on
   both regions (round 1's whole point was that the *absent* attribute left them `atomic: true`). The
   test guard was **inverted**, not left pinning the broken state: `Toast.test.tsx:228-229` now asserts
   `toHaveAttribute("aria-atomic", "false")` on both regions while they hold two messages, where it
   previously asserted `not.toHaveAttribute("aria-atomic")`. My live 3-error burst put three separate
   `StaticText` children in the assertive region with `relevant: "additions text"`, so only the new node
   is announced.
2. **`Failed to delete step: Failed to delete step.` — genuinely fixed.** Bodyless 500 (`text/html` body)
   → `Failed to delete step: the request could not be completed.` Hard network failure → same. Server-body
   arm still works: `{"error":"step is referenced by running job 2"}` →
   `Failed to delete step: step is referenced by running job 2`. Both measured in the running app.
3. **Literal `-12px` — genuinely fixed, and cycle 2's source-order fix still holds.** The margin is
   `calc(var(--space-3) * -1)` in source, and the *computed* margin at both 430 and 768 is
   `-12px -12px 0px 0px` with a **measured 44 × 44** rect — so the floor genuinely resolves; it is not
   dead code. `toast.css.test.ts`'s guard is order-aware (it compares the media block's source index
   against the base rule's), so moving the block back above the base rule fails the test.

---

### Verdict: CONFIRM

Ships. Every acceptance criterion traces to evidence I produced myself; round 1's three findings are
closed by the right instrument in each case; the design judgement is favourable.

---

### Non-blocking notes (all follow-ups — none blocks this ticket)

1. **Four sibling step handlers still have the exact defect round 1 caught.** In the same file, 40–90
   lines from the fixed one: `PipelineDetailPage.tsx:509-510` → `Failed to reorder steps: Failed to
   reorder steps.`, `:555-556` → `Failed to duplicate step: Failed to duplicate step.`, and `:528-531`
   → `Failed to enable step: Failed to update step.` on any bodyless failure. All three predate this
   branch (present at `89e438f6`) and none is one of the six named swallowed failures, so fixing them
   was not this ticket's job — but the file now reads inconsistently, and it is a four-line change if
   the human would rather close it here than file it.
2. **Toasts are inert and effectively invisible behind an open modal.** Verified live:
   `document.elementFromPoint` at the toast's centre returns `.ui-modal` while a native `<dialog>` is
   open, and the toast is dimmed behind `--app-overlay`. `design.md` D5 states this and I confirm it is
   true, not a convenient assumption. Consequence worth tracking: an auto-save failure
   (`updatePanelsBatch`'s 30s flush) that lands while a modal is open is still effectively silent, which
   partially undercuts one of the six closures.
3. **Desktop stack overlaps bottom-right page controls.** At 1440 the card
   (`[1076, 816, 340, 60]`) covers `panel-list__zoom-widget` (`[1274, 850, 146, 30]`) on a dashboard and
   the "Run pipeline"/"Dry run" footer on pipeline detail, and `.toast` sets `pointer-events: auto`, so
   those controls are click-blocked for ~4s. Pre-existing (the desktop `bottom: var(--space-6)` is
   unchanged), and the AC only covers the phone nav bar — but this ticket fixed the mobile analogue, so
   the desktop one is the natural sibling follow-up.
4. **Two of the six new listener tests exercise an unreachable arm.** `savePipelineSchedule` and
   `deleteMetric` both always supply a string through `extractErrorMessage(err, "<fallback>")`, so
   `payload: undefined` cannot occur in production for them — the same critique `evaluation-1.md` CR3
   made of the other three, which *were* converted to real payloads. The asserted strings do match each
   thunk's own fallback, so nothing is wrong; the tests are just weaker than their siblings.
5. **Observed while testing, unrelated to this change:** `metricsSlice.ts:22`'s local
   `extractErrorMessage` reads only `data.message`, never `data.error`, so a backend route that returns
   `{"error": …}` degrades a metric-delete toast to the generic fallback. Pre-existing per-slice
   duplicate of `services/extractErrorMessage.ts`.
6. Toast body type is `--text-xs` while HEL-539's `StatusMessage` is `--text-sm`, and the error icons
   differ (`faCircleXmark` in the toast vs `faTriangleExclamation` inline). They still read as one
   family; noting it only because a future token sweep may want to reconcile the pair.

---

### Side effects I caused (disclosed)

Net zero — every write was reverted, and all mutation stubs were verified to have intercepted the call
(the global guard `route.abort()`s any unstubbed `DELETE`, and its blocked list came back empty every run).

- Created dashboard `HEL-535-skeptic-scratch` → deleted through the UI (`remaining scratch dashboards: []`).
- Created a static data source (mis-named "alpha" by my own form-fill error) → deleted, `204`; its
  auto-created data type `alpha` → deleted, `204`; `recent types remaining: 0`.
- `SWEEP-editor-audit` step count: **20 before, 20 after**. Metrics: both `SWEEP-audit metric v2` and
  `Eval Test Metric` still present. The pre-existing "alpha" source from 01:35 (not mine) is untouched.
