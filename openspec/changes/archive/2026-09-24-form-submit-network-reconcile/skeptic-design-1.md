## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`, and
  `specs/form-panel-submit/spec.md` (the delta) in full.
- Read the existing base spec `openspec/specs/form-panel-submit/spec.md` in full to compare against
  the delta's MODIFIED/ADDED sections.
- Read `frontend/src/features/panels/ui/form/FormPanelView.tsx`'s `handleImmediateStep` (lines
  152–229) and the surrounding success-path reconciliation block to check D1–D4's feasibility against
  the real code, not the design's paraphrase of it.
- Read `frontend/src/features/panels/ui/form/useFormPanelValues.ts` (`setValue`, `adjustNumericValue`,
  `setExternalErrors`, `errors` computation) to check the ARIA-association claim (D3) end-to-end.
- Read `frontend/src/features/panels/ui/form/FormFieldControl.tsx` to confirm `error` prop actually
  drives `aria-invalid`/`aria-describedby` (lines 68, 97, 148–149, 161–162, 178–179, 223–224).
- Confirmed the `err.response`-presence classification idiom (D1) is real precedent by reading
  `frontend/src/services/classifyRequestError.ts`.
- Confirmed `fetchFieldAggregate` exists as claimed (`frontend/src/features/sources/services/dataSourceService.ts:413`).
- Ran `openspec validate form-submit-network-reconcile --strict` (passes — schema-level only).
- Read the OpenSpec CLI's actual MODIFIED-requirement matching logic to check whether the delta's
  MODIFIED header would actually apply against the base spec at archive time (see Change Request 1
  below) — `/home/matt/.local/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js` lines
  99 (`normalizeRequirementName` = `.trim()` only, case-sensitive) and lines 320–326 (`MODIFIED failed
  for header "..." - not found` thrown when no exact match exists; no fuzzy/near-miss fallback for
  MODIFIED, unlike REMOVED/RENAMED which do have one).

### Verdict: REFUTE

### Change Requests

