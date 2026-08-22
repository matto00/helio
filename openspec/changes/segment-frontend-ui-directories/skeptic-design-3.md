## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Every number below came from a command I ran myself in this worktree at
`649f149035c89ba0b40541cfa9165540f826412c`. I read rounds 1 and 2 as claims and re-derived their
load-bearing facts rather than inheriting them.

### What I verified (with evidence)

**Ground truth / base.** `git rev-parse HEAD` = `git rev-parse origin/main` = `git merge-base HEAD
origin/main` = `649f1490`. The branch carries no commits of its own; the only working-tree entry is
`?? openspec/changes/segment-frontend-ui-directories/`. `BASE_SHA` in `workflow-state.md` matches.
So the pinned base is correct **as of now**. See CR1 for when it stops being correct.

**Enumeration — the ticket's premise. Re-measured, zero drift.**

```
pipelines flat=101 recursive=101
panels    flat=76  recursive=145
sources   flat=30  recursive=30
```

**Placement map — rebuilt independently from D1's rules, not read off design.md.**
`pipelines 42/5/5/6/6/37 = 101`, `panels 20/19/37 = 76`, `sources 13/17 = 30`, **116 moves**, zero
files unassigned. Root member lists match D1 member-for-member. D1 is correct.

**CR2's fix (fixed-length token + prettier both sides) — I implemented the D4 comparison exactly as
specified and ran it against real files.** Simulating the real move on `PanelGrid.tsx`
(`"../` → `"../../`, which takes line 7 from 99 to 102 chars and forces a 4-line re-wrap):

```
1. legitimate move (depth-shift only)        : IDENTICAL   <- the round-2 false failure is gone
2. dropped named import (red case b-prime)   : DIFFERENT
3. deleted a logic line                      : DIFFERENT
4. deleted a // comment                      : DIFFERENT   <- round 1's over-consumption class closed
4b. edited a // comment's text               : DIFFERENT
7. corrupted a non-relative string literal   : DIFFERENT
```

Comment text and non-specifier string contents both survive prettier and are therefore guarded.
**CR2 is genuinely fixed.** The masked residue is exactly three non-semantic classes plus one
semantic one — see the non-blocking notes.

**CR3's fix (statement-level site set) — measured, and it matches the tree exactly.** I enumerated
every quoted relative literal across the 116 moved + 16 in-place files:

```
TOTAL substitution sites: 623
   538  import/export statement line
    62  jest.mock(
    22  CLOSER (} from "…";)
     1  jest.requireActual(       (SqlTab.test.tsx:14)
```

623 exactly, and 22 + 1 = the 23 sites round 2 said the per-line form rejected. My deliberately
naive statement-level heuristic reproduced the classification with no false positives, so the rule
**is** implementable unambiguously. One point in the design's favour that it does not claim: prettier
re-wrapping moves a specifier to a different line but never changes the *number* of literals, so 623
is stable across the move and an equality assertion on the count will not false-fail.
**CR3 is genuinely fixed.**

**CR5's fix (whole-tree path set) — sound and implementable within `frontend/`.** It does subsume the
directory-scoped `A`/`D` wording and does catch a dropped `useStepCardState.ts`. Two gaps: it does
not cover paths outside `frontend/` (CR2 below), and it has no red case (CR3 below).

**Supporting facts I re-measured rather than assumed:**

- All three `ui/` trees and all in-place files are prettier-clean at BASE (`prettier --check`, exit 0),
  so the "prettier both sides" step is a no-op on the old text.
- `grep -rnE "url\(|@import|['\"]\.{1,2}/"` over all moved `.css` → **0 hits**. Raw comparison for
  `.css` is correct and complete.
- All 7 `path.join(__dirname, …)` sites use a **bare filename** with no `./` prefix, so the regex
  never touches them, the string never changes, and byte-identity guards them. D1 moves each test
  with the stylesheet it reads.
- `prettier.config.cjs` has `printWidth: 100` and **no `overrides`**, so parser selection is purely
  extension-driven and the old/new paths always share an extension.
- `PanelGrid.tsx:7` = 99 chars, `stepNarrowing.ts:63` = 95, `:72` = 89 — all cross 100 after the
  move. Round 2's re-wrap measurement is real.
