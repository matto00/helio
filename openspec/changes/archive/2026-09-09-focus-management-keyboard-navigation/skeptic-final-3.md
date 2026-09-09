## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Gated `79431f21` on base `7b872db9`. Narrow round as scoped: re-check round 2's CR1/CR2, confirm the
commit is documentation-only, spot-check for regression. `git status --porcelain` empty at start and
at the end.

### What I verified (with evidence)

**The commit is documentation-only, and there is zero code delta since round 2's gated HEAD.**
`git show --name-only --format="" 79431f21 | grep -v '\.md$'` → empty. Stronger, and the check that
actually matters: `git diff --stat 3f636ae6 79431f21 -- frontend/ backend/ e2e/ schemas/ scripts/` →
empty. Every code-level finding round 2 established by its own runs (the mutation-proven AC4 restore
case, the RED regression harness on both branches, the 196/8-views/0-residuals sweep, the
`PipelineDetailHeader.css` `outline-offset: -2px` fix) stands on byte-identical sources. I did not
re-run those, and say so plainly rather than implying I did — they are unchanged by construction, not
by trust.

**Gates at this HEAD, run by me.** `format:check` (prettier, all matched files — this is the one that
could genuinely have broken, since prettier formats the `.md` files this commit rewrote) → "All
matched files use Prettier code style!". `typecheck` (`tsc --noEmit`) → clean. `lint`
(`eslint . --max-warnings=0`) → clean. `openspec validate focus-management-keyboard-navigation
--strict` → "is valid".

**CR1 — SATISFIED in all four named places.** `grep -rn "HEL-1062\|HEL-1063"` across the change dir,
`e2e/` and `frontend/`:
- `proposal.md:53` — "Scope amendment" now reads "**HEL-1062** (dialog focus lifecycle, AC1) and
  **HEL-1063** (keyboard-only flow operability, AC3, which also owns this sweep's unmeasured
  surfaces)". Both IDs present, each mapped to its AC. Correct.
- `tasks.md:130` (§4) and `tasks.md:146` (§5) — head notes present, each naming the owning ticket and
  stating the unchecked boxes are a handover, not unfinished work in this change. Correct.
- `specs/accessible-focus-indicator/spec.md:33` — the archived-into-permanent-spec comment now names
  an ID. **The ID is present, but it is the wrong one — see the Change Request.**

**I confirmed the requirement round 2 said this comment feeds is real, rather than inheriting the
claim.** It is not in this change's delta (which has exactly three requirements: rendered
measurement, clipping-counts-as-absence, outline/border/shadow adjudication). It is in the **already
permanent** base spec: `openspec/specs/accessible-focus-indicator/spec.md:85-92`, "Requirement:
Unfixed sites are named rather than omitted — ... SHALL be identified explicitly together with the
reason, and SHALL carry a filed item that owns the remainder. Silent omission SHALL NOT be treated as
completion." Round 2's framing was substantively right, and this change is bound by that requirement
today.

**HEL-1062 and HEL-1063 both genuinely exist in Linear**, both Backlog, both parented to HEL-353,
both in the v0.7 project. Not placeholders — each carries a real, specific, well-scoped body.

**HEL-1062's correction is present and it is accurate.** Its Context section reads: "**Correction —
do not inherit the earlier premise.** An initial version of this ticket said that coverage meant
'that half of AC4 is done'. That was **false when written**", then describes the vacuity exactly
(deleting `Modal.tsx`'s `previouslyFocusedRef.current?.focus();` left all 23 tests green because the
`beforeEach` `showModal` stub only set an `open` attribute and never moved focus, so the post-close
assertion was true by precondition), states HEL-520 addressed it before shipping, and instructs the
reader to "verify its final state rather than assuming either the original claim or this correction."
That description of the pre-fix state matches what round 2 independently reproduced, and the
self-undercutting last clause is the right posture. No false premise survives in either ticket body.

