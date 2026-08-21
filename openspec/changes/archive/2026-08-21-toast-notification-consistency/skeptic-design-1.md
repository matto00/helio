## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold review. Every claim below is derived from the files in this worktree at
`89e438f6` (base contains HEL-539's squash `3d93e82a`), not from the planning narrative.

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/toast-feedback-policy/spec.md`, `specs/toast-surface-behavior/spec.md`, `workflow-state.md`.

**Binding standards read:** `DESIGN.md` §3 (control metrics, type scale, motion), §4, §5
(icon-only buttons — including the clause that names `Toast`'s 20px dismiss button by
example), §6 (shared primitives), §7 (UI state patterns / "toasts are not a substitute"),
§8; `CONTRIBUTING.md` line 24 (~250-line soft budget, "propose a split" at ~400).

**Inherited HEL-539 ground truth:** `openspec/changes/archive/2026-08-20-error-state-components/`
`design.md` (D1/D2 `classifyRequestError`, `kind: error|forbidden|not-found`, Non-Goals name
HEL-535 and HEL-443) and `skeptic-final-2.md` note 5, which explicitly hands
`fetchPanels.rejected`'s double-signal to HEL-535. `openspec/specs/error-state-pattern/spec.md`
and `shared-inline-error/spec.md` contain no toast requirement, so the proposal's
"New Capabilities, no Modified" framing is correct and there is no spec collision.

**Code facts I confirmed myself (all line numbers re-read, not taken from design.md):**

| Design claim | Verdict |
| --- | --- |
| `toastListeners.ts` is 446 lines / 33 effects; header comment claims a `renameDashboard` error toast (`:7`) that doesn't exist and also lists it silent (`:24`) | Confirmed (`wc -l`, counted `startListening` blocks) |
| 15 component-level `useToast`/`pushToast` sites | Confirmed (grep: Mfa×4, ApiTokens×2, PipelineDetailPage×5, PatchSetReviewPage×3, AddSourceModal×1) |
| `AddSourceModal.finishCreate` toasts for all 7 paths; only `createStaticSource` (`:164`) and `createSqlSource` (`:183`) also hit `.fulfilled` listeners | Confirmed; the other five are direct service calls |
| `Toast.tsx:18` `DEFAULT_DURATION`, `:43` literal `200`, `:61` `role="alert" aria-live="assertive"` for every intent | Confirmed |
| `toast.css` entrance `var(--app-transition)`, `.toast--exiting` literal `0.2s`, `.toast__close` 20px, body `--text-xs`, no `prefers-reduced-motion` block, no literal hex/rgb | Confirmed |
| `theme.css:240` global reduced-motion rule only shortens to `0.01ms`; `MobileNavSheet.css:54` / `RefinementChatDrawer.css:58` are the explicit-opt-out precedent | Confirmed |
| `--z-toast: 1000` (`theme.css:79`) vs `BottomNav.css` `z-index: 5`, `height: calc(--control-lg + --space-4 + env(safe-area-inset-bottom))`; `.toast-viewport { bottom: var(--space-6) }` → phone nav is covered | Confirmed |
| C1 `fetchPanels.rejected` vs `PanelList.tsx:208-223` `StatusMessage` + Retry | Confirmed |
| C3 `DashboardList.tsx:61` `createError` → `InlineError` `:262`, form stays open on failure | Confirmed |
| C5/C6 `DashboardList.tsx:118`/`:131` `actionError` → per-row `InlineError` `:398-399` | Confirmed |
| C7 `PanelCreationModal.tsx:393` `createError` → `NameEntryStep.tsx:114` `InlineError`, modal stays open | Confirmed |
| C9/C10 `AddSourceModal` `error` → `InlineError` `:486`/`:500` and `StaticSourceForm.tsx:255` | Confirmed |
| C12/C13 `AgentMemoryList.tsx:89`/`:141` persistent `InlineError` | Confirmed |
| `SaveStateIndicator.tsx` has no failure state | Confirmed |
| `SidebarBody`'s `onDelete` handlers for sources/pipelines/types `await dispatch(...)` with **no** `.unwrap()` and no inline surface → Tier A for those three is correct | Confirmed |
| `EmptySchemaAffordance.tsx:55` `void dispatch(deleteSource(...))` fire-and-forget → toast is the only feedback | Confirmed |
| `IconButton size="xs"` is exactly 24px, ghost recipe, with a 44px `min-width/min-height` floor at ≤768 already in `IconButton.css` | Confirmed |

**Things the design got right that were non-obvious and that I checked adversarially:**
`submitPipelineRun.rejected` sets `runStatus = null` (`pipelinesSlice.ts:502-507`), and
`PipelineDetailFooter.tsx:179` gates the run-status span on `sseData.status !== null ||
runStatus !== null` — so a rejected *submit* genuinely renders nothing inline. Keeping its
error toast is correct, despite the misleading `// runError is displayed via Redux state`
comments at `PipelineDetailPage.tsx:550`/`:562`. Likewise `updateSource` (rename) is correctly
left silent — `SourceDetailPanel.tsx:208` renders an `InlineError` banner for it.

### Verdict: REFUTE

The surface/motion/a11y half of the plan (D5 mechanics, D7–D9) is largely sound and
well-grounded. The **policy half — which is the ticket's actual deliverable — rests on a
factual premise about the codebase that is false**, in a way that would make the change
introduce eight *new* instances of the exact defect it exists to remove. Two further
mutations fall through the task list entirely, and the cap silently breaks a documented
sticky-toast contract shipped by HEL-343.

---

### Change Requests

**1. (Blocking) D1 Tier C's premise is false for 8 of 13 thunks — as written, tasks 3.7/3.8 would create eight new toast+inline collisions.**

`design.md` Context asserts the auto-save thunks "have neither a listener nor any inline
surface" and "a rejected auto-save is reported nowhere". I checked every one. Eight of them
already catch the rejection and render a **persistent** `InlineError` on the acting surface,
and `PanelDetailModal.tsx:227-228` documents the contract in a code comment:
`// Error surfaced inside the editor via InlineError — leave modal in edit mode`.

| Thunk | Dispatch + catch | Persistent inline surface |
| --- | --- | --- |
| `updatePanelBinding` | `BindingEditor.tsx:303` → `:343-346` `setSaveError` | `BindingEditor.tsx:547` |
| `updatePanelTimeline` | `TimelineEditor.tsx:82` → `:89-92` | `TimelineEditor.tsx:176` |
| `updatePanelTextBinding` | `TextContentEditor.tsx:87` → `:96-99` | `TextContentEditor.tsx:147` |
| `updatePanelMarkdownBinding` | `MarkdownEditor.tsx:82` → `:91-94` | `MarkdownEditor.tsx:142` |
| `updatePanelImage` | `ImageEditor.tsx:98` → `:101-104` | `ImageEditor.tsx:184` |
| `updatePanelDivider` | `DividerEditor.tsx:57` → `:65-68` | `DividerEditor.tsx:140` |
| `updatePanelCollection` | `CollectionEditor.tsx:136` → `:147-150` | `CollectionEditor.tsx:281` |
| `updateDashboardAppearance` | `DashboardAppearanceEditor.tsx:138` → `:144-145` | `DashboardAppearanceEditor.tsx:265` |

All eight return `{ ok: false }`, so the modal/popover stays open and the error persists —
they satisfy Tier B's own two conditions exactly. Adding a Tier C error toast gives each of
them a toast *and* an inline error for one failure, which directly violates this change's own
spec requirement "A failure that renders an inline error state does not also toast".

A further two of the thirteen are **never dispatched anywhere in the app**:
`updatePanelAppearance` and `updatePanelTitle` appear only in `panelThunks.ts`,
`panelsSlice.ts`'s `extraReducers`/re-exports and `toastListeners.ts`'s comment. Listener
entries for them would be unreachable code and unverifiable at the final gate.

The genuinely surface-less set is **three**: `updateDashboardLayout`
(`useLayoutSave.ts:87-91`, bare `.catch(() => {})`), `updatePanelsBatch`
(`usePanelUpdatesFlush.ts:90-97`, bare `.catch`), and `updatePanelColumnWidths`
(`TableRenderer.tsx:123`, `void dispatch` with no catch at all).

Required: rewrite the Context bullet, D1 Tier C, task 3.7/3.8, and the
`toast-feedback-policy` requirement "Continuously auto-saved writes are silent on success and
toasted on failure" (which currently enumerates all thirteen writes by name) so Tier C covers
only the three thunks that actually have no surface. Reclassify the eight as Tier B and say so
explicitly. State what happens to the two dead thunks (my recommendation: omit them and record
them in task 3.10's omissions block as "no dispatch site").

While you are there: note that `updatePanelsBatch` **retains** its pending updates on failure
(`usePanelUpdatesFlush.ts:95-96`) and retries every `AUTO_SAVE_INTERVAL_MS = 30_000`, so
`SaveStateIndicator` does keep showing "Unsaved changes" throughout an outage, and a Tier C
toast will re-fire every 30 s for its duration. Decide and record the intended cadence — "an
error toast every 30 seconds, indefinitely" is a product decision, not an implementation detail.

**2. (Blocking) `deleteDashboard.fulfilled` falls through every carry-over task — the "Dashboard deleted." success toast would be silently deleted.**

`toastListeners.ts:105-110` emits it today. Task 3.2's Tier A list (`deletePanel`,
`duplicatePanel`, `deleteSource`, `deleteDataType`, `deletePipeline`, `submitPipelineRun`)
omits `deleteDashboard`; task 3.3's success-only list omits it; task 3.4 explicitly removes its
*error* entry. Under D3's rule that "silence becomes a property of absence from both tables",
an executor following `tasks.md` literally drops it — a user-visible regression against the AC
("every create/update/delete/duplicate mutation … produces exactly one appropriately-intented
toast"). D1's Tier A parenthetical omits it too, so the design does not classify it either.
Add it explicitly (its acting surface — the sidebar row — unmounts on success, so a success
toast is the surviving feedback; the error is correctly Tier B via `actionError`).

**3. (Blocking) Collision C2's replacement surface does not meet Tier B's own bar, and fixing it collides with the HEL-528 fence.**

D1 Tier B qualifies a surface as "a modal, sidebar row, or detail panel rendering
`InlineError`/`StatusMessage`/`EmptyState intent="error"`". C2 is none of those. `PanelList.tsx:97`
sets `createDashboardError`, which is rendered at `PanelList.tsx:228-230` as the **`description`
string of a neutral `EmptyState`**:

```
description={createDashboardError ?? "Create your first dashboard to start adding panels."}
```

`EmptyState`'s `intent` defaults to `"neutral"` (`EmptyState.tsx:41`), so there is no error
tint, no error glyph and no `role="alert"`; the title still reads "No dashboards yet". Removing
`createDashboard.rejected`'s toast (task 3.4) therefore leaves that path reporting failure as
muted body copy that is never announced — failing both Tier B's stated condition and
`DESIGN.md` §7's "visible, human-readable, **intent-error styled**".

Note also that the correct fix (`intent="error"`, or a `StatusMessage`) lands inside
`PanelList`'s render ladder, which this run's binding fence reserves for HEL-528. Resolve it
explicitly in `design.md` — either keep `createDashboard.rejected`'s error toast for now (and
record C2 as a known, fence-blocked exception with the follow-up), or escalate. Do not leave
the removal justified by a claim the code does not support.

**4. (Blocking) D5's oldest-first eviction silently breaks HEL-343's sticky Undo toast, and contradicts this change's own zero-duration requirement.**

`PatchSetReviewPage.tsx:101-121` pushes `{ variant: "success", message: "Applied.",
duration: 0, action: { label: "Undo", … } }`. Its in-code contract (`:96-100`) is that it is
"dismissed only by an explicit close/Undo click, or the next successful apply's toast replacing
it" — `duration: 0` is called out as REQUIRED because the user navigates away (`navigate("/")`
runs immediately after). Under D5 that toast is by construction the **oldest** entry, so the
next three toasts of any kind evict it and the Undo affordance disappears with no user action.

