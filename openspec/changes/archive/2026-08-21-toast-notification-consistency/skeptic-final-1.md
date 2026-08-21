## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the files, the diff against `main`, and the app
running at `http://localhost:5967` (backend `8874`). `evaluation-1.md` / `evaluation-2.md` /
`files-modified.md` were read as *claims* and re-tested, not accepted.

---

### What I verified (with evidence)

#### Gates re-run myself

| Gate | Result |
| --- | --- |
| `npm run lint` (`eslint src --max-warnings=0`) | exit 0, zero warnings |
| `npx jest --ci` (full suite) | 226 suites / **2473 tests passed** |
| `npm run build` | succeeds (only the pre-existing chunk-size advisory) |
| `scripts/concertino/assert-phase.sh servers …` | `PASS servers` |

#### The `toastListeners.ts` rewrite is behaviour-preserving (the flagged structural risk)

I mechanically extracted `(thunk, kind) → message` from `git show main:…/toastListeners.ts` (33
hand-written blocks) and from the new `SUCCESS_TOASTS`/`ERROR_TOASTS` tables and diffed them:

```
CHANGED createSqlSource.fulfilled : "Data source \"${…name}\" connected." => "… created."
ADDED   deleteMetric.fulfilled / deleteMetric.rejected / savePipelineSchedule.rejected /
        updateDashboardLayout.rejected / updatePanelColumnWidths.rejected / updatePanelsBatch.rejected
--- identical entries: 32   differences: 7
main count: 33   head count: 39
```

All 33 of `main`'s entries survive, byte-identical apart from the one D6-documented wording change.
Nothing was silently dropped or re-worded.

I then went further and exercised **every one of the 39 rows in the live app**, dispatching each
`.rejected` type with `payload: undefined` (fallback path) and each `.fulfilled` type with a synthetic
payload, reading toast state after each. All 39 produced **exactly one** toast with exactly the expected
variant and wording — so the `type`-string registration used by the rewrite is complete and collision-free.
(`panels/deletePanel.fulfilled` threw inside the *panels* reducer on my synthetic `{}` payload — a probe
artifact, not a toast-listener defect; the toast still fired for it in the real Metrics/Panels flows.)

#### AC 1 — six previously-swallowed failures, each driven for real in the browser

Not unit tests — real gestures with the specific endpoint forced to fail via request interception:

| Path | How I triggered it | Result |
| --- | --- | --- |
| `updateDashboardLayout` | resize a panel → **Save now**, `PATCH /api/dashboards/*/update` aborted | 1 toast, `Failed to save dashboard layout.`, assertive region |
| `updatePanelsBatch` | pending panel edit → **Save now**, `POST /api/panels/updateBatch` aborted | 1 toast, `Failed to save panel changes.` |
| `updatePanelColumnWidths` | real keyboard column-resize on the HEL-255 table panel, `PATCH /api/panels/:id` aborted | 1 toast, `Failed to resize columns.` |
| `savePipelineSchedule` (header toggle) | clicked the header `<Toggle>`, `PUT …/schedule` aborted | 1 toast, `Failed to save pipeline schedule.`; toggle correctly refuses to move |
| `deletePipelineStep` | Remove step with `DELETE /api/pipeline-steps/:id` failing after 1.5 s | step count **20 → 19 → 20** (optimistic restore works) + 1 toast |
| `deleteMetric` | Metrics → Delete → Confirm, `DELETE` aborted / stubbed `204` | `Failed to delete metric.` and `Metric deleted.` respectively, 1 toast each |

I also confirmed `metricsSlice.deleteError` is written but **rendered nowhere** — so `deleteMetric`'s
failure really was reported nowhere before, and `SaveStateIndicator.tsx` contains no error/failure
branch at all, so the auto-save premise holds too.

#### AC 2 — one action, one toast, one wording (add-source de-duplication)

Both halves driven through the real modal with the `POST` stubbed (no DB write):

