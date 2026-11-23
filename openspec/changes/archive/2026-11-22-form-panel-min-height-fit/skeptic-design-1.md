## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `cba523c030821c709ba227ab8c06a59f9ab913fc` (branch `bug/form-panel-min-height-clip/HEL-1618`). The change dir is untracked, and no code has changed yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-panel-min-height-clip/HEL-1618`.
- **Design context claims, checked against the live code:**
  - `FormPanelView.tsx` is 481 lines (`wc -l`). That is correct.
  - `handleImmediateStep` runs from line 179 to line 306, about 128 lines. The "~130 lines" claim is correct.
  - The non-owner quiesce branch is at lines 225-228 and calls only `onReconcileFailed?.()`. That is correct. The ticket's "220-223" is older numbering of the same branch.
  - `onReconciled` (the HEL-1819 clear, `if (!burstRejectedRef.current) values.setExternalErrors({})`, lines 300-302) is reachable only from the owner's fetch branch (line 242), and only from the indeterminate catch. That is correct.
  - `burstRejectedRef` is reset only when a click starts with an empty pending map (line 188). That is correct.
  - The success settle already clears `externalErrors` unconditionally (line 258). So the only stale path for a non-owner is a later burst that quiesces on an indeterminate settle. D2 targets exactly that.
  - Backend `PanelPacker.scala` has `PanelKind.Form -> ClampBounds(minW = 3, minH = 5, ...)`. The frontend `panelGridConfig` uses `minH: panelGridConfig.itemHeights.min` for every breakpoint and every kind. Both claims are correct.
- **D2 logic, traced:**
  - Scenario 1: an editor's step is rejected. The burst quiesces and the rejection tail passes no callbacks. A new click resets `burstRejectedRef`, then fails with no response. On the non-owner branch, the new callback clears the error and `onReconcileFailed` announces. That is correct.
  - Scenario 2: two steps are in flight. One is rejected, so `burstRejectedRef` becomes true. The indeterminate step settles last, the guard holds, and the error is kept. That is correct, and dropping the guard would turn it red.
  - Caveat: if the rejection settles LAST, the error is kept no matter what the guard does. So the same-burst test must order the indeterminate settle after the rejection, or the guard mutation proves nothing.
  - D2 makes no dataset request, so it stays consistent with HEL-1784's "never reads the dataset".
- **D1 shape:**
  - The split boundaries (a hook for the burst machinery, two presentational bodies) are sound. The alternative was rightly rejected.
  - The new files stay in `ui/form/`, so relative `jest.mock` module paths still resolve to the same modules, and "no test edits" is feasible.
- **D3 phasing:** measure, then stop, escalate, amend and re-gate before any fit code. This is sound.
  - The ticket itself marks the option a product/UX call needing escalation.
  - Phase A (split + D2) has no layout effect: the DOM is identical by D1's own contract, and D2 is state only. So measurements taken after Phase A are still valid "before" readings.
  - The existing `form-panel-rendering` requirement "A form panel is sized for a grid cell" already mandates scroll-inside-card. The proposal correctly expects a delta there once the option is chosen.
- **Spec consistency:** I read `openspec/specs/form-panel-submit/spec.md` in full at lines 459-500, 631-652 and 712-740. Findings are below.
- **E2E proof set:** I listed `e2e/` and grepped form usage. Findings are below.

### Verdict: REFUTE

The design direction is right: D1, D2 and the D3 phasing are all sound. Two defects in the contract and the proof plan must be fixed before execution.

### Change Requests

1. **The spec delta contradicts existing requirements. It must MODIFY them, not only ADD one.**
   - `openspec/specs/form-panel-submit/spec.md`, requirement "A counter's optimistic rollback is scoped to its own submit-request failure only" (around lines 477-482), says the field error "is cleared **only** by a later request's own success, or ... by a LATER burst's reconciliation ... whose reconciliation fetch succeeds and is applied."
   - The requirement "A stale counter rejection error is cleared once a later burst reconciles" (line 712) says "A reconciliation that fails ... SHALL NOT clear the error". Its scenario "A failed reconciliation leaves the error" is not scoped to the owner.
   - The new ADDED requirement clears the error with no reconciliation at all. After archive, the spec would hold two contradicting rules.
   - Required:
     - Add a `## MODIFIED Requirements` section to `specs/form-panel-submit/spec.md` that amends the "cleared only by" sentence to name the non-owner path.
     - In the same section, scope the HEL-1819 requirement (and its failed-reconcile scenario) to the form's owner, or reword it so it stays true for both.
     - State in design D2 why the owner with a failed fetch KEEPS the stale error while a non-owner, in the same "unconfirmed" state, CLEARS it. That asymmetry is deliberate under the HEL-1819 ruling plus this ticket's delegation, but it must be explicit and justified so a reviewer does not read it as a bug.
2. **D1's e2e behaviour-preservation set is wrong. It includes a non-form spec and omits the specs that exercise the code being moved.**
   - `e2e/hel1307-conditional-formatting.spec.ts` has no form-panel cases. Grep for "form" only matches "formatting"/"conditionalFormats".
   - The list omits these existing form specs:
     - `hel1088-compact-counter-chrome`
     - `hel1095-optimistic-pending-writing-panel-a11y`
     - `hel1169-network-vs-rejection-reconcile-a11y` (this one exercises `handleImmediateStep`/`reconciliationTail`, the exact code moving into `useCompactCounterSubmit`)
     - `hel1818-compact-counter-single-error`
     - `hel1791-compact-counter-stack-height`
     - `hel1094-sse-fan-out-panel-refresh`
     - `hel1096-run-to-update-affordance`
   - The jest list also omits `frontend/src/features/panels/ui/renderers/FormRenderer.roles.test.tsx`, which renders `FormPanelView`, plus the two `*.css.test.ts` files in `ui/form/`.
   - Required: replace the list in D1 (and in tasks 1.1/1.3) with an enumerated set derived from the tree. For example, every `e2e/*.spec.ts` that creates a `form` panel, and every jest file importing from `ui/form/`. Name the files rather than using globs. Include the derivation command, so the before/after count covers the code under refactor.
3. **`tasks.md` has an empty `## Standing Constraints` heading.** Either fill it (the lane constraints the executor must restate: C12 red-first/mutation, C13 scratch location, C14 lane DB, C4 worker caps) or remove it. Do not leave a hollow placeholder.

### Non-blocking notes

- D2's mutation clause should say the same-burst test must make the indeterminate step settle after the rejection. Otherwise the guard mutation cannot turn it red (see the trace above).
- The same-burst scenario is a guard: it passes on today's code, so it cannot fail first. Label it as a guard that a mutation can break, and keep "an editor's rejection, then a no-response step" as the red-first test that satisfies the AC.
- D1's hook inputs are not a complete list. It also needs `schema`, `config.fields[0]`, `panelId`, `config.dataSourceId` and `isFormOwner`. It is fine to leave this to the executor, but the stated signature should not read as exhaustive.
- tasks.md has no Phase B placeholder. That is acceptable because D3 says the design is re-amended and re-gated, but `workflow-state.md` should record that execution stops after 3.2, so a resumed orchestrator does not treat task 4.1 as the finish line.
