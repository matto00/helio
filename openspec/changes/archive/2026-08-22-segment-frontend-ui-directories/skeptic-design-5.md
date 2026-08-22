## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Cold review at `649f149035c89ba0b40541cfa9165540f826412c` (`HEAD` == `origin/main` == `merge-base`,
matching `BASE_SHA`). Every number below came from a command I ran in this worktree. I read rounds 1–4
as claims. Where round 4 asserted a measurement I re-derived it rather than inheriting it, and I
**executed** the mechanism the plan depends on rather than reasoning about it.

One measurement was unstable and I re-ran it: my first substitution-site count returned `0` because
this box's `grep` is `ugrep`, which rejects the backreference in `(['"])\.{1,2}/[^'"]*\1`. Re-run in
node (the language the checker will actually be written in) it returned 623. The `0` was my tooling,
not the plan.

### What I verified (with evidence)

**Round 4 CR1 — committed checker vs. the `A` allowlist. Fixed, and the fix is correct.**
`git check-ignore -v scripts/check-move-integrity.mjs` exits 1 (not ignored); `.gitignore:57` excludes
only `scripts/concertino/`. So the checker is tracked and does produce an `A` — the failure round 4
predicted is real. `design.md:110` and `tasks.md:56` now both name `scripts/check-move-integrity.mjs`
explicitly in the allowlist, as a **single file**, not `scripts/**` — which is what round 4 required and
is the form that keeps `tasks.md` 5.4's "no live infrastructure changes" prohibition intact. No new
contradiction introduced: 5.4 is now labelled verify-not-edit, and a one-file carve-out does not let a
pre-commit gate be edited invisibly.

**Round 4 CR2 — red case (g). Fixed. I ran it rather than trusting it.**
Preconditions hold on the tree: `PanelGrid.tsx:9` is `import "./PanelGrid.css";`, `MobilePanelStack.css`
exists as a sibling today, and D1 sends **both** to `grid/`, so the swapped target exists after the move
(that is what makes the case sound — a nonexistent target would fail `vite` and prove nothing).

I implemented normalize-and-compare + the specifier-target check against the real `PanelGrid.tsx`,
relocated to `grid/` with specifiers re-pointed and (g)'s mutation applied:

```
6.5 content check: IDENTICAL
  MISMATCH  old="./PanelGrid.css" -> frontend/src/features/panels/ui/grid/PanelGrid.css
            new="./MobilePanelStack.css" -> frontend/src/features/panels/ui/grid/MobilePanelStack.css
6.7 specifier-target check: FAIL
```

(g) demonstrates exactly what it claims: **6.7 FAILs while 6.5 reports IDENTICAL in the same run.**
6.7 is proven to carry load nothing else carries. Note the case is also silent to every other gate —
CSS is `styleMock`ed in `frontend/jest.config.cjs`, so `npm test`, lint and `tsc` all stay green under
the mutation. That is the point of the case, and it is correctly constructed.

**Round 4 CR3 — the un-pinned baseline. Fixed; and the attack in the brief is answered: the tautology
is NOT reopened.**
`design.md:114–119` and `tasks.md:58–61` now agree: baseline is `git ls-tree -r --name-only $BASE --
frontend/`, per-feature counts derived from that same tree, re-derived each run. `tasks.md` 1.2 is
demoted to "a record only" and 1.3 to "for documentation". Verified the derivation runs: baseline
yields 699 paths, `git ls-files frontend/` yields 699 — equal, as expected before any work.

The reasoning in the brief is **correct**. D6(e)'s tautology is reconstructing the baseline from the
**post-move working tree**, which would already lack a dropped file and so could never detect the drop.
`$BASE` is a *commit that predates the moves*; a working-tree deletion cannot propagate backwards into
it. Red case (e) still fires under the new derivation, and I confirmed its precondition:
`frontend/src/features/pipelines/hooks/useStepCardState.ts` is present in the `$BASE` tree, so deleting
it gives a post-change set of 698 against a baseline-with-renames-applied of 699 → mismatch → FAIL. It
independently trips 6.3 as well, since a deletion produces a `D`. (e) is intact.

**The 13.9% rename-similarity correction — reproduced exactly.** Measuring specifier-bearing lines over
total lines for every mover, the worst case is `panels/ui/PanelGridSkeleton.tsx` at **13.9% (5/36)`**,
next `PipelinesPage.tsx` 10.0%, `PanelGridSkeleton.test.tsx` 9.8%. Round 4's figure reproduces to the
decimal. The conclusion holds: a changed-line fraction of 13.9% leaves ~86% similarity, far clear of
git's 50% rename threshold, so the ≥116 `R` floor will not spuriously see `A`/`D`. The corrected
phrasing (changed-line fraction *below* the 50% threshold) is the right direction of comparison and is
a valid sufficient condition.

**Enumeration and the placement map — independently re-derived, not accepted on trust.** Flat/recursive
counts: `pipelines 101/101, panels 76/145, sources 30/30`. Zero drift. I then built the mover set
programmatically **from D1's stated rules** rather than counting D1's own numbers, and got **exactly 116
files** — matching `42+5+5+6+6+20+19+13 = 116`. The placement map is internally consistent and matches
the tree.

**The 623-site baseline — the plan's last hard-coded number. Reproduces exactly.** Independently
derived over the 116 movers + 15 in-place files using the design's own regex: **623 substitution sites**,
of which 24 are `.css`. This matters because a wrong pin here would reproduce the "gate fails on correct
work" class that drew three of the four prior refutes. It is right. Also confirmed 6.6 is specified as
"every site must belong to an accepted form" with 623 recorded as a baseline — not as a brittle
`count == 623` assertion — so prettier re-wrapping (which moves specifiers onto continuation closers
without changing the total) cannot fail it.

**`main` churn figures — both correct, and not contradictory.** `design.md:92` says 7 of the last 10
commits touched `frontend/`; `design.md:117` says 8 of the last 12. Measured: last 10 → 7, last 12 → 8.
Different windows, both exactly right.

**D3's coupling sweep re-verified *after* the merge that introduced a new pre-commit gate.** This was
the one place I expected post-merge drift, since `649f1490` added `check:repo-integrity` as the **first**
`.husky/pre-commit` gate. The only hard-coded `features/` path anywhere in `scripts/` is
`check-schema-drift.mjs:28` → `features/dashboards/ui/ProposalReview.tsx` (different feature, untouched),
exactly as D3 states. `check-repo-integrity.mjs` is a `git config core.bare` tripwire with one git call,
no filesystem walk, no path dependency — it introduces **no new coupling** to this change. D3 survives
the merge.

**Gate architecture — coverage is complete, with a red case per mechanism.** Silent file drop → 6.4 +
6.3 + 6.2, case (e). Silent content rewrite → 6.5, cases (a)(b′)(c). Non-import relative literal → 6.6,
case (d). Wrong-but-existing `.css` → 6.7, case (g). Vacuous base → 6.2, case (f). Tautological baseline
→ now structurally impossible. I could not find a silent failure mode left uncovered.

### Verdict: CONFIRM

**Answering the brief's final question directly: yes, this plan is good enough to execute.**

All three of round 4's blocking CRs are genuinely fixed, and — the specific thing I was asked to hunt —
**none of the three fixes introduced a new contradiction.** I checked each fix against the clause it
touched and against `tasks.md`/`design.md` cross-references, which is where round 3's fix broke round 4.
The allowlist fix does not undermine 5.4; the (g) fix is empirically sound and its target exists
post-move; the baseline fix does not reopen the tautology.

Every finding below is something execution surfaces **loudly and immediately** on the executor's own
correct work, with a fix measured in one line. None of them can produce a wrong, unverifiable, or
silently-broken result. Under the bar I was given, they are caveats for the executor, not blockers.
The integrity gate is, at this point, more rigorously specified than the change it guards.

### Non-blocking notes (hand these to the executor — note 1 will cost a cycle if unstated)

1. **NON-BLOCKING, but fix it before the first 6.7 run: extensionless specifiers need extension-aware
   resolution.** Round 4 flagged this as theoretical; I hit it live. My prototype produced **3
   false-positive mismatches out of 7 specifiers in a single file** — `./DesktopPanelGrid`,
   `./MobilePanelStack`, `./panelGridConfig` all "mismatched" because the rename map is keyed on real
   filenames (`DesktopPanelGrid.tsx`) while the resolved target is extensionless. 1030 of the ~1073
   relative specifiers in the three dirs are extensionless, so a naive 6.7 fails ~hundreds of times on a
   *correct* move. **Fix: strip/canonicalise extensions on both sides before comparing (or key the
   rename map on extension-stripped paths).** It is loud and one line, hence non-blocking — but stating
   it here saves the executor a diagnosis cycle under gate pressure, and pre-empts the tempting wrong
   remedy of "skip specifiers I can't resolve".

2. **NON-BLOCKING: round 4's CR2 asked for a "cannot resolve → FAILURE, never a skip" clause in D4 and
   it was not folded in.** Only the prettier analogue is present (`design.md:150`). I sized the residual
   risk and it is effectively nil: **all 43 extension-bearing specifiers in the three dirs are `.css`**
   (so the skip-degradation cannot lose the class 6.7 exists for), there are **zero side-effect-only
   non-CSS relative imports in all of `frontend/src`** (so every extensionless specifier carries named
   bindings that `tsc` verifies against the real module), and there is exactly **1 default export and 1
   default relative import** in the whole frontend (so the "two interchangeable default exports" hazard
   has no population). Red case (g) forces the `.css` class to be demonstrably covered regardless. Worth
   adding the clause for durability, not worth a round.

3. **NON-BLOCKING: `design.md:160` says "623 measured sites across the 132 in-scope files"; the actual
   in-scope file count is 131** (116 movers + 15 in-place, both independently confirmed). The 623 is
   exactly right; only the file count is off by one. Cosmetic.

4. **NON-BLOCKING: `tasks.md` is 83 lines against the 80-line convention** — same class as design.md's
   already-settled overrun. No repo gate enforces it (`scripts/check-openspec-hygiene.mjs` has no line
   limit), so nothing fails; noted only so it is a known deviation rather than a surprise.

5. **NON-BLOCKING, carried forward and acceptable as resolved:** `tasks.md:7`'s stale `6.3` cross-ref is
   fixed to `6.4`. Task 1.2's `sha256` manifest is still consumed by nothing, but is now explicitly
   labelled "a record only", which is a legitimate resolution of round 4's note. D3's `jest.config.cjs`
   is still unqualified between the root and `frontend/` copies — I re-checked the root one, it
   `testPathIgnorePatterns` `/frontend/`, so D3's conclusion holds under either reading.

6. **NON-BLOCKING, operational reminder for the executor:** `.husky/pre-commit` now runs
   `check:repo-integrity` first and `npm test` last on **every** commit. Red cases (a)–(g) are
   working-tree mutations and must be reverted (task 6.9) before committing — case (e) deletes a real
   source file and case (g) leaves a wrong CSS import, both of which are meant to be transient. Do not
   reach for `git commit -n` to get past a red case still in the tree.