- direct-service path (Text/Markdown → From URL): **1** toast, `Data source "Skeptic Probe Source" created.`
- thunk path (Manual/static → `createStaticSource`): **1** toast, `Data source "Skeptic Manual Source" created.`

Identical wording, no double-toast on the thunk paths. I also checked every one of the five
direct-service callers guards `!name.trim()` before reaching `finishCreate`, so the interpolated
name can never render empty.

#### AC 3 — cap / eviction / coalescing / sticky exemption (live store, not unit tests)

- 5 auto-dismissing pushes → state and DOM hold exactly **3**, newest retained, oldest evicted
  (screenshot `31-burst-cap-light.png`).
- identical variant+message pushed twice → **1** entry, fresh id (so it re-mounts and re-announces).
- sticky `duration: 0` + `action` toast plus 4 further pushes → sticky survives; the evicted entry is
  the oldest auto-dismissing one.
- all-exempt state still accepts a new push (5 `duration: 0` pushes → 5 retained), matching the spec's
  documented carve-out.
- auto-dismiss measured end-to-end: **4213 ms** (4000 + the 200 ms exit), uniform across intents.

#### AC 5 — surface, motion, mobile

- Entrance computed style: `animation-name: toast-slide-in`, `animation-duration: 0.28s` → `--transition-slow`,
  §3's entrance token, not `--app-transition`.
- Reduced motion (`reducedMotion: 'reduce'` context): `animation-name: **none**` — genuinely disabled,
  not shortened. Dismissal-to-removal **28 ms** vs **247 ms** normally, so the exit delay is elided.
- 430 px and 768 px, both themes: toast viewport bottom edge **828 px**, BottomNav top edge **844 px**
  → 16 px clearance, nothing obscured. `.toast__close` computes to **44 × 44** (CR1's source-order fix
  really is live now, verified by computed geometry rather than by CSS text).
- Focus ring on `.toast__close`: `rgb(249,115,22) solid 2px`, offset `2px` — exactly DESIGN.md §8.
- Screenshots at 1440 light/dark, 430 light/dark, 768 dark: intent accent from the intent tokens, opaque
  `--app-surface-strong`, consistent rhythm across all four intents, good light/dark parity. Placed beside
  HEL-539's merged error surfaces (Data Types page with `GET /api/types` failing —
  `27-inline-vs-toast-dark.png`), the toast and the inline/`EmptyState` error read as **one system**:
  same error red, same icon language, same type scale. No console errors in any non-forced run.

#### AC 4 — announcement (this is where it fails; see CR1)

Verified good: both live regions are present **before any toast exists**
(`<div class="sr-only" role="status" aria-live="polite"></div>` and the `role="alert"` twin, empty, on
first paint); intent routing is correct (error → assertive only, others → polite only); the visible card
carries no `role`/`aria-live`; `.toast__message` is `aria-hidden="true"` and the Chrome AX tree confirms
the `aria-describedby` wiring still resolves (`AX BUTTON name="Dismiss notification" description="Applied 4
changes." focusable=true`), so the controls are not orphaned; a coalesced repeat mounts a fresh node and
is re-announced; Undo fires from the keyboard.

**But the regions are still atomic.** See CR1 — reproduced in two independent browser sessions plus a
five-arm control experiment.

---

### Verdict: REFUTE

One blocking accessibility defect (CR1) that the cycle-1 change request was reported as fixing but was
not, plus two smaller in-scope items.

---

### Change Requests

#### 1. (blocking) `evaluation-1.md` CR4 is **not** fixed — both live regions are still atomic, and a new test + comment now pin the wrong thing

`frontend/src/shared/ui/Toast.tsx:167` and `:172` removed the explicit `aria-atomic="true"` attribute.
That does not make the regions non-atomic: `role="status"` and `role="alert"` each carry an **implicit
`aria-atomic="true"`**, so the effective semantics are unchanged from cycle 1. Chrome's accessibility
tree for the running app (`Accessibility.getFullAXTree`, reproduced in two separate sessions):

