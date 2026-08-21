## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review at base `89e438f6` (contains HEL-539's squash `3d93e82a`). Every claim below was re-derived
from the files in this worktree; `skeptic-design-1.md` was read only afterwards, to check which of its
findings were genuinely resolved rather than reworded. No browser was needed at this gate.

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/toast-feedback-policy/spec.md`, `specs/toast-surface-behavior/spec.md`, `workflow-state.md`,
`skeptic-design-1.md`.

**Binding standards read:** `DESIGN.md` §3 (control metrics, type scale, Radius/Shadow/Motion), §4, §5
(icon-only buttons, incl. the clause naming `Toast`'s 20px dismiss by example, `DESIGN.md:221-225`), §6,
§7 (`DESIGN.md:267-277`), §8. `CONTRIBUTING.md:24`.

**Ground-truth code facts I confirmed myself (line numbers re-read, not taken from `design.md`):**

| Claim under test | Verdict |
| --- | --- |
| `toastListeners.ts` is 446 lines, 33 effects; header `:7` claims a `renameDashboard` error toast that does not exist and `:24` also lists it silent | Confirmed |
| 15 component `useToast`/`pushToast` sites (PatchSet×3, PipelineDetailPage×5, ApiTokens×2, MfaEnroll×1, MfaSecurity×3, AddSourceModal×1) | Confirmed |
| Task 3.2–3.11 account for **all 15** existing `.fulfilled` and **all 18** existing `.rejected` entries with none orphaned (incl. `deleteDashboard.fulfilled`) | Confirmed by enumeration — round-1 CR2 is genuinely closed |
| Every de-toasted thunk's dispatch sites (`createDashboard` ×2, `importDashboard`, `duplicateDashboard`, `deleteDashboard`, `createPanel`, `createPipeline`, `createSqlSource`, `createStaticSource`, `inferSqlSource`) are exactly those named in `design.md` | Confirmed by grep — no unlisted site |
| Tier B surfaces are persistent + intent-error + announced: `DashboardList.tsx:262`/`:398`, `NameEntryStep.tsx:114`, `CreatePipelineModal.tsx:210` (`role="alert"`, `--app-error`), `SqlTab.tsx:211` (`role="alert"`, `--app-error`), `AddSourceModal.tsx:486`/`:500` | Confirmed |
| Tier B′ editors: `BindingEditor.tsx:547`, `TimelineEditor.tsx:176`, `ImageEditor.tsx:184`, `DashboardAppearanceEditor.tsx:265` all `InlineError` + `{ ok: false }`; `PanelDetailModal.tsx:226-233` returns early on `!ok` and `setModalMode("view")` on success — the surface really does stay mounted and show the new state | Confirmed (4 of 8 spot-checked end-to-end) |
| Tier C's three are genuinely surface-less: `useLayoutSave.ts:87-91` bare `.catch`, `usePanelUpdatesFlush.ts:90-97` bare `.catch` + 30 s retry, `TableRenderer.tsx:123` `void dispatch` no catch | Confirmed |
| `updatePanelAppearance` / `updatePanelTitle` have **no dispatch site anywhere** | Confirmed by exhaustive grep |
| D5's sticky exemption protects `PatchSetReviewPage.tsx:101-122` (`duration: 0` + `action`) — and is in fact *required* by an already-merged spec: `openspec/specs/patch-set-preview/spec.md:112-125` ("only an explicit user dismissal, or a later toast replacing it, removes it") | Confirmed; round-1 CR4 fully closed and better-grounded than the design claims |
| D9 withdrawal 1 (keep 20px): `DESIGN.md:221-225` names `Toast`'s 20px dismiss by example; `Toast.tsx:78-79` carries both `aria-label` and `title` | Confirmed correct, not merely convenient |
| D9 withdrawal 2 (keep `--text-xs`): `InlineError.css:4` and `:41` are both `--text-xs`; `toast.css:89` `.toast__action` is `--text-xs` | Confirmed correct |
| `toast.css:36` entrance uses `--app-transition` (hover token, `theme.css:70`) where `--transition-slow` (`:71`) is §3's entrance token; `:40` literal `0.2s`; no reduced-motion block; `theme.css:240-248` only shortens to `0.01ms`; no colour literals | Confirmed |
| `.toast-viewport { bottom: var(--space-6) }`, `--z-toast: 1000` vs `BottomNav.css:20,27` `z-index: 5`, `calc(--control-lg + --space-4 + env(safe-area-inset-bottom))` — the stack does cover phone nav | Confirmed |
| D6's premise: `SidebarBody.tsx` renders the same `SidebarItemList` delete four times at `:137`/`:174`/`:196`/`:232`, all `await dispatch(...)` with no `.unwrap()` | Confirmed, line-exact |
| D6's live-defect claim: `metricsSlice.ts:207-210` writes `deleteError`, and `deleteError`/`createError`/`updateError` are **read by no metrics component** — so `deleteMetric` failure really is reported nowhere | Confirmed |
| D6's metrics classification: `MetricEditorForm.tsx:201` binds the caught value, `:223` `InlineError`; `CreateMetricModal.tsx:27-31` closes + navigates; `MetricDetailPage.tsx:49-51` navigates | Confirmed |
| D10: `EmptyState.tsx:87-88` gives `intent="error"` a `role="alert"`; `PanelList.tsx:226-237`'s description is `createDashboardError ?? "Create your first…"` on a default-neutral `EmptyState` | Confirmed |
| D10's out-of-bounds claim about `PanelList.tsx:246`, checked against the user-supplied HEL-528 evidence: HEL-528 `tasks.md:59` says verbatim "That missing `EmptyState` is a pre-existing §7 gap owned by HEL-548; do not close it here" | Confirmed — the fence claim is accurate |
| An existing merged spec already forbids `inferSqlSource`'s toast: `openspec/specs/sql-database-connector/spec.md:129,138` ("no toast or navigation occurs") | Confirmed — task 3.5 brings the code *into* compliance |

**Round-1 change requests, re-checked against code rather than against the revision's narrative:**
CR1 resolved (with one spec-scenario remnant, CR7 below); CR2 resolved; CR3 resolved via escalation;
CR4 resolved and independently justified by `patch-set-preview`'s spec; CR5 resolved (Tier A′ + task 3.3);
CR6 resolved by withdrawal, verified against §5; CR7 resolved by withdrawal, verified against `InlineError.css`;
CR9 resolved via escalation and factually correct; CR10 substantially resolved (the pre-authorised fallback is
real and is the valuable half). **CR8 is only partially resolved** — see change request 2.

---

### Verdict: REFUTE

The surface/motion/a11y half (D5, D7–D9) is now well-grounded, and the two escalated decisions (D6, D10)
rest on facts I independently confirmed. D6's shared-affordance test is *factually* accurate about
`SidebarBody`, and I do not think it is dishonest — but it does not actually govern the plan's other scope
calls (it would exclude `deletePipelineStep`, which task 6.4 fixes anyway), so it functions as a
justification for metrics rather than as a rule. That matters only because the audit — the ticket's real
deliverable — still has holes a stated rule would have closed: one enumerated-resource mutation whose
failure is swallowed outright, one unclassified, and a tier boundary that the spec states in a
self-contradicting way. There is also a copy split that leaves one modal producing two different success
toasts for the same user action, which is the ticket's own premise failing.

---

### Change Requests

**1. (Blocking) `savePipelineSchedule` from the header toggle swallows its failure entirely, and no tier covers it.**

`PipelineDetailPage.tsx:338-351`:

```ts
function handleToggleScheduleEnabled(nextEnabled: boolean) {
  if (!id || !pipelineSchedule) return;
  void dispatch(savePipelineSchedule({ pipelineId: id, request: { …, enabled: nextEnabled, … } }));
}
```

No `.unwrap()`, no `.catch`, no `.rejected` consumer. `pipelinesSlice.ts:559-562` writes
`scheduleSaveError`, and I grepped the whole frontend: `scheduleSaveError` / `scheduleSaveStatus` are read
by **nothing outside two test files**. The control is
`PipelineDetailHeader.tsx:139-144`'s `<Toggle checked={schedule.enabled} …>`, whose `checked` derives from
`state.schedule[pipelineId]`, only written on `.fulfilled` — so on failure the switch silently refuses to
move, with no toast, no inline error and no console-visible signal. That is a discrete update to a resource
the ticket enumerates ("pipelines"), reported nowhere, which `DESIGN.md:274-275` forbids — the exact defect
class task 6.4 fixes for `deletePipelineStep` two hundred lines below it in the same file.

`design.md`'s "Only three writes are genuinely surface-less" is true only *within the thirteen auto-save
thunks*; as a statement about the audit's coverage it is false. Classify this site (its shape is Tier A′ —
error-only, since the toggle position is the success feedback) and add a task, or record it in D3's
omissions block as a named, reasoned exclusion. Note `PipelineScheduleDialog.tsx:216`/`:229` are fine —
both `.unwrap()` into `InlineError` at `:400`; it is only the header toggle that is bare.

**2. (Blocking) `updateDataType` is still unclassified — the same defect class as round-1 CR8, at a new site.**

Types are in the ticket's enumerated resource list and `update` in its verb list. `TypeDetailPanel.tsx:97-111`
dispatches `updateDataType`; failure sets `error` from `result.payload` and renders at `:202` as a
persistent `<p className="type-detail-panel__error" role="alert">`; success sets `saved` and the panel stays
mounted. It is textbook Tier B′ — but neither D1's Tier B′ enumeration
(`design.md:70-71`) nor `specs/toast-feedback-policy/spec.md:73-75` ("This governs renaming a dashboard,
renaming a data source, saving a pipeline, and the editor-owned panel and dashboard-appearance writes")
names it, and task 3.10 does not tell the executor to include it in the omissions block — while the header
comment being replaced (`toastListeners.ts:27`) *does* list `updateDataType` as silent. Round 1 required
these to be "derived from a stated rule rather than from the status quo"; for this one they still are not.
Add it to Tier B′, to the spec sentence, and to task 3.10.

**3. (Blocking) Tier A and Tier B′ overlap, and the two spec requirements give contradictory answers for every Tier A member.**

Tier B′'s stated condition is "discrete mutation whose acting surface stays mounted and itself shows the new
state" (`design.md:69-70`), encoded as `specs/toast-feedback-policy/spec.md:71-75`. That condition is true of
**all five Tier A members**: deleting a panel leaves `PanelGrid` mounted with the card gone
(`PanelCard.tsx:211`); deleting a source/pipeline/type leaves `SidebarItemList` mounted with the row gone
(`SidebarBody.tsx:137`/`:174`/`:232`); duplicating a panel leaves the grid mounted with a new card
(`PanelCard.tsx:201`). So `spec.md:40-42` ("A mutation with no inline surface toasts on both outcomes") and
`spec.md:71-75` ("…stays mounted … is silent on both outcomes") both literally apply to `deletePanel` and
mandate opposite behaviour.

The real discriminator is not mounted-ness, it is **whether the surface owns *failure* inline** — every
Tier B′ member has one (`editingError`, `SourceDetailPanel`'s banner, the eight `InlineError`s), every Tier A
member has none. Make Tier B′'s condition conjunctive ("owns failure via a persistent, intent-error-styled,
announced inline surface **and** remains mounted on success, itself displaying the new state") in D1 and in
the spec text, and state the tier selection as an ordered test. Task 6.5 documents this policy beside
`useToast` as the durable artifact — as written it would encode the contradiction, and a developer at a new
call site genuinely cannot resolve "delete a metric" from the stated rules alone (only D6's prose decides it).

**4. (Blocking) One modal, one button, two different success-toast copies for the same user action.**

`AddSourceModal.finishCreate` (`:81-87`) pushes `"Source added."` for all seven create paths. After D4, the
five direct-service paths (`:144`, `:147`, `:218`, `:246`, `:274`) keep that toast, while the two thunk paths
(`:167`, `:184`) fall through to the listeners, which say `Data source "X" created."` (task 3.9 makes both
thunk copies "created."). Result: adding a CSV source says **"Source added."**; adding a SQL source from the
same modal says **`Data source "netflix" created.`** — different wording, one naming the resource and one
not. Task 6.2 only asks to verify the five "still toast exactly once", so nothing in the plan closes this.
`finishCreate` has `name` in scope, so the unified copy is available directly. Decide it in D4 and add the
task, or state why the two families should read differently. The ticket's premise is that two flows of the
same mutation must not end up with visibly different feedback.