**CR2 — SATISFIED. I judge the append-plus-inline-pointer combination sufficient, and it is not the
append-instead-of-replace defect in a new form.** You asked to be told plainly if it were, so: it
isn't, for three specific reasons. (1) The inline block is not a cross-reference to somewhere else —
it states the correction itself ("AC2's claim is narrowed to the measured population...; AC4's restore
cases were later proven vacuous and fixed in `3f636ae6`"), so a reader who follows it no further
already has the right answer. (2) It sits immediately **above** the "Net: ... delivers **AC2 in
full**" line, so that sentence cannot be read without passing the correction first — the specific
sequencing failure MISTAKES.md warns about is closed. (3) It is adjacent to the table's last row and
names both affected rows in bold caps in its first clause. The residual exposure is a reader who
scans only the AC2 row mid-table and stops — but that exposure is irreducible short of editing the
table in place, which CR2 explicitly asked you **not** to do in order to preserve what a past
reviewer actually concluded and when. You resolved that tension the right way. `files-modified.md`'s
"AC accounting as delivered" is the accurate source and now agrees with it; no artifact in the tree
still asserts AC2 unqualified without an adjacent supersession.

### Verdict: REFUTE

One issue, and I want to be clear about its size and about my own confidence in calling it: **it is
not a code defect, it does not reopen anything round 2 settled, and it needs no tree change or gate
re-run to fix.** Everything else in this round is CONFIRMED. Round 2's subjective judgement — that
this is a coherent, honestly-described increment that should ship as HEL-520 — I independently share,
on the evidence above.

But CR1(b) was the one round 2 singled out as mattering most, precisely because that comment is the
text `openspec archive` copies into the permanent spec. The ID landed there is **HEL-1063**, and
HEL-1063 does not own that work. Its Linear body scopes Part 1 (keyboard-only flows) and Part 2
(extending the sweep to `AccentPicker`, panel-title, rename and schedule inputs, plus the
absolute-contrast-vs-delta grading gap). It contains no mention of occlusion, paint order, stacking
contexts, z-index or screenshot diffing — I checked the full description. So the permanent spec is
about to assert that a sound occlusion detector "is owned by **HEL-1063**" when in fact that work is
owned by nobody.

I considered passing this as a non-blocking note and decided against it, on this reasoning: the
`accessible-focus-indicator` requirement above is satisfied for the unfixed **sites** regardless (they
are named in `files-modified.md` and genuinely owned by HEL-1063 Part 2), so the requirement is not
breached — the comment is non-normative and even says "not a requirement of this change". On its own
that is a nit. What makes it blocking is what it *is*: a false ownership claim being canonised into a
permanent spec, on the one ticket whose entire three-round review history is completion claims
outrunning their evidence. Round 1 and round 2 each removed a version of exactly this. Shipping a
fourth one, into the most durable artifact in the set, is the same defect once more — and unlike the
earlier ones it costs essentially nothing to close.

### Change Requests

1. **Make the occlusion follow-up's named owner real.** `specs/accessible-focus-indicator/spec.md:33`
   states a sound occlusion detector (paint-order resolution via stacking-context comparison or
   pixel-level screenshot diffing) "is owned by **HEL-1063**". HEL-1063's Linear description does not
   scope that work. Either is acceptable and both are minutes:
   - **(a) Preferred, and needs no commit at all:** extend HEL-1063's Linear description with a short
     third part owning the occlusion detector, citing
     `e2e/support/focusPresenceProbe.ts:130-149`'s module comment (which records the confirmed false
     positive against `.app-skip-link` and why `elementsFromPoint` cannot work for a paint-only
     effect) as the starting evidence. The tree is then already correct as committed.
   - **(b)** Or amend the comment in `spec.md` to name whichever item genuinely owns it — filing a new
     one if none does — and, if you choose this, mirror it in `files-modified.md`'s ownership block,
     which currently does not mention the occlusion detector under either ticket.

   Round 4 need only re-check this one pointer. Nothing else in this round requires re-verification:
   the code is byte-identical to the HEAD round 2 fully verified, and I have re-confirmed the gates
   and both other CRs at `79431f21`.

### Non-blocking notes

- `evaluation-4.md`'s appended section is headed "Superseding note (orchestrator, 2026-09-09, added
  after **skeptic-final-1.md**)". Its *content* is indeed drawn from skeptic-final-1's findings, so
  this is defensible, but the note was written in response to skeptic-final-2's CR2 and a later reader
  reconstructing the sequence may find the attribution confusing. Purely cosmetic.
- Carried forward from rounds 1 and 2 and still non-blocking: `readBackdrop` in
  `focusPresenceProbe.ts` duplicates ~30 lines of `state-surface-contrast-guard.spec.ts`; and the
  detached-trigger restore case is a labelled wrong-add guard rather than proof, which its own comment
  already says.
