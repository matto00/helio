## Standing Constraints

- [C7] Prove red by mutation, one layer at a time — a mutation that stays green because another
  layer catches it proves nothing.
- [C8] Assert computed ARIA state (role/name/aria-invalid/aria-describedby association), never mere
  attribute presence.

## 1. Assembled-panel keyboard-only submit spec

- [x] 1.1 Configure a multi-field form panel (text, textarea, number, date, select, checkbox, file,
      counter) in a fixture dataset.
- [x] 1.2 Write `e2e/hel1090-form-panel-assembled-a11y.spec.ts`: keyboard-only tab through every
      field in authored order (including file and counter), complete and submit with Enter/Space
      only.
- [x] 1.3 Assert tab order matches authored field order with no skip/trap, via keyboard focus
      tracking (not inferred).

## 2. Focus management: submit / success / server rejection

- [x] 2.1 Measure focus during in-flight submit (stays on/returns to submit control).
- [x] 2.2 Measure focus on success.
- [x] 2.3 Trigger a genuine server-side rejection (not client-blocked) and measure where focus lands.
- [x] 2.4 Prove each focus assertion red by mutation (e.g. remove the focus-management call), then
      restore byte-identical (C7).

## 3. Computed ARIA / accessibility-tree assertions

- [x] 3.1 Assert the panel's own role and accessible name in the dashboard grid via computed
      accessibility tree (not attribute presence).
- [x] 3.2 Assert live-region text change on an asynchronously-arriving submit error, via computed
      state; state explicitly if real-AT announcement is unmeasurable in this harness.
- [x] 3.3 Prove computed-ARIA assertions red by mutation (e.g. strip `aria-describedby` wiring),
      confirm red, restore byte-identical (C7).

## 4. Re-measure HEL-1158's three findings on the assembled panel

- [x] 4.1 Re-measure submit-below-fold at default panel size with the full assembled field set (both
      themes).
- [x] 4.2 Re-measure same-frame clear/refill re-announcement behavior in the assembled context.
- [x] 4.3 Re-measure duplicated error text (field-level vs. form-level summary) in the assembled
      context.
- [x] 4.4 Report status of each (still holds / changed / fixed); do not file a ticket duplicating
      HEL-1158. If any is found to actually block keyboard-only completion, say so explicitly.

## 5. Fix any blocking defect found

- [x] 5.1 If a defect blocks keyboard-only completion (not polish-only), fix it with a proven-red
      mutation test guarding the fix.
- [x] 5.2 Re-run the full assembled-panel spec to confirm green after the fix.

## 6. Gates and hygiene

- [x] 6.1 Run frontend lint/typecheck/unit tests; run the new e2e spec manually against the dev
      server (not enforced by local pre-commit per HEL-1157) and capture output as evidence.
- [x] 6.2 Compare against the running app in both light and dark themes per DESIGN.md.
- [x] 6.3 Check both worktree root and main-checkout root for stray screenshots before committing.
- [x] 6.4 Clean up any shared-dev-DB fixtures by exact id with before/after counts if the shared DB
      was touched; leave no files in `~/.helio/uploads/`.
