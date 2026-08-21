## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold read. I did not use rounds 1–3 as a checklist: I re-derived the plan's soundness from the code, then
separately checked whether the earlier change requests are genuinely resolved under the re-scoped `ticket.md`.

### What I verified (with evidence)

**Every load-bearing factual claim in `design.md`'s Context — all 14 accurate.** This is the material change from
rounds 1–3, each of which found a false premise about existing code. I found none.

| Claim | Evidence |
| --- | --- |
| `ToastViewport` maps an unbounded `items` over a bare push reducer | `Toast.tsx:92-105`, `toastsSlice.ts:42-50` |
| Every toast is `role="alert" aria-live="assertive"` regardless of intent | `Toast.tsx:61` |
| Entrance uses `--app-transition` (hover token); §3 assigns entrances `--transition-slow` | `toast.css:36`; `theme.css:70-71`; `DESIGN.md` §3 Motion |
| Exit `0.2s` literal duplicated as a hardcoded `setTimeout(…, 200)` | `toast.css:40`, `Toast.tsx:41-43` |
| `toast.css` has no reduced-motion block; the global rule only shortens to `0.01ms` | `toast.css` (whole file), `theme.css:240-247` |
| Toast viewport sits over `BottomNav` at ≤768 | `toast.css:7-9` (`--space-6`, `--z-toast:1000`) vs `BottomNav.css:9-29` (`fixed; bottom:0; z-index:5; height: calc(--control-lg + --space-4 + safe-area)`) |
| `.toast__close` is 20px, no mobile floor | `toast.css:108-109` |
| `finishCreate` toasts for all seven paths; two of them are thunk paths that also fire listeners | `AddSourceModal.tsx:81-87`; `finishCreate` at `:144,:147,:167,:184,:218,:246,:274`; listeners `toastListeners.ts:251,:275` |
| `AddSourceModal.test.tsx:165`/`:515` assert with `.some()` and cannot catch it | read both; `:168-170` is the `.some()` |
| All six named failures are reported nowhere | see next block |
| `toastListeners.ts` is 446 lines / 33 `startListening` effects | `wc -l` = 446; counted 33 (8 dashboards, 7 panels, 7 sources, 2 dataTypes, 5 pipelines, 4 settings) |
| Header comment claims a `renameDashboard` error toast that does not exist while also listing it silent | `toastListeners.ts:7` vs `:23`; no `renameDashboard` import or effect |
| `toast.css` colours are clean (no literal hex/rgb) | read whole file; all `var()`/`color-mix()` over tokens |
| `CONTRIBUTING.md:24` sets the ~400-line threshold | verbatim: "If a file you're editing crosses ~400 lines, propose a split…" |

**The six "swallowed" claims, re-verified independently.** I checked each call site *and* the slice, to rule out
"it actually has a surface, so a new toast is a new collision":

1. `updateDashboardLayout` — `useLayoutSave.ts:87-91` bare `.catch`; `dashboardsSlice` has a `.fulfilled` case only
   (`:267`), no `rejected` → no error state exists to render. Silent. ✔
2. `updatePanelsBatch` — `usePanelUpdatesFlush.ts:90-97` bare `.catch`; `panelsSlice:179` `.fulfilled` only. Silent. ✔
3. `updatePanelColumnWidths` — `TableRenderer.tsx:123` `void dispatch`, no catch; `panelsSlice:154` `.fulfilled` only. Silent. ✔
4. `savePipelineSchedule` (header toggle) — `PipelineDetailPage.tsx:338-351` bare `void dispatch`;
   `scheduleSaveError` (`pipelinesSlice.ts:561`) is referenced by **no** non-test file (`grep -rn scheduleSaveError`);
   `PipelineDetailHeader.tsx:139-144`'s `<Toggle checked={schedule.enabled}>` is store-driven, so it just refuses to move. Silent. ✔
5. `deletePipelineStep` — `PipelineDetailPage.tsx:449-451` `.catch(() => {})`; it is a direct service call
   (`pipelineService.ts:119`), not a thunk, which is why D5 fixes it at the call site rather than in the table. Silent. ✔
