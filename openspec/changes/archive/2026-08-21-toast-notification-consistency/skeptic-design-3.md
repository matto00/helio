## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Derived cold from the code. I read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` and both spec deltas,
then re-audited the toast inventory from source rather than from `design.md`'s Context, and re-derived every
tier assignment against the real dispatch sites and the real inline surfaces. Prior reports were read only
after the independent audit, to check whether their findings were genuinely closed.

### What I verified (with evidence)

- **Base is what the ticket claims.** `git log --oneline -5` in the worktree shows `3d93e82a HEL-539 Error-state
  components (…) (#406)` in the base, plus `89e438f6`/`35a51017`/`dc9fa673`. Working tree is clean apart from the
  untracked change dir.
- **Independent call-site inventory (not taken from Context).** `grep -rn "useToast\|pushToast\|showToast"` over
  `frontend/src` excluding tests: 15 component sites (`PatchSetReviewPage` ×3, `PipelineDetailPage` ×5,
  `ApiTokensSection` ×2, `MfaEnrollModal` ×1, `MfaSecuritySection` ×3, `AddSourceModal` ×1) plus
  `toastListeners.ts`. I counted the listener file by hand: **15 `.fulfilled` + 18 `.rejected` = 33 effects**,
  matching `design.md:4`. Every one of the 33 has an explicit disposition in tasks 3.2–3.9; nothing falls through.
- **Dispatch-site sweep for every thunk whose toast the plan changes** (`grep` for `dispatch(<thunk>` plus a bare
  `\b<thunk>\b` pass to catch multi-line calls). Confirms `createDashboard` has exactly two sites
  (`DashboardList.tsx:57`, `PanelList.tsx:95`) and `savePipelineSchedule` exactly two
  (`PipelineScheduleDialog.tsx:216`, `PipelineDetailPage.tsx:341`).
- **Full `createAsyncThunk` enumeration** (86 thunks) cross-checked against D1's tier lists — see CR3.
- **Tier C's three surface-less writes are real.** `useLayoutSave.ts:88-91` and `usePanelUpdatesFlush.ts:90-97`
  both `.catch` into an empty body; `TableRenderer.tsx:123` is a bare `void dispatch(...)`.
  `SaveStateIndicator.tsx` has no failure branch (label is only "Unsaved changes" / "Last saved …") — D1 step 3
  and D5's "SaveStateIndicator shows Unsaved changes throughout the gap" are both accurate.
