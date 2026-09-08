## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold spawn. Scope deliberately narrow per the round-4 brief: verify round 3's three
change requests landed, and independently sweep for any surviving assertion of the
disproven zero-width mechanism. I did not re-litigate the explanation-4 ruling, the D2
shim shape/blast radius, D5-D9, or the 3.x mutation proofs — three independent cold
reviewers have converged on those and I found no new evidence bearing on them.

### What I verified (with evidence)

**Tree state — matches the brief exactly.** `git status --porcelain` shows exactly one
modified tracked file, `frontend/package-lock.json` (plus the untracked change dir).
`git diff` is exactly the 3 expected lines — `version`, `resolved`, `integrity` —
moving `node_modules/react-grid-layout` from 2.2.3 to 2.2.4. `frontend/package.json:31`
is clean at `"react-grid-layout": "^2.2.2"`. No stray files, no product code touched.

**CR1 — ticket.md:67, fixed.** Now reads `Measured width 100 -> phone branch ->
MobilePanelStack -> no panel-actions button`. It no longer contradicts the CORRECTED
MECHANISM block eight lines above it, and the branch condition
(`width < panelGridConfig.breakpoints.sm` (768)) is unchanged, as round 3 asked.

**CR2 — design.md:52, fixed.** D1's rationale now reads "a silently-wrong width (100,
from an inline percentage jsdom never resolves) is not an inert harness detail - it
changes which component tree renders." The load-bearing argument survives intact with
the number corrected, and the parenthetical actually improves on round 3's suggestion by
naming the *cause* of the wrong value, not just the value.

**CR3 — task 4.2a, added and well-specified.** It mandates restoring 2.2.4 *after* the
4.2 baseline capture, re-verifying both halves (`git diff frontend/package.json` empty,
lock diff exactly 3 lines at 2.2.4), and explicitly warns that `npm ci` will not flag the
drift because 2.2.3 and 2.2.4 both satisfy `^2.2.2`. That closes the gap round 3 named:
the only prior shape check (task 1.1) ran in section 1, long before the mutating step.
Its placement immediately after 4.2 — rather than deferred to 5.1 — is the stronger of
the two options round 3 offered, since it prevents 4.3/4.4 from running against an
unverified tree.

**Independent sweep for stale phrasing — clean.** I ran a case-insensitive sweep across
all five artifacts (`ticket.md`, `design.md`, `proposal.md`, `tasks.md`,
`workflow-state.md`) for `width 0`, `zero width`, `width of 0`, `resolves to 0`,
`silently-zero`, `0px`, and `width is 0`. Three hits returned, all verified benign:
`design.md:64` and `tasks.md:9` are the `"1280px"` shim value (the fix, not the defect),
and `design.md:78` is the rejected blanket-`1280px` alternative. Zero hits asserting the
disproven mechanism.

The one place a "0" still appears in a mechanism sentence is `ticket.md:54`, and that is
correct and should stay: it is the narrative *recording the disproven probe* ("concluding
the measured width was 0 via ..."), immediately corrected two lines later at `ticket.md:59`
("The measured width is 100, not 0, and no `clientWidth` fallback ..."). Deleting that
would erase the record of the misdiagnosis, which is exactly the history a reader of this
change needs. I checked this was a description of a refuted claim and not a surviving
assertion of it, since a keyword sweep alone cannot tell those apart.

### Verdict: CONFIRM

All three round-3 blockers are genuinely fixed, not merely claimed fixed — I confirmed
each by reading the corrected lines verbatim rather than trusting the summary, given the
brief's warning that edits had twice been reported as landed when they had not. I found no
new design-level defect. The design is sound enough to implement.

### Non-blocking notes

1. **Carried forward from round 3, still unfixed and still non-blocking.**
   `design.md:31` quotes the PRE-rebase suite counts ("2690 passing, 263 suites") in the
   Context section without labelling them as pre-rebase, while D2 at `design.md:71-72`
   quotes the post-rebase 272/2768 figures. `workflow-state.md` carries both correctly
   attributed, so no information is lost and nothing is built wrong. One parenthetical
   ("pre-rebase") would resolve it. I am explicitly not spending a round on this.

2. Task 1.1 verifies a revert already present in the working tree (I confirmed it is).
   The executor should read it as "verify, and fix only if it is somehow not true", not
   as an instruction to perform an edit.

3. For the executor at task 4.2a: the expected post-restore state is precisely what I
   observed this round — one modified file, a 3-line diff, `package.json` clean at
   `^2.2.2`. That is a concrete target to compare against, not just a shape description.