6. `deleteMetric` — three dispatch sites (`SidebarBody.tsx:196`, `MetricsPage.tsx:34`, `MetricDetailPage.tsx:64`), none
   unwrapping; `metrics.deleteError` (`metricsSlice.ts:209`) is referenced by **no** non-test file. Silent. ✔

`SaveStateIndicator.tsx` really has no failure state (it renders only "Unsaved changes" / "Last saved …", `:15-21`),
so it cannot cover 1–3. None of the six appears in `toastListeners.ts` today, so no entry collides with an existing one.

**The charter — attacked directly, and it holds.**

- *Does D2's rearchitecture silence any existing toast?* No. I enumerated **every** toast producer in the app:
  `toastListeners.ts`'s 33 effects plus exactly three `useToast()` consumers (`PipelineDetailPage.tsx:61`,
  `PatchSetReviewPage.tsx:34`, `AddSourceModal.tsx:50`) and four direct `dispatch(pushToast(…))` sites
  (`MfaSecuritySection.tsx:68,:75,:77`, `ApiTokensSection.tsx:58,:60`, `MfaEnrollModal.tsx:55`). **Every single failure
  report in the app uses `variant: "error"`.** The only non-`success`/non-`error` toast anywhere is
  `MfaSecuritySection.tsx:68`'s `info` for a *successful* 2FA disable. So D2's intent routing sends every existing
  failure to the assertive region — announcement posture unchanged — and the polite downgrade touches success messages
  only, which is the ticket's stated goal. No failure path is altered.
- *Does D2 make announcement worse in kind?* No — it makes it strictly more reliable. Today's per-node `role="alert"`
  is created together with its content (the exact pattern whose announcement is unreliable); an always-mounted region
  is the conventional fix. Errors keep `role="alert" aria-live="assertive"`, so the strongest existing behaviour is preserved.
- *Does coalescing silently drop an announcement?* No, provided the region's children are keyed by toast id, which
  D1's "re-push with a fresh id" implies: React unmounts the old node and mounts a new one, which is a genuine DOM
  insertion into the live region and therefore re-announces. See note 3 for the one thing to pin.
- *Does anything in the plan depend on the deferred audit?* No. I read every task: 3.1–3.7 are mechanical; 3.3's
  HEL-771 reference is an annotation of a tracked exception, not a dependency; 3.6 explicitly records that absence
  from the tables means "unchanged by this change". No spec requirement is conditioned on the audit's outcome.
- *Does D5's dialog-path duplicate get stated honestly?* Yes, and conservatively — see note 5, where the real
  behaviour is milder than D5 claims, not worse.