```
AX LIVE REGIONS:
  role= status  props= {"live":"polite","atomic":true,"relevant":"additions text"}
  role= alert   props= {"live":"assertive","atomic":true,"relevant":"additions text"}
```

Control experiment run in the same page, five arms, to prove the reading is the role's doing and not a
CDP default:

```
bare <div aria-live="polite">            -> role=generic  atomic=false
<div role="status"  aria-live="polite">  -> role=status   atomic=true      <- app's polite region
<div role="alert"   aria-live="assertive">-> role=alert   atomic=true      <- app's assertive region
<div role="status" … aria-atomic="false">-> role=status   atomic=false
<div role="alert"  … aria-atomic="false">-> role=alert    atomic=false
```

Consequence — exactly the behaviour D2 says it avoids: with three messages live, every addition
re-presents the whole region, so a burst announces `A`, then `A B`, then `A B C`. That contradicts the
spec delta's own stated purpose ("The visible toast element SHALL NOT itself carry a live-region role,
**so that no message is announced twice**") and it is a regression against `main`, where each toast was
its own single-message atomic region and a burst announced each message exactly once.

Three things need fixing together:

- `Toast.tsx:167` → `<div className="sr-only" role="status" aria-live="polite" aria-atomic="false">`
- `Toast.tsx:172` → `<div className="sr-only" role="alert" aria-live="assertive" aria-atomic="false">`
- `Toast.tsx:150-166` — the comment currently asserts a falsehood ("The default (`false`/unset) announces
  only the newly added node") and instructs maintainers *not* to add atomicity control back. Rewrite it to
  say the roles imply `aria-atomic="true"` and that the explicit `"false"` is load-bearing, so a future
  "tidy-up" doesn't delete it.
- `frontend/src/shared/ui/Toast.test.tsx:214-224` — the guard
  `expect(assertiveRegion).not.toHaveAttribute("aria-atomic")` asserts the *absent attribute*, which is
  precisely the state that leaves the region atomic. It passed while the bug was live, and it would now
  fail the fix. Change it to `toHaveAttribute("aria-atomic", "false")` on both regions.
  (`Toast.test.tsx:241`'s "the visible card carries no `aria-atomic`" assertion is correct and should stay.)

`evaluation-2.md` §CR4 verified this by inspecting raw `outerHTML` for the attribute rather than the
computed accessibility semantics — the same class of measurement gap as cycle 1's dead-CSS finding.

#### 2. (blocking) New toast copy renders as `Failed to delete step: Failed to delete step.`

`frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:460-461`:

```ts
const message = extractErrorMessage(err, "Failed to delete step.");
pushToast({ variant: "error", message: `Failed to delete step: ${message}` });
```

`extractErrorMessage` returns the fallback whenever the response carries no `error`/`message` field —
i.e. any network failure, offline, aborted request, or non-JSON 5xx. Reproduced in the running app twice:

```
DELETE /api/pipeline-steps/… aborted
TOASTS: [{ "cls": "toast toast--error", "m": "Failed to delete step: Failed to delete step." }]
```

With a server-supplied body the same line reads correctly
(`Failed to delete step: Step is referenced by a downstream binding.`), so only the fallback arm is wrong.
Give the fallback a *reason*-shaped string rather than a restatement of the prefix — e.g.
`extractErrorMessage(err, "the request could not be completed.")` — or drop the prefix when
`extractErrorMessage` returned the fallback. The ticket's own AC calls for copy that names what failed;
a doubled sentence is the "toast that says Error where the app knows what failed" failure mode.
(The four sibling handlers at `:390`, `:420`, `:502`, `:548` have the same shape and are pre-existing —
fixing them is optional here, but at minimum do not add a sixth.)

#### 3. (blocking, small) Hardcoded `-12px` margins in the new mobile block violate DESIGN.md §3 spacing

`frontend/src/shared/ui/toast.css:173`:

```css
@media (max-width: 768px) {
  .toast__close { width: 44px; height: 44px; margin: -12px -12px 0 0; }
}
```

`44px` is fine — DESIGN.md:130 explicitly blesses the literal mobile tap-target floor. The margins are
not: §3 Spacing is marked **[mechanical]** — "All margin/padding/gap use a `--space-*` token (small
optical tweaks ≤ 4px may be literal)". `12px` is `--space-3`, and `-12px` is three times the blessed
optical-tweak ceiling. The base rule's `-2px -4px` is within the carve-out; these are not. Use
`margin: calc(var(--space-3) * -1) calc(var(--space-3) * -1) 0 0;`. The change's own spec delta asserts
"every colour, spacing, and type value for which a design token applies resolves to that token rather
than a literal", and there are already three open token-drift tickets (HEL-652/680/677) — this adds a
fourth instance.

---

### Non-blocking notes

- **`--bottom-nav-height` did not actually consolidate anything.** `theme/theme.css:86` introduces the
  token, but `shared/chrome/BottomNav.css:27` and `app/App.css:424` still each inline the identical
  `calc(var(--control-lg) + var(--space-4) + env(safe-area-inset-bottom))`. There are now **three**
  copies, not one, despite the comment's stated rationale. Pointing those two at the token is a
  two-line follow-up (or fold into HEL-771).
- **A same-tick burst of more than three toasts drops the oldest before they are ever announced.**
  Five pushes in one React commit → the live region only ever contains the final three; the first two
  are never rendered into any region. This follows directly from the cap requirement the ticket asks
  for, so I'm not refuting on it, but it is a narrow announcement-coverage hole worth recording.
- **A persistent `updatePanelsBatch` failure re-pushes every 30 s** (`usePanelUpdatesFlush.ts:39`,
  `AUTO_SAVE_INTERVAL_MS`) because pending updates are retained and retried. Coalescing keeps it to one
  card, but each coalesce mints a fresh id and therefore re-announces. Tolerable at 30 s; would be
  obnoxious if that interval ever shortens.
- **The schedule-dialog double-report is real but genuinely invisible.** I confirmed
  `document.elementFromPoint` at the toast's centre returns the native `<dialog>` while a modal is open,
  so the toast is occluded exactly as the `toastListeners.ts:175-183` comment claims. It is still
  announced assertively though — and since `InlineError` has no `role="alert"`, that is the *only*
  announcement, so this is arguably a net positive rather than a duplicate. Correctly deferred to HEL-771.
- **Toast controls sit at the very end of the tab order** (the viewport is portalled to the end of
  `document.body`), so reaching Undo by Tab from the page top takes 60+ presses on a dashboard with a
  long sidebar. Unchanged from `main`; noting it only because "reachable by keyboard" is an AC and the
  literal answer is "yes, eventually".
- `--toast-exit-duration: 200ms` is a scoped literal with no matching motion token (`--app-transition`
  0.16s / `--transition-slow` 0.28s). It preserves the pre-change value and duration is outside the spec
  delta's colour/spacing/type scope, so I am not raising it — but a `--transition-exit` token would close it.
- The five direct-service add-source paths interpolate the *client-side* `name.trim()` while the two
  thunk paths use the *server-returned* `payload.name`. Identical today; would diverge if the backend
  ever normalises names.

---

### Shared-environment side effect I caused (disclosure)

While driving the pipeline step-delete flow, one of my request-interception patterns was mis-scoped
(`**/api/pipelines/**`; the real endpoint is `/api/pipeline-steps/:id`), so **one real `DELETE` reached
the backend and removed a step from the `SWEEP-editor-audit` pipeline**
(`6ba5075b-2291-4508-881b-a517b1f300cf`) in the shared dev database — 21 steps before, 20 after. Every
other mutation in this review was either aborted or stubbed at the browser and never reached the server.
No other worktree, branch, or port was touched; ports 5967/8874 only.
