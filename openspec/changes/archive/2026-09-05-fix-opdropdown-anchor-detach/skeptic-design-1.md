## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all five artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-op-picker-stability/spec.md`.
- **Live-tree citations are accurate.** `grep -rn anchorRef frontend/src/features/pipelines/ui/`
  confirms exactly two object-literal sites (`PipelineRiverView.tsx:312`, `BranchAffordance.tsx:46`)
  and that `PipelineRiverView.tsx:361,497` pass the real `addStepButtonRef` — matching the design's
  claim, and correcting the ticket's own "three sites".
- `OpDropdown.tsx:42-49` `useLayoutEffect` keyed on `[anchorRef]`, calling `setPos({...})` with a fresh
  object; `OpDropdown.tsx:63` `if (pos === null) return null;` — both as described.
- `usePipelineDetailPage.ts`: `grep -n` puts the debounced dispatch at **261-262** (design says
  262-263) and the mount dispatch at **219** (matches). One-line drift, content unambiguous.
- `playwright.config.ts` `testIgnore` contains `"**/hel912-lanes-rejoin.spec.ts"` with a ~14-line
  HEL-912/HEL-972 rationale block; the un-quarantine target is real.
- `frontend/src/features/pipelines/ui/OpDropdown.test.tsx` exists — D5/3.1 target is real, not invented.
- `playwright.config.ts:83` `retries: 0`, `:84 fullyParallel: false` — so a `--repeat-each=20 --workers=1`
  tally is honest (no silent retry masking failures). The measurement method is sound; no objection here.
- `.concertino/runs/HEL-972/evidence/premise-validation.md` exists at the repo root (not in the worktree);
  the design's relative citation resolves. Not dangling.

The plan's core investigative spine is genuinely strong and I am not objecting to it: D1's re-measured
baseline, D2's single-variable probe with a **pre-declared** interpretation table (trigger / eliminated /
partial), 1.4's stop-and-escalate if the baseline is 0/20, D3's MutationObserver mechanism requirement,
1.10's probe-revert, D5's demonstrated-RED unit test, and D6's stated 0.55^20 ~ 1e-5 argument with an
N-recompute clause. That is a plan that would in fact produce a probe-confirmed root cause and a
statistically meaningful verification. The objections below are narrower.

### Verdict: REFUTE

### Change Requests

1. **The verification does not measure the harm the proposal is built on.** `proposal.md` — Why grounds
   the ticket's Urgent status in three PRs (#555, #562, #563) going red on
   `e2e/hel968-multi-root-editor-flow.spec.ts`, yet the entire statistical bar (D6, task 3.4) is applied
   to `hel912-lanes-rejoin.spec.ts` alone, and `hel968` is covered only by task 3.6's **single**
   full-suite run. For a defect measured at ~45%, one green run of `hel968` is precisely the
   "single green is no evidence" fallacy the ticket forbids — it would pass ~55% of the time unfixed.
   Add an explicit task: run `e2e/hel968-multi-root-editor-flow.spec.ts` at the same N as 3.4 (both
   pre-fix, to establish its own baseline, and post-fix) and record both tallies. If `hel968`'s pre-fix
   baseline comes back clean on this machine, say so — that is itself a finding about whether the CI tax
   and this defect are the same thing.

2. **Spec Requirement 2 pre-commits the contract to the un-probed hypothesis, contradicting D3.**
   `specs/pipeline-op-picker-stability/spec.md`, "The picker's position is recomputed only when its
   anchor changes", states the picker "SHALL NOT ... update its position **state**, and therefore SHALL
   NOT ... **re-render**". That is implementation language (internal state, render behavior), and more
   importantly it hard-codes the anchor-identity smell as the shipped guarantee **before** D3 has
   observed the mechanism. This directly contradicts design.md's own Risks entry ("the spec's
   requirements are written against observed behavior ..., not against the smell being gone") — as
   written, they are not. If D2/D3 eliminates the anchor path, this requirement ships a spec commitment
   to fixing an unrelated smell. Either (a) restate it in observable terms (e.g. the menu stays at a
   stable screen position and remains clickable while the anchor is unchanged), or (b) mark it as
   conditional on the D3 outcome and finalize its wording after the probe. Requirement 1 and Requirement
   3 are fine as-is — both are genuinely observable.

3. **Tasks 2.2-2.5 hard-code fix shape (a)+(c), which task 2.1 says is still to be selected.** 2.1 reads
   "Select the fix shape from design.md D4's shortlist, justified by the 1.9 mechanism"; 2.2 then
   mandates "depend on the anchor ELEMENT's identity", 2.3 mandates editing both literal call sites, and
   2.5 mandates the no-render-on-unchanged-geometry behavior — i.e. options (a) and (c), decided.
   A competent implementer reading 2.2-2.5 will implement them regardless of what 1.9 found, which is
   exactly the failure D3 exists to block. Rewrite 2.2-2.5 as conditional on 2.1's recorded selection,
   or move them under an explicit "if the mechanism found in 1.9 is anchor-identity churn" heading with
   a sibling branch for the other outcomes.

### Non-blocking notes

- `tasks.md` 1.2 names `start-dev-servers.sh`; the canonical script in this repo is
  `scripts/concertino/start-servers.sh` (see `scripts/concertino/`). Fix the name so the executor does
  not go hunting.
- `design.md` cites `usePipelineDetailPage.ts:262-263`; the actual `setTimeout`/dispatch pair is at
  261-262. Cosmetic, but the ticket was itself burned by drifted line numbers.
- Task 1.1 says "remove the entry" from `testIgnore`. The entry carries a ~14-line HEL-912/HEL-972
  rationale comment immediately above it that is stale the moment the entry goes; delete both.
- Task 1.10's "`git diff` must show neither" is good, but the D2 probe edit lives in a file 2.6 also
  expects untouched — consider having 2.6 assert `usePipelineDetailPage.ts` is absent from
  `git diff --name-only main...HEAD`, which is a checkable form of the same claim.
