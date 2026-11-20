## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD a867001d7b1c4c1484fc587ef34291552403885f (change dir untracked; artifacts read from disk). I checked the
claims against `FormPanelView.tsx`, `useFormPanelValues.ts`, `FormFieldControl.tsx`, `CounterControl.tsx`/`.css` and the e2e
and jest fixtures in the worktree.

### What I verified (with evidence)

- **Round-1 CR1 (wording): addressed.** D3, the proposal and the spec now use "Your net change this session". In
  `handleImmediateStep`, `delta = step * direction` is applied through `values.adjustNumericValue`, and a definite
  rejection rolls back with `-delta`. The displayed number is therefore the net of the user's confirmed-or-pending steps.
  "Net change" stays true for `step: 5` and after a `-`. The jest/e2e literal sharing is restated clearly: an exported
  `COUNTER_TALLY_CAPTION` for jest, with the literal repeated in e2e.
- **Round-1 CR2 (initialValue seed): addressed with option (a).** The proposal ("What Changes"), design D3a, the spec
  requirement ("SHALL start at 0 regardless of the field's `initialValue`") and a new scenario (`initialValue: 10`,
  `step: 5`, shows 0 then 5) all state it. The D6 test list has the non-owner `initialValue` case, the owner-still-10
  case, the late-ownership re-seed case and a mutation probe (drop the strip).
- **D3a mechanism is sound against the code.**
  - If `initialValue` is stripped, `seedValueFor` returns `emptyValueFor("counter")`, which is `""`. `FormFieldControl`'s
    counter case maps `""` to `numericValue` 0 (`stringValue === "" ? 0 : ...`). So "shows 0" holds.
  - A compact submit sends only `{ [sourceField]: delta }`, so `initialValue` is display-only on that path, as the design
    claims. Nothing the server stores changes.
  - The stripped field is used by the hook only for seeding, `reset` and error computation. The compact branch never
    calls `reset`. `computeFormIssues`, `handleImmediateStep` and `FormFieldControl` keep reading the unstripped
    `config.fields`. No side effects.
  - Re-seed: the hook's `fieldsKey` today joins `sourceField`s only, so a stripped and an unstripped array have the same
    key and would not re-seed. The design names this ("the hook's re-seed key must include whatever changes the seed").
    D6's late-resolution test would catch it if the implementation missed it.
- **Owner-ruling overstep check: not an overstep.** The ruling keeps "the editor's local counter tally (no dataset
  read)" and wants it clear that it "counts only this person's clicks in this session". Seeding at `initialValue` was
  the thing that made that description false. Zero-seeding adds no read, no persistence and no new data. It changes
  nothing for the owner and nothing in what is stored. It only makes the shown number match the ruling's own definition.
  The proposal names it as a behaviour change and the Planner Notes record it as self-approved, so it is not hidden.
- **No fixture regression risk.** No `e2e/hel1784*`, `hel1088*`, `hel1090*` or `hel1095*` spec and no `FormPanelView*`
  jest test sets `initialValue`. The zero seed changes no existing assertion.
- **Prior-round items still hold.** These were re-checked in the current code and are unchanged:
  - `isFormOwner` fails closed when `ownerId` is absent.
  - Compact-only scope: the stacked branch renders `immediate={false}`.
  - `describedBy` is computed in `FormFieldControl` (error, else hint), so an appended caption id is the right seam.
  - `CounterControl.css` already uses tokens only, so the D5 rule fits there.
- **No contract delta needed:** frontend only, no API, schema or backend change.

### Verdict: CONFIRM

### Non-blocking notes

- **D3a re-seed key: prefer the narrowest key.** If the implementer adds `initialValue` to `fieldsKey` for all fields,
  an owner (or a stacked form) will also re-seed when a sheet edits `initialValue` while the panel is mounted. That is
  benign, but it slightly contradicts "owner seeding is unchanged". Keying on the strip flag (for example `isFormOwner`,
  or a "seed-stripped" marker) avoids it. Either way, the evaluator should confirm the owner's mid-session tally is not
  reset by an unrelated re-render.
- **The late-ownership case may be unreachable in practice.** The app shell likely gates on auth, so `currentUser` is
  set before a panel renders. The test is still cheap and guards the key. Keep it, but do not contort the
  implementation for it.
- Tasks 1.2 (e2e) does not cover the `initialValue` case. That is fine: jest covers it, and the e2e fixture has no
  `initialValue`.
- Carried over from round 1: measure caption contrast at default panel opacity in both themes beside its siblings, and
  file the owner's "seeded, not fetched on mount" gap as a follow-up candidate (already recorded in Planner Notes).