This also makes two requirements in `specs/toast-surface-behavior/spec.md` mutually
inconsistent: "A zero duration never auto-dismisses" is no longer true in practice once
eviction can remove it. Specify the interaction — e.g. eviction targets the oldest
*auto-dismissing* toast and a `duration: 0` (or `action`-bearing) toast is exempt from
eviction — and add a scenario for it. Dedupe-on-`variant`+`message` is fine here and in fact
implements the "next apply replaces it" clause; it is eviction, not coalescing, that is the
problem.

**5. (Blocking) `submitPipelineRun`'s Tier A treatment is ambiguous and, read one way, adds a redundant success toast.**

D1 defines Tier A as "exactly one toast, `success` on fulfilled **and** `error` on rejected",
and lists `submitPipelineRun`. But `toastListeners.ts` has only a `.rejected` entry for it, and
task 3.2 says "**carry over** the Tier A entries" — so a competent implementer can read 3.2
either as "keep the one entry that exists" or as "Tier A means both, so add the missing
success entry". The second reading is wrong: on success `runStatus` becomes `"succeeded"`
(`pipelinesSlice.ts:495-501`) and `PipelineDetailFooter.tsx:192-197` already renders
"Snapshot replaced: N rows" / "Preview: N rows" inline. Adding a success toast would be a
brand-new redundancy. State explicitly in D1 and task 3.2 that `submitPipelineRun` is
error-only, with the footer named as the success channel.

