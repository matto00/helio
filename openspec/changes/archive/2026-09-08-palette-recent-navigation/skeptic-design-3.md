## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Content self-authentication (before any other observation).** `GET /@fs<this-lane>/frontend/src/main.tsx`
on 5951 → `200`; the same request pointed at the MAIN checkout path (`/home/matt/Development/helio/frontend/
src/main.tsx`) → `403 Restricted`. Port 5951's Vite fs root is THIS worktree. Failable by mutation (the
foreign-path arm is the mutation and it is red). Cannot prove a browser tab is not stale — no visual claim
below depends on one; there is no app code on this branch yet (`git status --porcelain` shows only the
untracked change dir; `git diff --stat 3a0c0fe8..HEAD` is empty), so there is nothing visual to judge at the
design gate.

**Base.** `git log --oneline -1` = `3a0c0fe8` (HEL-441), as stated.

**Round-2 CR2 (null transition / history wipe) — GENUINELY FIXED, in tasks.md.** Task 3.1 now carries
"**Record ONLY when the NEW value is a non-null id**", names the three real null paths
(`dashboardRemoved:238-239`, `deleteDashboard.fulfilled:298-301`, fetch-returning-none), spells out the wipe
mechanism (task 2.2's read-side validation discards the whole blob), and adds the second guard — transition
to `null` records nothing and leaves stored history intact — explicitly labelled the anti-regression for
history-wipe. Design.md D2 is consistent. That guard is failable by mutation (drop the null check → the
null-id entry is written → red). Closed.

**Round-2 CR1 (replace vs prepend) — fixed in tasks.md and design.md, NOT in the two normative artifacts.**
Task 5.1 now reads "**PREPENDS, NEVER REPLACES**", requires HEL-516's three sections to still render, and
its verification asserts Recent AND the three pre-existing sections on the empty-query view. D5 matches and
rejects replace in writing. With prepend decided, task 5.2's position guard is load-bearing rather than
unfailable — I confirmed the premise against the tree: `builtInActions.ts:24-28` lists exactly
`[NAVIGATION, GENERAL, CREATE]`, and `ranking.ts:66-71` short-circuits `trimmed === ""` to `[...actions]`
before any `matchesQuery` read, so D5's "field is never read on this path" is still correct and 5.3's
deletion still right. But the reconciliation CR1 also required of the **spec delta and the proposal** was not
performed — see the Change Request. That is the only open thread I found.

**No new defect introduced by the round-2 edits.** I re-read all of design.md, tasks.md, proposal.md and the
three spec files; the D5/D2 rewrites do not disturb D1/D3/D4, the 6.2 matrix, the gate tasks, or the
motion-guard task. Deferral re-checked as still cited (HEL-1038, task 7.4 re-verifies before PR).

---

### Verdict: REFUTE

One defect, narrow and cheap: the decided behavior (prepend) is contradicted by the two artifacts that
become the standing requirement of record. This is the same defect round-2 CR1 raised, fixed in two of the
four places it named.

---

### Change Requests

1. **The `command-action-registry` spec delta and the proposal still state REPLACE, contradicting the now-
   decided PREPEND — and the spec is the artifact that survives archive as the requirement of record.**
   - `specs/command-action-registry/spec.md`: "When a contributor supplies entries for the empty query,
     **those SHALL be presented**; when it supplies none, the existing default SHALL be presented
     unchanged", with the scenario "**THEN** those entries are presented". Read literally, a non-empty
     history presents the contributed entries and nothing else — exactly the regression of HEL-516's
     Create/Navigation/General sections (`201fd5f9`) that D5 now explicitly rejects.
   - `proposal.md` "Modified Capabilities": "a contributor may supply actions for the empty-query default,
     **displacing** the static list when it has entries" — same replace reading. The "What Changes" bullet
     "**falling back** to the static list when history is empty" reads the same way.
   - `specs/palette-recent-navigation/spec.md` inherits it: "When no history exists, the palette SHALL
     present its existing default list **instead**" — "instead" implies that with history it does *not*.
   This is not a wording nit: an executor who builds to the spec (and an evaluator/archiver who checks
   against it) ships or blesses replace, and the archived spec would permanently record a requirement the
   design rejects.
   **Required:** restate all three to prepend, e.g. — registry requirement: "the palette SHALL allow a
   contributor to supply entries that are presented **ahead of** the existing empty-query default, which
   continues to be presented; when the contributor supplies none, the existing default is presented
   unchanged", with the first scenario's THEN reading "those entries are presented **first, above the
   palette's existing default sections, which are still presented**"; proposal: replace "displacing" and
   "falling back" with prepend/above-the-existing-default language; `palette-recent-navigation` spec:
   change "present its existing default list **instead**" to "present only its existing default list", and
   add to the recents scenario that the existing default sections still appear below.

---

### Non-blocking notes

- Task 5.1 still leaves the seam open (entries passed into `rankActions` vs substituted in
  `CommandPalette.tsx:98`); `rankActions(actions, query)` has no access to visit history, so the executor
  picks. Workable either way; naming it would save a coin-flip. Carried from round 2.
- design.md D1 still cites `dashboardsSlice.ts:201` for `setSelectedDashboardId`; the reducer lives under
  `features/dashboards/state/`. Cosmetic, flagged since round 1.
- D2 still does not say in one sentence that a delete-triggered reselect records a visit the user did not
  deliberately choose. Defensible either way; better as a recorded decision than a side effect.
- HEL-1038's body still says HEL-519 "records visits at three explicit per-kind call sites" while this design
  is two mechanisms for three kinds. Worth correcting when task 7.5's sibling note is written.