- **Surface/motion facts in Context are accurate.** `toast.css:36` `animation: toast-slide-in var(--app-transition)`,
  `:40` literal `0.2s`, `:7` `bottom: var(--space-6)`, `:13` `width: 340px`, `:108-109` 20px close;
  `Toast.tsx:18` `DEFAULT_DURATION`, `:43` `setTimeout(…, 200)`, `:61` `role="alert" aria-live="assertive"`,
  `:100` unbounded map; `toastsSlice.ts:44` bare push. `theme.css:240-247` only shortens animations to `0.01ms`
  (D9's premise holds); `MobileNavSheet.css:54` is the precedent it cites.
- **D9's `DESIGN.md` §5 citation is exact.** §5 "Icon-only buttons" literally names "a sub-24px compact size, like
  `Toast`'s 20px dismiss button" as the blessed hand-rolled exception. Keeping 20px is right.
- **D6's metrics evidence holds.** `MetricEditorForm.tsx:199` binds the caught value; `:223` renders it;
  `CreateMetricModal.tsx:27-31` closes and navigates; `MetricDetailPage`/`MetricsPage`/`SidebarBody` all drop the
  `deleteMetric` rejection without `.unwrap()`.
- **`openspec validate toast-notification-consistency --strict` → "is valid".**
- **Decisive check, reproduced twice and then executed.** `InlineError.tsx:99` — the default (`variant="text"`)
  render is `return <p className="inline-error">{error}</p>;` — **no `role="alert"`, no `aria-live`**. This is
  deliberate and locked by a shipped test: `InlineError.test.tsx:17` *"renders the bare text treatment by default,
  with no alert role"* asserting `queryByRole("alert")).not.toBeInTheDocument()`. I ran it:
  `npx jest --testPathPatterns="InlineError"` → **11 passed**. See CR1.

### Verdict: REFUTE

The plan is much closer than round 2, and D1's ordered test, D4, D8 and D12 are genuine improvements. But its
central premise — that the inline surfaces replacing the removed error toasts are *announced* — is false for the
majority of them, so as written this change would ship its own new spec requirement violated and would make seven
mutation failures inaudible to a screen-reader user who is told about them today. Two further mutations on the
ticket's own enumerated resources are still unclassified, and D11's new toast quietly creates a second
toast-plus-inline collision that D11 explicitly denies creating.

**Repeat findings — escalate rather than spend another round:** two round-1/round-2 change requests are **not
genuinely resolved**, only relocated.

- **Round-1 CR8** ("discrete *update* mutations in the ticket's own enumerated resource set are unclassified")
  recurs for the **third** time: round 1 caught `updateSource`/`updatePipeline`, round 2 caught `updateDataType`
  and `savePipelineSchedule`, and `deletePipelineSchedule` is still unclassified now (CR3).
- **Round-2 CR3** ("two policy conditions both literally apply to an enumerated member and mandate opposite
  behaviour") recurs one level down, inside the replacement ordered test, at 2a-vs-2b (CR4).

The pattern is that each round fixes the named instances rather than the generative defect (the audit is
enumerated by hand from the listener file, not derived from a closed sweep of the thunk registry; and the tier
predicates are written per-operation while the evidence they test is per-dispatch-site). I recommend the human
decide whether to spend round 4 on a mechanical re-derivation of the whole classification table from the
`createAsyncThunk` enumeration, rather than another round of spot fixes.

### Change Requests

**1. (Blocking) The "announced inline surface" premise is false for most Tier B members. As planned, this change
ships its own new spec requirement violated and silences seven failures for assistive tech.**

D1 step 2 conditions Tier B/B′ on the acting surface owning failure through a *"persistent, intent-error-styled,
**announced** inline surface"*, and parenthesises `InlineError` as the default case that qualifies. It does not.
`InlineError.tsx:99`'s default `variant="text"` renders a bare `<p className="inline-error">` with **no
`role="alert"` and no `aria-live"`** — asserted deliberately by `InlineError.test.tsx:17-22` (green; I ran it).
Only `variant="banner"` carries `role="alert"`, and the word `banner` appears nowhere in any artifact of this change.

Every surface the plan relies on to justify deleting an error toast, except two, is that unannounced default:

| de-toasted operation (task) | surface relied on | announced? |
| --- | --- | --- |
| `importDashboard`, `deleteDashboard`, `duplicateDashboard` (3.5) | `DashboardList.tsx:262`, `:399` | **no** |
| `createPanel` (3.5) | `NameEntryStep.tsx:114` | **no** |
| `createSqlSource`, `createStaticSource` (3.5) | `AddSourceModal.tsx:486`/`:500` | **no** |
| `deleteAgentMemoryEntry`, `clearAgentMemory` (3.7) | `AgentMemoryList.tsx:89`/`:141` | **no** |
| `createMetric`, `updateMetric` (3.4, error side already silent) | `MetricEditorForm.tsx:223` | **no** |
| `savePipelineSchedule` dialog path (3.3) | `PipelineScheduleDialog.tsx:400` | **no** |
| `createPipeline` (3.5) | `CreatePipelineModal.tsx:210` `<p role="alert">` | yes |
| `inferSqlSource` (3.5) | `SqlTab.tsx:212` `<p role="alert">` | yes |
| `fetchPanels` (3.6) | `StatusMessage.tsx:23` `role="alert"` | yes |

Consequences, all three of which block:

- The change's own new requirement — `specs/toast-feedback-policy/spec.md:105-112`, *"An inline surface that
  replaces a toast SHALL be intent-error styled and announced … SHALL be exposed to assistive technology as an
  alert. Rendering the failure as ordinary body copy inside a neutral surface SHALL NOT satisfy this"* — would be
  **false of the shipped code**. Its own scenario (*"WHEN creating a panel, creating a pipeline, or creating a data
  source is rejected and no toast is emitted THEN the acting surface renders the failure with the error intent and
  an alert role"*) is directly refutable at the final gate for `createPanel` and both source creates. This is the
  exact defect class round-2 CR5 caught for `disableMfa` — a normative requirement the change writes and then
  ships violated — and D13 claims to have eliminated it.
- **Accessibility regression.** Today a failed dashboard delete / panel create / source create is announced
  assertively via the toast (`Toast.tsx:61`). After this change it is announced **not at all**: a `<p>` inserted
  into a static subtree with no live region. `ticket.md`'s AC makes `aria-live` semantics an acceptance criterion;
  net coverage must not go backwards.
- D1's discriminator becomes untestable as stated: if `InlineError`-by-default qualifies as "announced", the word
  has no content; if it does not, then Tier B is empty except for `createPipeline`.

Required: decide and record how each de-toasted surface becomes announced, and add tasks for it. The in-scope,
zero-redesign option is to pass `variant="banner"` (a prop HEL-539 shipped) at the ~7 named call sites — consuming
HEL-539's components, not redesigning them — or to wrap those specific renders in an announced container as
`PanelContent.tsx:91` already does. Do **not** change `InlineError`'s default (that is redesigning a merged
component, and `InlineError.test.tsx:17` pins it). Whatever is chosen, state it in D1/D2, list the call sites in
tasks §4, and add a final-gate check that each de-toasted failure is announced exactly once.

**2. (Blocking) D11's new `savePipelineSchedule` error toast creates a second toast+inline double report — the very
thing this change exists to remove — and D11 asserts the opposite.**

`savePipelineSchedule` has two dispatch sites: `PipelineScheduleDialog.tsx:216` (`.unwrap()` → `setError` →
`InlineError` at `:400`, dialog stays open) and `PipelineDetailPage.tsx:341` (bare `void dispatch`). Task 3.3 adds
a single `savePipelineSchedule` entry to `ERROR_TOASTS`. Emission is per-thunk — D13's own premise — so the dialog
path will now render its inline error **and** fire a toast. D11 states *"`PipelineScheduleDialog.tsx:216`/`:229`
are unaffected — both `.unwrap()` into an `InlineError`"*; they are not unaffected, they are exactly the surfaces
that acquire a duplicate report. And D13's closing line — *"`createDashboard` is the only operation this applies
to today"* — is false: `savePipelineSchedule` is a second instance of precisely the D13 shape (two sites, one
conforming, one not), and unlike `createDashboard` this duplicate is **newly introduced by this change** rather
than inherited.

Required: (a) correct D11 and D13 to state the consequence accurately; (b) apply D13's own procedure — annotate
the `savePipelineSchedule` entry as a tracked exception in the table (as task 3.5a does for `createDashboard`) and
file/name the follow-up that removes it once the header toggle reports inline; **or** (c) reject the duplicate by
having the header toggle own its failure (`.unwrap()` + revert the `Toggle` + an announced inline error in
`PipelineDetailHeader`), which is outside every fenced region and would leave both sites conforming with no toast
at all. Choose explicitly; do not leave the plan asserting a collision it creates does not exist.

**3. (Blocking) `deletePipelineSchedule` is an unclassified discrete mutation on an enumerated resource — the third
recurrence of round-1 CR8.**

`deletePipelineSchedule` (`pipelinesSlice.ts`) is dispatched from `PipelineScheduleDialog.tsx:229`, behind the
**"Clear schedule"** button at `:250-256` — a real, reachable control sitting inches from the "Save" button whose
thunk this change *does* classify. It appears in **no** artifact: not in D1's tier lists, not in tasks 3.2–3.9,
not in task 3.11's omissions block, not in either spec delta (`grep -rn deletePipelineSchedule proposal.md
design.md tasks.md specs/` → no matches). Applying D1 mechanically: step 2 (dialog owns failure inline), then 2a
(`onClose()` on success) → **Tier B, success toast**. So the plan's own rule requires an entry it does not add,
and the shipped result is that one dialog's two buttons give different feedback — "Save" toasts on failure only,
"Clear schedule" says nothing on either outcome. That is the inconsistency `ticket.md`'s premise targets.

Required: classify `deletePipelineSchedule` and add its table entry (or a named, reasoned omissions entry), and —
because this is the third round in which a hand-enumerated audit missed a live mutation — state in D3 how the
omissions block is *derived* (e.g. "every `createAsyncThunk` in `frontend/src/features/**/state/**` appears in
`SUCCESS_TOASTS`, `ERROR_TOASTS`, or the omissions block, with the loop over the registry as the checklist"), so
completeness is verifiable at the final gate instead of re-audited by eye each round. `exportDashboard`
(`DashboardList.tsx:136-141`, sibling of delete/duplicate in the same row menu, also unclassified) is the second
miss and should be resolved by the same sweep.

**4. (Blocking) D1's ordered test still does not decide every operation uniquely — round-2 CR3's defect class,
one level down.**

Two independent holes:

- **2a and 2b are not ordered relative to each other, and the "mere removal or re-rendering" carve-out is scoped
  only to step 4.** Applied literally to `duplicateDashboard`: `DashboardList` owns failure inline (step 2 matches),
  the surface neither unmounts, closes nor navigates on success (2a's parenthetical is false), and it "stays mounted
  and itself displays the new state" — the new dashboard row (2b true) → **Tier B′, silent on both outcomes**. But
  `design.md:66-69` lists `duplicateDashboard` in Tier B, *success toast*. The test and the enumeration contradict
  each other for an enumerated member. The same ambiguity decides `deleteDashboard` only by reading "acting surface"
  as *the row* rather than *the list* — a granularity the design never defines. Fix: define "acting surface", and
  hoist the "mere removal or re-rendering of an item is not a display of the new state" clause so it governs step 2
  as well as step 4 (both in D1 and in `specs/toast-feedback-policy/spec.md:78-86`).
- **The test's inputs are per-dispatch-site while emission is per-thunk.** `savePipelineSchedule` classifies as
  **Tier B** on the dialog path (step 2 → 2a: owns failure inline, closes on success ⇒ success toast, no error
  toast) and **Tier A′** on the header-toggle path (no inline surface ⇒ error toast, no success toast). D13
  arbitrates only the *error* half of such a split; nothing in D1 or the spec arbitrates the *success* half, and
  D11 silently picks "no success toast" by fiat. `createDashboard` has the same split (2a on `DashboardList`, 4b on
  `PanelList`) and happens to agree on the success side, which is why it has gone unnoticed. Fix: state the
  per-operation resolution rule for **both** outcomes ("where dispatch sites classify differently, the operation
  takes … "), and make D11's choice follow from it rather than precede it.

**5. (Blocking) The new intent rule is violated by an existing toast the plan leaves untouched, and one new toast
will contradict what the user can see.**

- `PipelineDetailPage.tsx:421` pushes `variant: "error"` with the message *"Shape only partially applied: N of M
  steps were added (…)"*. Under the change's own intent rule (`design.md:88-89`; spec `:153-156`) — *"`warning` =
  succeeded but left a degraded or partial state"* — a partial application is textbook `warning`. D9's copy/intent
  pass corrects only `MfaSecuritySection`'s `info`→`warning`, and no task re-checks the six component step toasts
  against the rule the change is introducing. Add that sweep (it is one line per site) or record why `error` is
  right here. Note also that D1 4a mischaracterises this cluster: `:421` is a batched shape apply, not an
  "optimistic-revert step operation", and `:391` deliberately *keeps* the temp step on failure
  (`"Keep temp step if POST fails"`), so "the six optimistic-revert step operations" is inaccurate for two of six.
- Task 5.3 adds an error toast to `handleRemoveStep` (`PipelineDetailPage.tsx:443-452`), but that handler removes
  the step from local state **before** the DELETE and its five siblings all restore previous state on failure
  (`setSteps(previousOrder)` / `setSteps(previousSteps)`); this one deliberately does not (*"No-op: the step is
  already gone from the local view"*). Adding only the toast produces "Failed to delete step: …" while the step is
  visibly gone and still exists server-side. Decide: revert the local removal alongside the toast (matching the
  siblings), or record why the contradiction is acceptable.

**6. (Blocking, smallest) Four durable-artifact statements are false and will be archived.**

- `proposal.md:5-9` still says *"several mutation failures (dashboard rename, appearance/layout/panel updates) are
  silently swallowed"*. `DashboardList.tsx:101` binds the caught value into `editingError` and `:324` renders it;
  the eight editor writes each render a persistent `InlineError` (`design.md:22-30` says so itself). Only the three
  Tier C writes are swallowed. This is round-1 CR1's refuted premise surviving in the proposal after design.md was
  corrected — the two artifacts now contradict each other.
- `design.md:242-243` (Planner Notes) still reads *"D10 (`edit-panellist`, fence lifted for two named edits)"*,
  three lines above the bullet recording that the grant was **withdrawn**. An executor skimming Planner Notes for
  its fence is told the opposite of D10. Delete the stale clause.
- `design.md:97-99` says component `useToast` *"stays legal only for non-thunk events — clipboard copies, the
  patch-set Undo affordance, …"*. `PatchSetReviewPage.tsx:87-121` dispatches `applyPatchSet` and toasts for its
  outcome, and the Undo action dispatches `undoPatchSet` and toasts for its outcome; both are thunks. The spec text
  (`:10-12`, scoped to *"a thunk that has a toast table entry"*) is correct — the design prose is not. Align it.
- `design.md:17-21` lists `DashboardList.tsx:118`/`:140` among the generic setters to be fixed. `:118` has drifted
  to `:122` (tasks §4 already use `:122`), and **`:140` is the `exportDashboard` setter**, not a de-toasted site —
  it is in neither task 4.1–4.5 nor task 4.6's "no change needed" list, so it currently reads as an omission.
  Either correct the Context line or add `:140` to 4.6.

Also correct `proposal.md`'s Impact list, which omits `DashboardList.tsx` and `PanelCreationModal.tsx` (tasks
4.1–4.3 edit both) and includes `PatchSetReviewPage.tsx`, which no task touches; and either drop its claim of
*"removal of the remaining off-token literals in `toast.css`"* (no task does this — `design.md:35` says "Colours
are clean" and task 6.12 only blesses `width: 340px`) or add the task and name which literals stay
(`border: 1px`, `border-left: 3px`, `.toast__icon`'s `margin-top: 1px`, `.toast__close`'s `margin: -2px -4px 0 0`,
`.toast__action`'s `text-underline-offset: 2px`).

### Non-blocking notes

- **D8 leaves the message duplicated in the accessibility tree.** With the text rendered into the visually-hidden
  region *and* in `.toast__message` inside the same `role="region" aria-label="Notifications"` landmark
  (`Toast.tsx:99`), a screen-reader user browsing that landmark encounters the message twice. Not a double
  *announcement* (the plan is right about that), but worth specifying `aria-hidden="true"` on `.toast__message`
  (keeping the action and dismiss buttons reachable), or mounting the live regions outside the landmark. Task 2.3
  should also say what happens to `aria-atomic="true"` on the card.
- **D5's coalescing interacts with D8.** Re-pushing an identical `variant`+`message` replaces a node whose text is
  unchanged; whether that re-announces depends on the DOM mutation React emits for the new key. Worth one assertion
  in task 6.5/6.9 so the final gate does not have to guess.
- **The listener rewrite is a good call and the tables are the right shape.** D3, D4, D7 and D12 are sound, and
  keeping `.toast__close` at 20px per §5 is the correct reading of the standard — round 1 was wrong to ask for 24px.
- **Task 3.11's "every silent thunk"** is followed by a partial list; the current header enumerates ~25. Tie it to
  the derivation asked for in CR3 so "every" is checkable.
- **Design.md length.** At ~257 lines it is well past the 150-line guideline, and the overage is now partly
  litigation history rather than decision content (D10's three paragraphs of overruled-but-correct reasoning). If a
  round 4 happens, consider moving the round-by-round narrative out of `design.md` and leaving the decisions.