**6. (Blocking) Task 2.3's 20px→24px resize orphans the only documented justification for hand-rolling `.toast__close`, and re-implements `IconButton` by hand.**

`DESIGN.md` §5 permits a hand-rolled icon-only control "only when it has a genuine, documented
reason `IconButton`'s scale can't express (e.g. **a sub-24px compact size, like `Toast`'s 20px
dismiss button**…)". At 24px that reason evaporates: `IconButton size="xs"` is exactly 24px
(`IconButton.css` `.ui-icon-btn--xs`), carries the same ghost hover recipe, and **already
ships the 44px `min-width`/`min-height` floor at ≤768** that task 2.3 proposes to hand-write.
§6 additionally marks hand-rolled equivalents `[mechanical]`. Pick one and record it:
(a) migrate `.toast__close` to `IconButton size="xs" variant="ghost"` (which also deletes CSS
rather than adding it), or (b) keep 20px and drop task 2.3. If the size changes at all,
`DESIGN.md` §5's example sentence becomes false and must be updated in the same change.

**7. (Blocking) D9/task 2.4 leaves `.toast__action` behind, splitting one card across two type sizes.**

`toast.css:89` sets `.toast__action { font-size: var(--text-xs) }` explicitly. Moving only
`.toast` from `--text-xs` to `--text-sm` yields a 14px message directly above a 12px action
link inside the same toast, where they match today. Either move both (my preference — the
action is body-adjacent, and `StatusMessage`/`InlineError`'s retry actions sit at body size)
or state why they diverge. Also decide `.toast__close`'s `--text-micro` glyph in the same
breath, since CR6 may resolve it for you.

**8. (Blocking) Discrete *update* mutations in the ticket's own enumerated resource set are unclassified.**

The AC covers "create/**update**/delete/duplicate … for dashboards, panels, sources,
pipelines, types". `renameDashboard` (`DashboardList.tsx:93`), `updateSource`
(`SourceDetailPanel.tsx:111`) and `updatePipeline` (`PipelineDetailPage.tsx:569`) are exactly
that, and no tier, task or spec requirement says what they do. D1's four tiers do not cover
the success side of a discrete mutation whose inline surface *persists*: Tier A is "no inline
surface", Tier B legislates failure only ("A success toast is still correct where that surface
unmounts on success" — silent on the case where it doesn't), Tier C is auto-save, Tier D is
reads. Task 3.10 only asks for a comment block. Add the missing rule to D1 and to
`toast-feedback-policy` (e.g. "a discrete mutation whose acting surface remains mounted on
success is silent on both outcomes, because the surface itself shows the new state"), and name
these three so the comment block is derived from a stated rule rather than from the status quo.

**9. (Blocking) D6's scope boundary is incoherent at the one place a user can see it.**

`SidebarBody.tsx` renders the same `SidebarItemList` delete affordance four times: sources
(`:137`), pipelines (`:174`), metrics (`:196`), data types (`:232`). After this change, three
of them toast on success and failure and the fourth — `deleteMetric`, dispatched
fire-and-forget with no surface anywhere, exactly as D6 admits — stays silent. That is two
identical-looking rows in one component behaving differently, which is the precise failure mode
the ticket's own premise names. Meanwhile the plan *does* self-approve two in-place exceptions
outside the "normative" set (agent memory C12/C13; `MfaSecuritySection.tsx:68`'s
`info`→`warning`), both larger than the one-line `deleteMetric` entry would be. Either add
`deleteMetric` (and, if you do, its `MetricDetailPage.tsx:64` / `MetricsPage.tsx:34` siblings
get it for free) or justify in D6 why the same affordance may report differently depending on
which section is open. "Not in the ticket's enumerated list" is not sufficient when agent
memory and MFA are also not in that list.

**10. (Blocking, smallest) D8 defers a decision without defining its acceptance signal.**

D8 knowingly moves three of four intents from `role="alert"` (which screen readers announce on
node insertion) to `role="status"` on a node that is *created together with its content* — the
exact live-region caveat D8 itself names — and resolves it with "The final gate must verify
announcement empirically rather than by inspection." That is a deferred decision with no
stated method and no stated fallback, so the final gate has no pass criterion and, if it fails,
the answer is a re-plan. Record now: (a) how announcement will be verified (which AT/tool, or
which automated assertion), and (b) the fallback if polite toasts do not announce — the
always-mounted visually-hidden polite/assertive mirror pair D8 already evaluated and rejected
is a perfectly good pre-authorised plan B. Keep the minimal fix as the primary; just make the
contingency a decision rather than a discovery.

---

### Non-blocking notes

- **Off-by-one.** `design.md` says "Twelve auto-save thunks" (Context) and "the twelve
  appearance/layout/binding thunks" (D1 Tier C); `tasks.md` 3.7+3.8 and the spec both enumerate
  thirteen. CR1 changes the number anyway, but fix the arithmetic when you do.
- **`toastsSlice.test.ts:48-54` does not lock in the uncapped behaviour.** It pushes exactly
  three toasts with three distinct variants+messages and asserts `toHaveLength(3)` — that still
  passes at `MAX_VISIBLE_TOASTS = 3` and is unaffected by dedupe. Task 5.1's rewrite is
  optional, not forced; the design's use of it as evidence overstates the case.
- **Tier B's definition doesn't match C11.** `SqlTab.tsx:211-215` renders a hand-rolled
  `<p className="add-source-modal__error" role="alert">`, not `InlineError`/`StatusMessage`/
  `EmptyState intent="error"`. The outcome (persistent, announced, on the acting screen) is
  right, so C11 is fine — but phrase Tier B as "a persistent, intent-error-styled inline
  surface" rather than enumerating three components one qualifying site doesn't use.
- **Task 3.3's rationale doesn't hold for `duplicateDashboard`.** The sidebar list stays
  mounted through a duplicate, so "whose surface unmounts on success" is false for it even
  though keeping its success toast is correct. Reword.
- **Direct-service pipeline creation is silent while the thunk path toasts.**
  `ShapeInstantiateStep.tsx:190` (and `ShapePickerModal`'s loop) create a real pipeline *and* an
  output data type through `pipelineService.createPipeline`, with no success toast, while
  `CreatePipelineModal`'s thunk path emits `Pipeline "X" created.` Defensible (it is a sub-step
  of panel creation and the panel toast follows), but it is the same asymmetry D4 is fixing in
  `AddSourceModal`, so it belongs in task 3.10's omissions block by name rather than being
  invisible.
- **Agreed calls, for the record.** D3's rewrite is justified — `CONTRIBUTING.md:24` explicitly
  says a file crossing ~400 lines should be split rather than extended, and 446 lines of 33
  hand-written blocks is the file. D1's reinterpretation of the AC is legitimate: a literal
  reading really would toast on every `updateDashboardLayout` drag, which §7 forbids; the tier
  *concept* is right, the Tier B/C **boundary** is what CR1 moves. Deferring FontAwesome→lucide
  to HEL-443 is the right call — HEL-539 named it a non-goal too, and after CR1 the number of
  failures showing both glyph vocabularies at once drops further.
- **`.toast-viewport { width: 340px }`** is a hardcoded literal with no matching token. It is
  fine under the spec's "where a token applies" wording, but task 5.11's `toast.css.test.ts`
  should be told explicitly whether it is expected to pass, or the executor will guess.
