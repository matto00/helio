## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

1. **Spawn-cwd guard** — `pwd -P` → `/home/matt/Development/helio`; `scripts/concertino/assert-cwd.sh`
   returned `READY ambient=/home/matt/Development/helio branch=bug/form-submit-rollback-network-vs-rejection/HEL-1169`.
   Proceeded.

2. **No code has landed yet** — `git status --short` shows only the untracked
   `openspec/changes/form-submit-network-reconcile/` dir; `git diff main...HEAD --stat` is empty. Correct
   for a design-gate review.

3. **The primary judgment question: is documenting D4a as an accepted Risk (rather than adding
   cross-branch tracking) a legitimate trade-off, or under-service of AC #2?** Read `ticket.md` AC #2
   verbatim and design.md's new D4a decision, Risks entry, and tasks.md's new "3a" section in full.
   Findings:
   - AC #2's literal text ("An indeterminate outcome... does NOT silently roll back... reconciles...
     with an announced 'couldn't confirm' state if the refetch also fails") is written in terms of a
     single indeterminate settle and its own refetch. AC #3's test requirement ("a lost-ack-after-commit"
     — one click, no sibling) is exactly the case this design fully fixes, not the case D4a defers. D4a's
     gap is strictly a multi-click-burst compound scenario the AC text does not literally reach.
   - Critically, **the core anti-rollback guarantee survives D4a's gap completely**: I traced the
     accepted-limitation text — "the write itself is never lost or misrepresented as failed (it stays in
     its optimistic state...)" — against D2's unconditional-tail design. Confirmed: in the compound case,
     the write is never rolled back; only the ancillary "couldn't confirm" *announcement* is missing for
     the earlier indeterminate sibling specifically. The ticket's actual production defect (a persisted
     write silently rolled back and misrepresented) cannot occur via this gap.
   - I independently sketched the alternative fix round 3 offered as option (b) — a burst-level
     "had-indeterminate-settle" ref, set by the indeterminate branch and read by whichever branch's tail
     invocation ultimately fires. Within a minute this hit its own new edge case: the flag must be reset
     exactly at burst-start (`pendingDeltasRef` transitioning from empty to non-empty), which is a
     separate synchronization concern from "which settle empties the map" — precisely the class of
     cross-branch timing interaction that caused the round-1→2 and round-2→3 collisions (`setValue`
     silently clearing `externalErrors`; unscoped `onReconcileFailed`). This corroborates, from an
     independent angle, the design's own stated rationale for declining a fourth piece of shared mutable
     state rather than accepting it as a convenient excuse.
   - Round 3 itself explicitly offered "(a) document as an accepted Risk" as *sufficient* (not merely
     "acceptable in a pinch") — the orchestrator's choice is not a downgrade from what round 3 required.
   - **Conclusion: legitimate.** D4a is an honest, narrowly-scoped, self-healing (the next successful
     settle's own tail invocation re-fetches and corrects the total), textually-outside-the-AC limitation,
     documented in three consistent places (design.md decision, design.md Risks, tasks.md 3a's explicit
     "do not implement" guard) — not a cheap dodge of real scope.

4. **Rounds 1–3's fixes independently re-verified against current source, not re-trusted from prior
   reports:**
   - **D0 (byte-identical MODIFIED headers):** `grep -n "^### Requirement" openspec/specs/form-panel-submit/spec.md`
     shows both touched requirements at lines 330 and 404; diffed against the delta's headers at lines 3
     and 61 — byte-identical. Went one step further than round 3's own re-verification: read
     `specs-apply.js`'s actual `findMissingCurrentScenarios` check (a THIRD archive gate beyond header
     match and body-header consistency, at `specs-apply.js:333-336`, which throws if the base spec's
     requirement contains a scenario name the delta's MODIFIED block drops) and manually diffed every
     scenario name in both base requirements against the delta — all 5 base scenarios (2 in the
     reconciliation requirement, 3 in the rollback requirement) are present by name in the delta's
     superset. `npx openspec validate form-submit-network-reconcile --type change --strict` also passes
     cleanly (`Change 'form-submit-network-reconcile' is valid`).
   - **D2 (unconditional 3-branch reconcile-tail) / D3 (setExternalErrors on rejection) / D3a
     (`reconcileValue` distinct from `setValue`):** Read the actual, unmodified
     `frontend/src/features/panels/ui/form/useFormPanelValues.ts` — confirmed `setValue` (lines 118-126)
     still unconditionally deletes `externalErrors[sourceField]`, and it has exactly two callers
     (`FormPanelView.tsx:201`, the reconciliation apply site being replaced by `reconcileValue`, and
     `:373`, the unrelated standard-field `onChange`, correctly left alone). Confirmed
     `FormFieldControl.tsx` already computes `aria-invalid`/`aria-describedby` from an `error` prop
     sourced from `values.errors[...]` (lines 100-116 of the hook), and the compact-counter JSX already
     passes `error={values.errors[field.sourceField]}` (`FormPanelView.tsx:328`) — so D3's plan
     (`setExternalErrors` alone) is sufficient to wire the ARIA association with no other code path
     needing changes. All matches design.md's specific line citations exactly.
   - **D4 (`onReconcileFailed` ownership by caller, not helper):** `FormPanelView.tsx:203-209`'s current
     catch-swallow comment on the success path matches design.md's citation verbatim.
   - No new contradiction introduced by this round's additions to design.md/tasks.md; 3a is consistent
     with D4a; the Risks-section D4a entry is consistent with the design-section D4a decision text.

### Verdict: CONFIRM

### Non-blocking notes

- `proposal.md`'s Impact section (lines 39-45) does not list `useFormPanelValues.ts` as a file to be
  modified, even though design.md D3a / tasks.md 2.0 require adding `reconcileValue` there. tasks.md
  itself is unambiguous about this, so it is not implementation-blocking, but worth a one-line addition
  for traceability.
- `proposal.md`'s "Modified Capabilities" bullet (line 34) describes the indeterminate-outcome behavior
  as "a new requirement" — it is actually the existing MODIFIED "counter's displayed value reconciles..."
  requirement, not an ADDED one. Cosmetic only; the spec delta itself correctly uses `## MODIFIED
  Requirements` with no `## ADDED Requirements` section.