- Task 8.1 does close round 2's "leave the backtick comment stale" note.

### Verdict: REFUTE

CR2, CR3, CR4 and CR5 from round 2 are properly addressed and I would not reopen any of them; the
normalize-and-compare mechanism now works on real code, which is a real advance over round 2. But the
CR1 fix over-corrected: pinning the base absolutely is correct only while `origin/main` stands still,
and task 7.6 explicitly re-runs the gate *after* merging a `main` that has moved. And a separate,
certain contradiction survived both prior rounds untouched: task 5.3 mandates an edit that task 6.4
mandates must fail. Both are one-clause fixes, but both put the executor in front of a gate that fails
on correct work — the precise pathology round 2 refuted on, and the one whose predictable resolution
is an ad-hoc narrowing that silently guts the CR5 assertion.

### Change Requests

1. **BLOCKING — The pinned `BASE` is only valid while `origin/main` has not advanced, and task 7.6
   guarantees the run where it has.** D4 ("used identically for … every re-run, including 7.6") and
   task 7.6 ("re-run 6.1–6.5 … still against `$BASE`") instruct the executor to diff against
   `649f1490` *after* merging an advanced `origin/main` into the branch. At that point the change set
   is the union of this change **and every `main` commit since the pin**. I measured the effect by
   pinning one step earlier (a 3-commit advance) and diffing the current tree:

   ```
   git diff -M --name-status 785e0af9^ -- frontend/
        16 A
        22 M
   A  frontend/src/features/onboarding/hooks/useOnboardingHost.ts        <- this change never touches it
   A  frontend/src/features/onboarding/state/onboardingSlice.ts          <- ditto
   ```

   16 paths absent from the task-1.2 baseline → **task 6.3 fails**. 22 files with real content
   changes → **task 6.4 fails**. This is not hypothetical: `main` took 15 commits in the last two
   days and **7 of the last 10 touched `frontend/`**, adding 2–14 files each. The likely executor
   response to a wall of unrelated failures is to narrow the change set to the three `ui/` dirs —
   which reopens exactly the hole CR5 closed.

   Required: define the base as **re-derived at every run** — `BASE = git merge-base origin/main
   HEAD` — with `BASE_SHA` recorded as the *expected* value and a mismatch triggering re-derivation,
   not a failure. State that after task 7.6's merge this necessarily resolves to the `origin/main`
   tip, which is the correct base for the branch's own diff.

   This **preserves every property round 2's CR1 asked for** and is not a reversal of it: the base is
   still never `HEAD`, so it is never vacuous; `git show $BASE:<oldpath>` still resolves, because
   `main` never moves those paths; and the ≥116 `R` floor still catches a mis-derived base. It is
   also strictly *more* correct in the case where `main` edits a file this change moves — the merge
   applies that edit to the relocated file, which a pinned base reports as a content difference and a
   re-derived base reports correctly.

2. **BLOCKING — Task 5.3 requires an edit that task 6.4 requires to fail.** Task 6.1 defines the
   change set as `git diff -M --name-status $BASE` over the whole repo, "covering **every** entry with
   status `R` or `M`, including files outside the three `ui/` dirs", and 6.4 subjects every such file
   to normalize-then-byte-identity. Task 5.3 modifies `docs/compute-expression-grammar.md`, which is
   `M`. That file cites the moved path in **backticks, repo-root-relative**:

   ```
   docs/compute-expression-grammar.md:4
   and the frontend (`frontend/src/features/pipelines/ui/ComputeFieldConfig.tsx`) for the
   ```

   The normalizer `(['"])(\.{1,2}/[^'"]*)\1` requires a `'`/`"` delimiter **and** a `./`/`../` prefix.
   I ran it: `regex matches: []`, and `normalized old == normalized new` → **False**. So 6.4 fails on
   this file with certainty, on the first run, before any corruption exists. (`docs/` is not in
   `.prettierignore` and the file is prettier-clean, so the prettier step is not the problem — the
   content genuinely differs and nothing normalizes it.)

   Required: scope the content-identity check (6.4/6.5) to `frontend/` source files, and replace the
   lost whole-repo coverage with an explicit whole-repo status assertion in 6.2 — no `D` or `T`
   anywhere; `A` only under `openspec/changes/segment-frontend-ui-directories/`; the only `M` outside
   `frontend/` is `docs/compute-expression-grammar.md`, verified by reading its one-line diff. That
   carve-out is needed regardless: 6.1's whole-repo change set will also contain this change's own
   `openspec/` artifacts, which are legitimately `A` and must not trip 6.2.