- *Is D5's local-state restore correct against its siblings?* Yes. The five siblings are `PipelineDetailPage.tsx:391,
  :421, :490, :509, :536`; the two optimistic ones both revert with a whole-array snapshot
  (`setSteps(previousOrder)` at `:488`, `setSteps(previousSteps)` at `:507`), so "restore" has an unambiguous
  in-file precedent for the executor to copy. `handleRemoveStep` (`:442-453`) is indeed the only step mutation that
  removes before the request and never restores.
- *Does D7's table shape lose anything?* All 15 error effects are literally `action.payload ?? "<fallback>"`, and all
  18 success effects are either a constant or one payload field (`payload.name`, `payload.dashboard.name`,
  `payload.title`) — both expressible as `thunk → fallback` and `thunk → message|formatter` with nothing left over.
  Tasks 3.1/3.7 forbid removal and 5.10 adds the regression guard.
- *D1's exemption vs the sticky Undo toast.* `PatchSetReviewPage.tsx:101-122` is real: `duration: 0` + `action`, pushed
  immediately before `navigate("/")`, with `toastId` closed over so Undo dismisses itself. FIFO eviction would destroy
  it; the exemption is correct, and the "admit the push when all entries are exempt" escape hatch is right because only
  this one site produces an exempt toast.

**Round 3's non-blocking artifact-accuracy items are actually fixed, not reworded.** `proposal.md`'s swallowed-failure
sentence now names the six real paths (verified above, all six accurate); the stale `edit-panellist` Planner Note is
gone and replaced with "grant withdrawn — HEL-770"; the false `useToast` "non-thunk events only" prose is gone; the
`toast.css` literal-removal claim is gone; the Impact list now matches the tasks exactly (Toast.tsx/toast.css,
features/toasts/, AddSourceModal.tsx, PipelineDetailPage.tsx) with no `PatchSetReviewPage.tsx`. Round 2's note that the
cap and exemption requirements contradicted each other is fixed by the "except where the requirement below exempts an
entry" clause (`toast-surface-behavior/spec.md:4-5`) and by scoping the eviction scenario to auto-dismissing toasts.
`design.md` is down to 133 lines, inside the guideline.

**Baseline claim checked.** Task 5.14's "224-suite / 2427-test green baseline" is exact:
`npx jest --silent` in the worktree → `Test Suites: 224 passed, 224 total / Tests: 2427 passed, 2427 total`.

**Scope fence.** `git status` shows the worktree touches nothing outside the change dir; no artifact edits
`PanelList.tsx` and tasks 4.6 + 5.0 pin it. I did not access HEL-528's worktree, branch, ports, or Playwright.

### Verdict: CONFIRM

The narrowed plan is coherent, implementable, and honest. Its charter survives adversarial checking: no toast that is a
failure's only report is removed, every existing failure report stays `error` and therefore stays assertive, six real
silent failures gain a report, and no task or spec requirement depends on the audit that was split to HEL-771. The one
removal (D6) is a genuine duplicate. The design's factual grounding is now sound — I checked twenty-five specific claims
against the code and did not find a false one, which is what the previous three rounds were failing on.

The notes below are all things the executor can act on inside this change; none of them requires a plan revision or a
human decision, so I am not spending a round on them. Notes 1 and 2 are the two I would most want done, and note 1 is
the one I would expect the final gate to check explicitly.

**No earlier change request is left unresolved.** Round 3's CR1/CR3/CR4 and round 2's CR2/CR3/CR7 targeted the policy
audit and are transferred to HEL-771 by the human's split. CR2 (savePipelineSchedule duplicate) is resolved via its
option (b) — annotated tracked exception, task 3.3. CR5b (step-delete restore) is resolved by D5 + task 4.4 + test 5.12.
CR6's four false statements are corrected. Round 1's CR4 (sticky Undo) is resolved by D1's exemption and CR6 (20px
resize) is correctly rejected: `DESIGN.md` §5 names "`Toast`'s 20px dismiss button" verbatim as the blessed exception,
so D4's decision to keep it is the standard's own reading, not a convenience.

### Non-blocking notes

1. **D2 leaves the toast's controls orphaned from their message in the accessibility tree.** After task 2.3, the visible
   card has no role and `.toast__message` is `aria-hidden`, so what remains at the card is an unlabelled "Undo" button
   and "Dismiss notification". For the app's one action-bearing toast (`PatchSetReviewPage.tsx:101` — sticky by
   contract, and the user is navigated away the moment it appears) a screen-reader user who reaches Undo later gets no
   context for it. The message *is* still readable in the visually-hidden region, so this is a loss of association, not
   of announcement — but it is a loss this change introduces. Cheapest fix, fully compatible with the spec scenario as
   written (`toast-surface-behavior/spec.md:87-90`): give `.toast__message` an id and point the action and dismiss
   buttons at it with `aria-describedby` (the accname/description algorithms traverse a referenced subtree even when it
   is `aria-hidden`), or fold the message into the dismiss button's `aria-label`. Worth doing here rather than deferring.
2. **`Toast.test.tsx` contains two assertions the plan directly contradicts, and no task acknowledges them.**
   `:26-30` asserts `queryByRole("alert")` is **null** when no toasts exist — which task 2.1's always-mounted assertive
   region makes false — and `:50-64` asserts `getAllByRole("alert")` has length **4**, which both the role removal and
   `MAX_VISIBLE_TOASTS = 3` make false. Both are green today (I ran them). The hazard is the resolution, not the
   failure: "fixing" `:29` by mounting the assertive region lazily would silently destroy D2's entire justification.
   Add a task line saying these two tests are rewritten to the new contract and that the regions are mounted
   unconditionally.
3. **Pin the live-region keying.** D1's coalescing re-announces correctly *only* if the region's children are keyed by
   toast id (fresh id ⇒ new DOM node ⇒ live-region insertion). If an implementer keys by message or renders a single
   joined string, the coalesced repeat becomes a no-op text-identical update and is never re-announced. Test 5.6 or the
   spec's `:92-94` scenario should assert the re-announcement mechanism (new node), not just presence.
4. **The six new fallback strings are unspecified.** Tasks 3.2–3.4 say "add error entries" without naming the copy, and
   copy is a user-visible decision on a consistency ticket. The existing table's convention is unambiguous
   ("Failed to <verb> <noun>.", 15 instances), so name the six explicitly — in particular avoid an
   internal-sounding "Failed to update panel column widths." for what the user did (resize a column).
5. **D5 overstates the dialog-path duplicate — in the safe direction.** `Modal` uses native `<dialog>` +
   `showModal()` (`Modal.tsx:103`), so while `PipelineScheduleDialog` is open, everything outside it is inert and the
   toast viewport (`z-index: 1000`) is painted *below* the top layer behind `--app-overlay` at 0.62/0.42 alpha plus
   `blur(2px)` (`Modal.css:62-65`). The new `savePipelineSchedule` error toast on that path is therefore effectively
   invisible, unclickable and unannounced — the header toggle is the only real beneficiary. Worth one accurate line in
   D5 instead of "produces a toast alongside an existing inline error", which reads as though the user sees both. (The
   same mechanism means `deletePipelineSchedule`'s "Clear schedule" not gaining a toast creates no *visible*
   asymmetry inside that dialog — it stays HEL-771's to settle.) Separately: that toasts are unusable while any modal
   is open is a real system-level gap in the toast surface; it is not in this ticket's scope, but it is worth a
   follow-up ticket rather than staying folklore.
6. **A same-render-batch burst can drop a toast before it is ever rendered.** Eviction is in the reducer, so if four or
   more distinct failures dispatch in one tick (plausible under an outage now that layout + batch + column-width all
   toast), the oldest never reaches the DOM and is therefore never announced or seen. That is inherent to any cap and
   the spec's "the newest feedback always remains visible" chooses it deliberately — but D1 should say so in one line,
   because `ticket.md`'s AC also promises announcement coverage does not regress and the two need reconciling on paper.
7. **The cap is effectively 2 while an Undo toast is parked.** `duration: 0` + exempt means the patch-set toast holds a
   slot indefinitely until dismissed or replaced. Fine, but worth knowing when choosing `MAX_VISIBLE_TOASTS = 3`.
   Relatedly, an `action`-bearing toast with a *non-zero* duration would be exempt from eviction yet still auto-dismiss
   — harmless today (no such toast exists), but state which property the exemption really tracks.
8. **Reuse the canonical `.sr-only`** (`theme/theme.css:279-287`, explicitly "the canonical home for the sr-only clip
   technique") for the two live regions rather than hand-rolling a clip rect — `PanelDetailModal.appearance.css:169`
   already shows what happens when it is re-derived. Name it in task 2.1.
9. **The mobile offset will be the third copy of the bottom-nav height.** `BottomNav.css:27` and `App.css:424` already
   duplicate `calc(var(--control-lg) + var(--space-4) + env(safe-area-inset-bottom))`. Task 2.8 makes three. A
   `--bottom-nav-height` custom property defined once would be a small, in-scope improvement; if that is too much for
   this change, at least cross-reference the other two so they drift together.
10. **The surface spec's token scenario is broader than what ships.** `toast-surface-behavior/spec.md:101-103` says
    colour, spacing and type "resolve to design tokens rather than literals", while the plan deliberately keeps
    `width: 340px`, the 20px dismiss (§5-blessed), and the ≤4px optical literals (§3-blessed). The requirement's own
    "where a token applies" qualifier covers this, but the scenario as written is refutable in isolation and it is what
    survives archiving. Add the qualifier to the scenario, matching what task 5.13 already blesses.