**5. (Blocking) D3 states a MUST NOT that the shipped change would leave violated, and the spec encodes it.**

D3: "A component MUST NOT toast for a thunk it dispatches." `specs/toast-feedback-policy/spec.md:4-6`:
"a component SHALL NOT emit a toast for a thunk it dispatches." But `MfaSecuritySection.tsx:63-70` does
exactly that:

```ts
const result = await dispatch(disableMfa(reauthCode));
if (disableMfa.fulfilled.match(result)) { closePrompt(); dispatch(pushToast({ variant: "info", … })); }
```

Task 6.3 changes only the intent word, so the codebase ships violating its own new normative requirement,
with no recorded exception. D6's justification for the MFA edit — "corrections to rows already in the table"
(`design.md:118-119`) — is also factually wrong here: there is no `disableMfa` row in `toastListeners.ts`;
it is a component call site, not a table row. Either move `disableMfa` into `SUCCESS_TOASTS` (a one-line
entry that also fixes the intent), or carve the exception explicitly in D3 **and** in the spec requirement so
the rule is true of the code that ships.

**6. (Blocking, judgment — my domain) D10 knowingly ships the app's only off-pattern error-intent `EmptyState`.**

Every `intent="error"` `EmptyState` HEL-539 shipped pairs it with an error icon *and* an error title:
`TypeRegistryPage.tsx:27-29` ("Couldn't load types"), `SourcesPage.tsx:56-58`, `PipelinesPage.tsx:44-46`,
`PipelineDetailPage.tsx:608-610`, `ProposalReviewPage.tsx:180-182`. D10's authorised edit produces a sixth
that diverges on both: an error-tinted `role="alert"` hero whose icon is `faTableColumns` and whose Fraunces
title reads **"No dashboards yet"**, with the raw rejection payload as its description — announced to a
screen reader as "No dashboards yet. <server error>." `design.md:160-162` calls this out as a "Known
residual … reads oddly for an error state" and absorbs it as a follow-up.

