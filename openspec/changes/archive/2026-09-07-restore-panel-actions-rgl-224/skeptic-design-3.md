## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Fresh cold spawn. Every finding below is derived from reading the files in the worktree, not from
the orchestrator's summary or from rounds 1-2's narrative.

### What I verified (with evidence)

**Tree state (CR3 from round 2) — CLOSED.**
- `git status --short` -> `M frontend/package-lock.json` only (plus the untracked change dir).
- `git diff --name-only` -> `frontend/package-lock.json`, and the full `git diff` is exactly the 3
  lines `version` / `resolved` / `integrity` under `node_modules/react-grid-layout`, 2.2.3 -> 2.2.4.
  Nothing else.
- `grep -n 'react-grid-layout' frontend/package.json` -> line 31 `"^2.2.2"`. Clean (not in the diff).
- `grep -n 'react-grid-layout' frontend/package-lock.json` -> line 23 (the root `packages[""]`
  dependency map) is `"^2.2.2"`; the only other hits are the `node_modules/react-grid-layout` entry
  at 11460-11462. The `^2.2.4` leak round 2 found is gone from BOTH files. Verified by reading the
  lock, not by `npm ci` (which round 2 established cannot see this).
- `tasks.md:3` (task 1.1) now names the trap explicitly ("`npm ci` does NOT catch a mismatch here —
  2.2.4 satisfies `^2.2.2`, so a dry-run succeeds either way") and prescribes the diff-shape check.
  Matches what round 2 asked for.

**CR2 from round 2 (design.md Risks bullet) — CLOSED.**
- `design.md:119-122` no longer references the withdrawn `clientWidth` D2. It now reads
  "[Shimming `getComputedStyle` globally perturbs unrelated suites] -> ... MEASURED at 272/272 suites
  and 2768/2768 tests green with the shim, against a 271/272 + 2 failed baseline", and names the
  already-resolved-`px` carve-out. Correct shim, correct numbers, matches D2 at `design.md:69-73`.

**CR1 from round 2 (stale "width is 0" root cause) — PARTIALLY closed. Two survivors.**
- The two places round 2 named ARE fixed: `workflow-state.md:29-43` ("## Root cause") now carries the
  corrected `getComputedStyle` -> `"100%"` -> `parseFloat` -> `100` mechanism and states "Measured
  width is 100, not 0"; `workflow-state.md:83-85` (the rebase re-derivation paragraph) labels the old
  probe reading SUPERSEDED rather than deleting it, as asked.
- But CR1's standard was "no stale width-is-0 claim survives anywhere in any artifact", and two do.
  Found by `grep -rniE '(width|silently)[^.]{0,20}\b(0|zero)\b'` over the five non-skeptic artifacts;
  reproduced with a second independent `grep -n 'Width 0' *.md`. Both greps agree. See CR1/CR2 below.

**Nothing else objectionable found.** I re-read `proposal.md`, `design.md`, `tasks.md` and
`ticket.md` in full looking for a NEW defect rounds 1-2 missed: no `TODO`/`TBD`, no unspecified
types, no AC left uncovered (D4's three evidence classes map onto tasks 1.2/1.3, 3.1-3.4, 4.1-4.5),
no scope drift past the harness + lockfile, `skip_specs: true` justified by a genuine no-product-code
diff. Task 3.5 correctly bans root `npm test` for the exact `--passWithNoTests` reason in my evidence
discipline. Tasks 3.3/3.4 name the mutation target and 3.4 explicitly points the mutation at the
shim the fix adds rather than the withdrawn stub. Deferrals name real tickets (HEL-1023, HEL-1006).
I did not re-litigate the explanation-4 ruling, the D2 shim shape, the measured blast radius, the
D5/D6 real-browser work, the gate-command naming, or D7/D8 — no new evidence bears on them.

### Verdict: REFUTE

Narrow. Both blocking items are one-line edits; the substance of the design remains sound and I found
no new design-level defect. I am not CONFIRMing on CR1/CR2 because they are not editorial: they are
the disproven root-cause claim itself, still asserted as fact in the two documents an executor reads
to understand the mechanism, after two prior rounds in which this same item was reported closed and
was not.

### Change Requests

1. **`ticket.md:67` still asserts the disproven mechanism.** The line reads:
   `` `PanelGrid.tsx` branches on `width < panelGridConfig.breakpoints.sm` (768). Width 0 -> phone branch -> `MobilePanelStack` -> no panel-actions button. ``
   This sits eight lines AFTER the "CORRECTED MECHANISM" block that establishes the width is 100, and
   directly contradicts it. Rewrite the antecedent to the measured value (e.g. "Width 100 -> 100 < 768
   -> phone branch -> ..."). The branch condition itself is correct and should not change.

2. **`design.md:52` still asserts the disproven mechanism inside D1's rationale.** The line reads
   "... and the product's desktop/phone branch is width-driven, so a silently-zero width is not an
   inert harness detail - it changes which component tree renders." The argument D1 is making is
   correct and survives verbatim once the number is right; it is only "silently-zero" that is false.
   Replace with the corrected framing (e.g. "a silently-unrealistic width" / "a silently-100 width").
   This is load-bearing prose, not a footnote: it is the stated justification for D1's choice to fix
   the harness rather than the query.

3. **Task 4.2 mandates installing 2.2.3 and never mandates restoring the lockfile.** Task 4.2 says
   "Capture the same states with 2.2.3 installed as the before-baseline on this same rebased base".
   Doing that mutates `frontend/package-lock.json` — the single file this entire PR changes, and whose
   exact 3-line shape was round 2's CR3 blocker. The only check on that shape (task 1.1) runs in
   section 1, long before 4.2, and nothing after 4.2 re-checks it. Round 2 already proved `npm ci`
   cannot detect lockfile drift in this range, so there is no ambient safety net. Add to task 4.2 (or
   as a new 4.6 / an addition to 5.1) an explicit "reinstall 2.2.4 and re-run task 1.1's diff-shape
   check — `git diff frontend/package.json` empty and the lock diff exactly 3 lines" step. This is the
   same defect class that has now bitten this change once already.

### Non-blocking notes

- `design.md:31` still quotes the PRE-rebase suite counts ("2690 passing, 263 suites") without
  labelling them as such, while `design.md:71-72` (D2) quotes the post-rebase 2766/2768 across 272
  suites. `workflow-state.md:42-43` carries both and correctly attributes each to its base, so the
  information exists; only `design.md`'s Context section reads as if 2690/263 were current. Worth one
  clarifying parenthetical, not worth a round on its own.
- Task 1.1 is written as a confirmation of a revert that has already landed in the working tree (I
  verified it has). That is fine and I would not change it, but the executor should read it as
  "verify, and if it is somehow not true, fix it", not "perform an edit".
