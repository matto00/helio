## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed at HEAD `9c41719c376b858ab9269fa6075f8b3b74acabd1`. The change dir is untracked and there are no commits beyond main. This was a read-only review: no sbt, Jest or Playwright, and no dev-DB or production access.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/rootid-step-create-placement/HEL-1345`.
- **Artifacts read in full:** ticket.md, proposal.md, design.md (341 lines), tasks.md, the editor spec delta, and the placement-relevant lines of the persistence and MCP spec deltas. I also read skeptic-design-5.md, but only as claims to check.
- **Live code I re-checked:**
  - `PipelineStepRepository.scala:468-473`: a tail attach writes `position = max(sibling position) + 1`, or 0 when the anchor has no children. A tail lane therefore sits under a trunk-last step (one with no position-0 child) only after that step's continuation was deleted, or in legacy data.
  - `handleReorderSteps` sends only trunk-lane persisted ids. A stale local parent on a tail step is therefore display-only and never written back to the server.

**Round-5 CR1: closed.**

The D5 text (design.md:162-166 and :176) contains the three parts of the fix:
- the chain-reaches-`created.id` skip for a present R;
- the same rule on the `pendingParent` write;
- deleting `created.id`'s `pendingParent` entry in every case.

Task 3.2(h) exists (tasks.md:29). The round-5 non-blocking notes became Risks lines (design.md:322-325), and D11's wording about the anchor deleted in another tab was corrected (:298-299).

**Trace of the round-5 case.** Trunk A→B, B has tail L. Appends P1 then P2 commit in that order: P1 reports `[L]`, P2 reports `[L]`, and the server ends with L under P2. P2's response arrives first.
1. P2's response: the P2 temp is swapped in with parent P1, which is not resolved locally yet. L's chain is L→B→A, which does not reach P2, so L's parent becomes P2.
2. P1's response: case 2 swaps the P1 temp in first, with parent B (design.md:157-162: "Replace it in place … Then, for each id R"). L's chain is now L→P2→P1, which reaches P1, so L is skipped.
3. Result: L is under P2, matching the server. The commit-order arrival also comes out right.

**Variant: gap insert X at B|P1-temp commits before the append P1.** X reports `[L]`; P1 is anchored on X and reports `[L]`. P1's response arrives first.
1. P1's response sets L's parent to P1.
2. X's response: X is swapped in. L's chain is L→P1→X, which reaches X, so L is skipped.
3. Result: B→X→P1 with L under P1. Correct.

**The skip rule is sound when it fires.** Splices and tail attaches only insert new steps; they never change ancestry among existing steps. Every local parent link is therefore a server link that was true at some point. Suppose R's local link R→Q lies on a chain that reaches `created`. If that link predated `created`'s commit, then Q would have to be an ancestor of `created`, and `created` would also have to be an ancestor of Q, which is impossible. So a link that fires the skip is always newer than `created`.

**Earlier orderings, re-traced under the new rule:**
- **Same slot, X then Y committed (server A→Y→X→B):**
  - Y's response first: X is absent, there is no existing entry, so `pendingParent[X]=Y`. X's response then takes parent Y. B's chain B→A does not reach X, so B's parent becomes X. Correct.
  - Commit-order arrival: correct.
- **Same slot, Y then X committed (server A→X→Y→B):** correct in both arrival orders.
- **Different gaps** (X `parentStepId A` reports `[B]`, Y `parentStepId B` reports `[C]`): neither chain test reaches the other create. The result is A, X, B, Y, C in both orders. Correct.
- **Draft and immediate mixes:** both go through the same `applyCreatedStep`, so the traces above apply unchanged.
- **Wholesale-sync drop, case 1:** a GET fetched after the commit means `created.id` is present. The temp is removed, nothing else is applied, and the pending entry is deleted. Correct.
- **Wholesale-sync drop, case 3:** a GET fetched before the commit means `created.id` is absent. The step is appended and its reparents are applied; R's chain comes from the GET and cannot contain `created.id`, so R's parent becomes `created`. Correct.
- **Wholesale-sync drop, sync fetched between C1 and C2:** C1 takes case 1. C2 takes case 2 or 3, and R's chain from the GET (R→C1) does not reach C2, so R's parent becomes C2. Correct.

**Cross-artifact consistency.** I found no contradiction among the proposal, D1/D5/D10/D11, the three spec deltas and tasks 3.1-3.4. Two passages read like they overlap, but they are consistent:
- design.md:174-175 ("deleting them when case 2 consumes them") is a subset of :176 ("deleted in every case").
- The editor spec's "Overlapping creates" scenario names two inserts at the same gap, and the traces above meet it.

### Verdict: CONFIRM

The round-5 change request is fixed in substance, and none of the orderings settled in earlier rounds regressed. The one residual (note 1) is display-only and heals at the next full sync. It needs three concurrent appends onto a trunk-last step that has a tail lane, which this repo can only produce after a continuation deletion or from legacy data. It is the same class of window the design already accepts in Risks for shape-instantiate (design.md:326-327), so it is not a blocker at a final, owner-extended round. It does need recording; see note 1.

### Non-blocking notes

1. **The new rule is incomplete when a chain cannot be resolved. Fold this in during execution.**

   **Trace.** Three appends P1, P2, P3 commit in that order onto trunk-last B, which has tail L. Each reports `[L]`, and the server ends with L under P3. The responses arrive in the order P3, P1, P2.
   1. P3's response: L's parent becomes P3. P3's own parent is P2, which is not resolved locally.
   2. P1's response: L's chain is L→P3→P2, and it stops at P2 because P2 is not present locally. It does not reach P1, so L's parent is overwritten to P1. This is the stale value.
   3. P2's response: L's chain is L→P1→B, which does not reach P2, so L's parent becomes P2.
   4. Final state: L is under P2, while the server has it under P3.

   The same thing happens on the `pendingParent` path when L is itself still a temp. The other five arrival orders are correct.

   **No fixed default is sound.** Treating an unresolved chain as "reaches" is wrong for appends U, K, C arriving in the order K, C, U: L ends under K when it should be under C.

   **Executor, pick one:**
   - (a) **A three-way rule:** apply the reparent when the chain resolves fully without reaching `created.id`, skip it when the chain reaches `created.id`, and otherwise record a deferred claim `(R, created.id)`. Re-evaluate deferred claims on each later response and drop them on a full sync. Both traces above come out right under this rule. Add a 3.1 unit case for the P3, P1, P2 order.
   - (b) **Narrow the claim:** add a Risks line for this residual, and narrow D5's "order-robust" wording to "two creates per reparented id".

   Either way, the D5 "Why this is order-robust" paragraph must not claim more than the chosen option delivers.

2. **Round-5 CR1(b) asked for a 3.1 unit case as well as the 3.2(h) RTL case for the chain-skip rule.** Task 3.1's case list (tasks.md:28) does not mention the skip. Add it alongside the unit cases for case 2.

3. **The `pendingParent` guard wording is slightly loose** (design.md:165-166: "no entry exists yet whose value's chain reaches"). It means "the existing entry for R, if any, has a value whose local chain reaches `created.id`". Use that reading.

### Gate-defect check (CON-160)

No evidence in this review relied on mtime ordering, so this check does not apply.