3. **BLOCKING (cheapest of the three) — The two assertions added *this round* are the two with no red
   case.** D6's own premise is "a checker never observed failing is not evidence", and cases (a),
   (b′), (c), (d) cover 6.4 and 6.5 well. But **6.2 (non-vacuity) and 6.3 (whole-tree path set) are
   never observed failing** — and they are the direct products of round 2's CR1 and CR5. Their failure
   mode is silent by construction: a tautological implementation (most plausibly, reconstructing the
   task-1.2 "baseline" from the post-move tree because 1.2 was skipped or lost) passes forever, and
   neither the evaluator nor the final-gate skeptic can detect that by re-running it — they would
   re-run the same tautology and see green.

   Required: extend task 6.6 with two more red cases, each shown FAILING with pasted output —
   **(e)** delete a file *outside* the three `ui/` dirs (use `pipelines/hooks/useStepCardState.ts`,
   the exact file CR5 named) and confirm **6.3** fails; **(f)** run the checker against a base that
   yields no renames and confirm **6.2** fails rather than reporting clean. Task 6.7's revert
   confirmation extends to all six.

   Fold in one robustness clause while editing 6.4: **a prettier invocation that errors on either side
   is a FAILURE, never a skip.** I confirmed prettier exits non-zero with empty stdout on syntactically
   invalid input; a checker that catches that and substitutes `""` compares `"" == ""` and reports
   IDENTICAL — a false pass in the dangerous direction.

### Non-blocking notes

- **The masked class is real and D4's justification for accepting it is measurably incomplete.** D4
  and round 2 both reason that masking the *contents* of relative literals is safe because "a wrong
  module path fails `tsc`, `vite build`, or `jest`'s module resolution". That is true for code
  modules and false for `.css`. CSS is imported for side effects only (`import
  "./PanelDetailModal.css";` — 5 such lines in one block in `PanelDetailModal.tsx`), `jest.config.cjs`
  maps `"\\.(css)$"` to `src/test/styleMock.js` regardless of path, and `tsc`/`vite` accept any path
  that exists. I measured it: swapping `"./PanelGrid.css"` for `"./MobilePanelStack.css"` compares
  **IDENTICAL**, and no other gate in §7 detects it. 14 `.css` files move. Probability is low (it
  needs a wrong-but-existing target, not the wrong-depth error that fails loudly), and the final
  gate's screenshots are a partial backstop, which is why this is not blocking. Cheap total closure if
  you want it: the checker already enumerates all 623 sites and holds the rename map — resolve each
  old specifier against the old file's directory and each new specifier against the new file's
  directory, and require both to name the same target after applying the map. That closes the entire
  masked class, and would also catch depth errors before `tsc` does.
- `design.md:3` still says "Measured on the current tree (`ecee3af8`)". The base is now `649f1490`. I
  re-measured the enumeration at `649f1490` myself and found zero drift, so this is a stale citation,
  not a stale fact — but it is the first line a reviewer reads.
- Round 2's note that **nothing says where the checker lives** is still unaddressed. If it is a
  throwaway, the evaluator and final-gate skeptic cannot re-run it and CR3's red cases are the only
  evidence it ever worked. One clause committing it (e.g. under `scripts/`) or pasting it verbatim
  into the execution report would fix this — and it is what makes CR3's red cases durable.
- Round 2's note that `git mv` destination creation (task 2.1) is stated only under §2 is still
  unaddressed; §3 and §4 do not repeat it. Trivial, and fails loudly.
- Zero `require(` and zero dynamic `import(` sites exist in scope today; the accepted-form set names
  both anyway. Harmless over-acceptance, no action needed.
