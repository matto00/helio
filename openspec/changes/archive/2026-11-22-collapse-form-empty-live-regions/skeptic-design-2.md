## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-empty-live-region-gaps/HEL-1819`. Reviewed at HEAD `032321ada8880dbfce4a1197c28e34d55b964388`. The change dir is untracked (planning only).
- **Artifacts read in full:** ticket.md (including the owner scope addition), proposal.md, design.md, tasks.md, both spec deltas, and skeptic-design-1.md. I found no TODO, TBD or deferred decisions.
- **`openspec validate collapse-form-empty-live-regions --strict`:** `Change 'collapse-form-empty-live-regions' is valid`.
- **Round-1 CR1 is resolved.**
  - I diffed the MODIFIED delta against the living requirement (`openspec/specs/form-panel-submit/spec.md:459-540`), saving both sides to scratch. There are exactly two differences:
    1. The clearing sentence at `:480` is amended to name both clearing paths, and it keeps "A reconciliation within the same burst as the rejection SHALL NOT clear it".
    2. One scenario is appended: "A later burst's successful reconcile ...".
  - Everything else is byte-identical. That includes the HEL-1818 compact paragraph and the kept scenario "A rejected submit's own trailing reconciliation does not clear its error".
  - The requirement header matches the living header exactly.
- **The `:339-341` reconciliation clause still holds after archive.**
  - Its SHALL NOT is scoped to errors set by settles "in the burst". The new clear applies only across bursts.
  - design.md D2 now says so explicitly, and explains why the "separate mechanisms" wording needs no cross-reference: the new clear is a deliberate `setExternalErrors` call, not an incidental side effect of `reconcileValue`.
  - I found no other living SHALL about clearing a counter error (`grep "SHALL NOT clear\|later request's own success" openspec/specs` hits only `:339` and `:479-480`).
- **D2 against live code (`FormPanelView.tsx:177-292`):**
  - `reconciliationTail` applies the aggregate only under `myGen === reconcileGenerationRef.current && pendingDeltasRef.current.size === 0`. That is the natural hook point for `onReconciled`.
  - The non-owner branch and the `catch` branch never reach that hook, so the claims "failed/stale never clears" and "non-owner unaffected" hold.
  - The reset point (test emptiness before `pendingDeltasRef.current.set(token, delta)`) is now unambiguous.
  - I walked the orderings:
    - Rejection, then indeterminate, in one burst: the flag is set, so no clear.
    - Indeterminate, then rejection: the rejection branch passes no `onReconciled`.
    - A new burst while the previous fetch is in flight: the flag resets and the old fetch is discarded.
    - A later burst that quiesces on an indeterminate settle: the error is cleared, as the owner ruled.
  - `handleImmediateStep` is reached only in the compact layout (`isCompactCounter`, `:146` and `:374`; multi-field controls use `immediate={false}`), so `setExternalErrors({})` cannot wipe sibling fields' errors.
- **D1 against live CSS:**
  - `FormPanel.css:5-10` is a flex column with a `--space-3` gap and no `position`.
  - The regions are direct children of `<form class="form-panel-view__fields">` (`FormPanelView.tsx:441-446`), so the child combinator matches them and does not reach the compact layout's regions, which sit under `.form-panel-view__compact-counter` (`CounterControl.css:51`).
  - The design copies the HEL-1804 precedent and keeps `display` and `visibility` unchanged.
- **Round-1 non-blocking notes:** all are now addressed in design.md:
  - The colour is keyed on `[aria-invalid="true"]`, per `CounterControl.css:27`.
  - Scenario (c) is flagged as preserved existing behaviour.
  - The non-owner case is noted as a possible follow-up.
  - The reset point is stated.
  - The 0x0 static-position note is in the CSS comment.
- **AC coverage:**
  - AC1 is covered by tasks 1.3, 1.4 and 3.4, with the D3.3 geometry check. Its metric is red-achievable: three gaps today against one after the fix.
  - AC2 is covered by 3.2.
  - AC3 is covered by 3.3.
  - AC4 is covered by 1.2 and 3.1; test (a) is red-achievable on current code, because the indeterminate branch never calls `setExternalErrors`.
- **Scope:** there is no work beyond the ticket and the owner addition. The plan is frontend-only with no contract or schema change, so no API delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

- `FormPanel.css:19-21`'s comment ("an empty `<p>` renders as zero height already, so no extra ... class is needed") becomes misleading: zero height still claims a gap slot, which is this bug. Task 2.2 should rewrite it rather than only add a new comment beside it.
- The HEL-1804 living scenario (`form-panel-rendering/spec.md`, "Other panel kinds keep their height": "every panel other than the compact counter card has the same height") and this change's matching scenario are both change-relative ("before and after the change"). Read literally after archive, they name different exempt cards. This is not a contradictory obligation on system state, but it is an existing pattern worth not extending further. One option is to phrase the new scenario as "this change alters no other kind's height".
- Living requirement `form-panel-rendering:323` ("live-region text change is measured, not inferred") applies to AC2. 3.2's evidence should record the region text before and after, and state whether real-AT announcement is unmeasurable in the harness.
- The non-owner stale-error case (`FormPanelView.tsx:220-223`) remains a follow-up candidate. Report it; do not file it.