I do not think that is the right call for a ticket whose entire premise is consistency of feedback, and
whose skeptic explicitly owns this judgment. The fix is the *same shape of edit* the human already
granted — a conditional prop on that one element — and touches none of the fenced regions
(`PanelList.tsx:34-38`, `:156-159`, `:246`, `:258`, `.panel-list__zoom-container`). Either escalate once for
a conditional `title` (and ideally `icon`) on the same `EmptyState`, or record in D10 why an error alert with
a neutral title and a content icon is acceptable beside its five siblings. Do not ship a surface the design
itself describes as reading oddly.

**7. (Blocking, smallest) A `toast-feedback-policy` scenario names a write its own requirement excludes.**

`specs/toast-feedback-policy/spec.md:52-57` narrows Tier C to "only the dashboard layout write, the batched
panel write, and the panel column-width write" (correct, per round-1 CR1). But `:67-69` still reads:

```
#### Scenario: A rejected panel appearance save is reported
- **WHEN** a panel appearance write is rejected
- **THEN** exactly one error toast is emitted
```

"Panel appearance write" names none of the three, and matches `updatePanelAppearance` — the thunk this very
change documents as having **no dispatch site anywhere** (task 3.10). An executor writing the test for this
scenario will either write an unreachable-thunk test or guess. This is the one un-swept remnant of round-1
CR1. Reword it to the batched panel write (which is the path a panel-appearance save actually takes, via
`PanelDetailModal.tsx:213-221`'s `accumulatePanelUpdate` → `usePanelUpdatesFlush`), or drop it.

**8. (Blocking, smallest) `proposal.md` says "Modified Capabilities: None", but the change falsifies a merged spec's Purpose.**

`openspec/specs/settings-agent-memory-ui/spec.md:3-7` states the surface has "visible error feedback **and
toast parity matching every other destructive delete action in the app**." Task 3.7 removes the agent-memory
error toasts (correctly — `AgentMemoryList.tsx:89`/`:141` own them inline), while Tier A gives every other
destructive delete both a success **and** an error toast. After this change that Purpose sentence is false.
There is no normative requirement to amend, so this is a one-line Purpose fix — but per HEL-528's own
task 6.9, `specs-apply.js` never applies a delta's `## Purpose`, so it has to be an explicit AT-ARCHIVE task.
Add it, and correct the proposal's "None" claim.

---

### Non-blocking notes

- **`updatePanelsBatch`'s retry cadence is described inaccurately.** D5 says the retries "coalesce into a
  single continuously-refreshed toast". With coalescing plus the 4 s default, the actual behaviour is a toast
  that appears for 4 s, dismisses, and reappears 26 s later — indefinitely, for as long as the outage lasts
  (`usePanelUpdatesFlush.ts:95-96`, `AUTO_SAVE_INTERVAL_MS = 30_000`). That is a blinking error, not a
  persistent one. Round 1 asked for the cadence to be decided and recorded; it is recorded, just mis-stated.
  Worth either restating accurately or giving that one toast `duration: 0` so it parks instead of flashing.
- **The six `PipelineDetailPage` step-operation toasts fit no tier.** `:391`, `:421`, `:490`, `:509`, `:536`
  (plus the one task 6.4 adds) are error-only, optimistic-revert, direct-service mutations. D3 blesses them as
  legal component uses, but Tier A′ is written as a single named exception for `submitPipelineRun` rather than
  as a rule, so the largest cluster of component toasts in the app is undocumented by the very policy task 6.5
  writes beside `useToast`. Generalising A′ ("a discrete mutation whose surface reverts on failure: error
  only") would cover them for free.
- **`toast-surface-behavior`'s cap requirement and its exemption requirement contradict each other literally.**
  `spec.md:3-10` says state "SHALL hold at most a fixed maximum" and "holds exactly the maximum"; `:17-21`
  permits exceeding it when all entries are exempt. The intent is obvious and the exemption is right; qualify
  the first requirement so the pair reads consistently. (The unbounded-growth worry is theoretical today —
  `PatchSetReviewPage.tsx:101` is the only site that produces an exempt toast, and it navigates away.)
- **D8's stated acceptance signal does not discriminate.** "Reading the accessibility tree of the live region"
  reports `role`/`aria-live` attributes — the same thing `Toast.test.tsx` asserts — and cannot detect the one
  risk D8 names (a live region created together with its content may not announce). The pre-authorised
  fallback is the genuinely valuable half of the round-1 fix, and it is also the conventional correct pattern;
  consider promoting the always-mounted visually-hidden polite/assertive pair to primary rather than
  contingent, since the primary's failure is not observable at the final gate.
- **Line-reference drift** (none ambiguous, all worth fixing so the executor doesn't chase them):
  `PanelCreationModal.tsx:393` → the setter is `:395`; `MetricEditorForm.tsx:199` → `:201`;
  `DashboardList.tsx:118` → `:122`; `AddSourceModal`'s `finishCreate` calls are at `:167`/`:184`, not
  `:164`/`:183` (those are the dispatch lines); the `EmptyState` is `:226-237`.
- **`DashboardList.tsx:140` (export) is listed among the "seven generic setters" whose toast is dropped**
  (`design.md:19`), but `exportDashboard` has no listener entry — there is no toast to drop, so task 5.2's
  export clause is a harmless improvement rather than a D2 obligation. Conversely `DashboardList.tsx:159`
  (import) *is* a de-toasted site and already binds the payload, but appears in neither the "seven generic"
  nor task 5.5's "already specific" confirm list; add it to 5.5 so the audit is closed on paper too.
- **`design.md` at ~187 lines against the 150-line guideline: justified.** The overage is decision content
  (per-site Tier B/B′/C evidence, the two escalated decisions' constraints), not implementation detail, and
  it is flagged rather than silently exceeded. Keep it.
- **Agreed calls, for the record.** D3's table rewrite is warranted (`CONTRIBUTING.md:24`, 446 lines).
  D5's exemption is not merely defensible — `patch-set-preview`'s merged spec requires it. D9's two
  withdrawals are both correct against the standard, not convenient. D1's reinterpretation of the literal AC
  remains legitimate. Task 3.5's removal of `inferSqlSource`'s toast also fixes a pre-existing violation of
  `sql-database-connector`'s spec, which the design could cite in its favour.