1. **The MODIFIED requirement's header text does not match the base spec — `openspec archive` will
   fail with a hard error at delivery time, not silently.**
   - Base spec (`openspec/specs/form-panel-submit/spec.md:404`): `### Requirement: A counter's
     optimistic rollback is scoped to its own submit-request failure only`
   - Delta (`openspec/changes/form-submit-network-reconcile/specs/form-panel-submit/spec.md:3`):
     `### Requirement: A counter's optimistic rollback is scoped to its own definite submit rejection
     only`
   - These are different strings. I read the OpenSpec CLI's `buildUpdatedSpec` (`specs-apply.js`):
     MODIFIED matching is `normalizeRequirementName` (a plain `.trim()`, case-sensitive — no fold, no
     fuzzy match) against a `Map` keyed by exact requirement name. When no exact match is found it
     throws `${specName} MODIFIED failed for header "..." - not found` (line 326) — no near-miss
     fallback exists for MODIFIED (REMOVED and RENAMED do have one; MODIFIED deliberately doesn't,
     per line 179's comment that a rename must go through `## RENAMED Requirements` first). This is
     not a hypothetical — `/concertino-deliver`'s own workflow runs `openspec archive` as a delivery
     step (per this repo's `CLAUDE.md`: "branching → proposal → implementation → verification →
     archive → PR"), so this change as currently written would fail archival after all code/tests are
     done, not now while it's cheap to fix.
   - **Fix**: either (a) keep the MODIFIED requirement's header text byte-identical to the base spec's
     (`A counter's optimistic rollback is scoped to its own submit-request failure only`) and put the
     "definite" narrowing entirely in the requirement body/scenarios instead of the title, or (b) add
     a `## RENAMED Requirements` section (`FROM: A counter's optimistic rollback is scoped to its own
     submit-request failure only` / `TO: A counter's optimistic rollback is scoped to its own definite
     submit rejection only`) and have the MODIFIED section reference the new (TO) header, per the
     tool's own required convention.

2. **D2's reconciliation-trigger design has a real correctness gap for mixed-outcome bursts: a burst
   that ends on a definite-rejection settle never reconciles, even when an earlier sibling in the same
   burst was indeterminate.**
   - `design.md` D2 and `tasks.md` 2.1 both scope the "delete token / bump generation / if-now-empty
     fetch-and-apply" helper to exactly two call sites: the success path's tail, and "the (new)
     indeterminate-failure branch." The definite-rejection branch explicitly "keeps today's rollback
     behavior" and is not described as calling this helper.
   - But the pending-burst-quiesce condition (`pendingDeltasRef.current.size === 0`) is evaluated per
     *settle*, and which settle happens to be the one that empties the map is a race, not something
     the design controls. Concretely: click A (indeterminate — no response) settles first while click
     B is still in flight; click B then settles with a **definite** rejection (e.g. the source's
     row-count bound, a real definite-4xx case per the existing spec's "the source's row-count bound
     SHALL be rejected"). Per D2, A's settle doesn't fire the fetch (map not yet empty), and B's settle
     — being definite, not indeterminate or success — also doesn't fire it per the design's own
     branch-gating. The result: A's indeterminate outcome, which is exactly the case this ticket exists
     to reconcile, is never reconciled, because the burst happened to quiesce on a definite-rejection
     settle.
   - This directly contradicts the delta spec's own ADDED-requirement scenario "Reconciliation is
     deferred until the whole burst quiesces" (`specs/form-panel-submit/spec.md:63-67`), whose wording
     — "no aggregate fetch occurs until the sibling also settles" — implies the fetch *does* occur once
     the sibling settles, not that it depends on which outcome the sibling settles with.
   - **Fix**: the reconciliation trigger needs to be keyed on "the pending map just became empty
     *and at least one settle in this quiesce cycle was success-or-indeterminate*" (i.e. any settle,
     including a definite-rejection one, must still check "is the map now empty, and did this burst
     contain a not-purely-rejected outcome" and fire the helper) — not "only success and indeterminate
     branches call the helper directly." Please make this explicit in design.md D2 and tasks.md 2.1
     before implementation, since this is exactly the kind of race an implementer following the design
     literally (two call sites, not three) would reproduce.

3. **D3 introduces `values.setExternalErrors` into the compact-counter path for the first time, but
   neither design.md nor tasks.md specifies how/when that error clears on a later successful click —
   and the mechanism it implicitly relies on is fragile.**
   - Read `useFormPanelValues.ts`: `setValue` clears `externalErrors[sourceField]` (lines 118–126), but
     `adjustNumericValue` — the function `handleImmediateStep` calls on *every* activation to apply the
     optimistic delta (line 164 of `FormPanelView.tsx`) — does **not** clear it. The only place in the
     compact-counter path that calls `setValue` today is inside the quiesce-gated reconciliation
     success branch (`FormPanelView.tsx:201`), which only runs when: this settle empties the pending
     map, the generation check still matches, and the aggregate fetch itself succeeds.
   - Consequence: once a definite rejection sets `externalErrors[field.sourceField]` (new behavior per
     D3), if a *later* click succeeds but its own reconciliation fetch fails (already a documented,
     accepted, silent-swallow case in the existing code's `catch { /* left as-is */ }` at line 203) —
     or the settle simply isn't the one that empties the map — the stale `aria-invalid="true"` /
     `aria-describedby` association persists indefinitely on a control whose displayed value is now
     correct. `handleSubmit`'s equivalent path explicitly clears with `values.setExternalErrors({})` on
     success (line 267); `handleImmediateStep` has no analogous explicit clear anywhere in the design.
   - **Fix**: design.md D3 (or a new decision) should state explicitly when the counter's external
     error clears — e.g. an unconditional `values.setExternalErrors({})` on every successful settle
     (mirroring `handleSubmit`'s pattern), independent of whether the reconciliation fetch itself
     succeeds — so a stale rejection error can't survive a later successful click indefinitely.

### Non-blocking notes

- D1's classification (`err.response !== undefined`) is well-grounded in existing codebase precedent
  (`classifyRequestError.ts`, `panelService.ts`'s `parseFieldErrors`, `httpClient.ts`'s 401
  interceptor) and I agree with rejecting the "treat 5xx as indeterminate" alternative for the stated
  reason (no reliable client-side signal). No change requested here.
- D4's "couldn't confirm" wording reusing the existing assertive region (no new live region) is
  reasonable and consistent with the rest of the capability's announcement pattern.
- The AC's "(4xx/5xx with a body)" phrasing vs. D1's "any response regardless of body content" was
  already surfaced and resolved during Setup premise-validation (ticket.md's "Notes from premise
  validation," item 2) — I checked this and consider it settled, not a design gap.
