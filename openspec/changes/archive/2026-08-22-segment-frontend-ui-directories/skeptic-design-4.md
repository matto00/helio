## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold review. Every number below came from a command I ran myself in this worktree at
`649f149035c89ba0b40541cfa9165540f826412c`. I read rounds 1–3 as claims and re-derived the
load-bearing ones. I accepted as settled only what the brief listed as settled, and spot-checked
two of those anyway (enumeration, base) because they were cheap.

### What I verified (with evidence)

**Ground truth / base.** `git rev-parse HEAD` = `git rev-parse origin/main` = `git merge-base
origin/main HEAD` = `649f1490`. Working tree clean apart from `?? openspec/changes/segment-frontend-ui-directories/`.
`BASE_SHA` in `workflow-state.md` matches. Enumeration re-measured, zero drift:
`pipelines flat=101 recursive=101 / panels flat=76 recursive=145 / sources flat=30 recursive=30`.

**Round 3 CR1 (re-derived BASE) — verified consistent, and the ≥116 floor still works.**
`design.md:89–102`, `tasks.md:3, 54, 73` and `workflow-state.md:31, 46–52` all say the same thing:
`BASE = git merge-base origin/main HEAD`, re-derived every run; `BASE_SHA` is the *expected* value and
a mismatch means re-derive-and-record, not fail. No contradiction between the four statements.
The floor holds under re-derivation: pre-merge, `merge-base` is the fork point, so the diff is this
change alone (116 `R`); post-7.6-merge, `merge-base` is the `origin/main` tip, which is an ancestor of
`HEAD`, so the diff is again this change alone (116 `R`). A mis-derivation to `HEAD` yields 0 `R` →
fails. A mis-derivation to an older commit yields ≥116 `R` but detonates the status assertion instead.
**CR1 is genuinely fixed.** See CR3 for the half of the pin that was *not* released.

**Round 3 CR2 (scope split) — the underlying facts check out, and the split is sound in principle.**
`docs/compute-expression-grammar.md:4` is
`and the frontend (\`frontend/src/features/pipelines/ui/ComputeFieldConfig.tsx\`) for the` — backticks,
repo-root-relative. `(['"])(\.{1,2}/[^'"]*)\1` cannot match it, so a whole-repo content check would fail
with certainty. Scoping the content check to `frontend/` is correct.

I attacked the replacement as asked. **Coverage under `frontend/` is complete**: `R`+`M` → content check
(6.5) + site check (6.6) + target check (6.7); `A`/`D`/`T` → path set (6.4) and the status assertion (6.3);
unchanged files can't change without entering the diff. Nothing hides. **The `openspec/` carve-out is not
too broad** — it admits only this change's own artifacts, where no production code can hide. The one
genuine weakening is that `docs/compute-expression-grammar.md`'s single `M` is now verified by *reading a
one-line diff* rather than mechanically; bounded to one file and one line, acceptable.
But the carve-out is now too **narrow** — see CR1 below.

**Round 3 CR3 (red cases) — five of the six land; the count is right and the coverage is not.**
D6 lists (a)(b′)(c)(d)(e)(f) and `tasks.md:64` matches it exactly. Mapping each to the mechanism it
exercises: (a)(b′)(c) → 6.5 content check; (d) → 6.6 site check; (e) → 6.4 path set (and, incidentally,
6.3, since a delete produces a `D`); (f) → 6.2 non-vacuity. **6.7, the specifier-target check, gets none**
— see CR2. The prettier-error clause is present and correct (`design.md:142–144`, `tasks.md:60`).

**The specifier-target check's premise — I re-measured it rather than inheriting it.**
`frontend/jest.config.cjs` maps `"\\.(css)$"` → `<rootDir>/src/test/styleMock.js`, path-insensitively.
`PanelDetailModal.tsx:4–8` carries five side-effect CSS imports in one block. So a wrong-but-existing
`.css` specifier is invisible to `tsc`, `vite`, `jest` **and** to 6.5's normalization. The check is
aimed at a real class. (Note there are *two* `jest.config.cjs` files; D3's description matches
`frontend/jest.config.cjs`. I read the root one too — it `testPathIgnorePatterns` `/frontend/`, so it also
needs no change. D3's conclusion holds under both readings.)

**Implementability of 6.7 — measured.** Across the three `ui/` dirs there are **1030 extensionless**
relative specifiers vs **43 with an extension**. The design says "apply the rename map" without saying how
an extensionless specifier keys into a map built on real filenames. That is 96% of the sites. It is
implementable (probe `moduleFileExtensions`, or build extension-stripped map keys), and the class 6.7
actually targets — `.css` — is entirely in the with-extension set, so a degenerate implementation would
still cover the target class. Non-blocking, but unstated.

**Other adopted items.** `design.md:3` now cites `649f1490` (corrected). `mkdir -p` appears at
`tasks.md:13` (§2), `:25` (§3) and `:34` (§4). `tasks.md:66` commits the checker. Task 8.1's claim is
correct: `PipelineDetailPage.css.test.ts:13` cites the path in a **backtick** comment, which the
normalizer cannot touch, so tidying it would genuinely fail 6.5.

**design.md D4/D6 vs tasks.md §6 — checked for drift after the renumbering.** The mapping is consistent
(6.1 base, 6.2 non-vacuity, 6.3 status, 6.4 path set, 6.5 content, 6.6 sites, 6.7 target, 6.8/6.9 red
cases + revert, 6.10 commit), 7.6's "re-run 6.1–6.7" is right, and 8.1's "6.5" is right. One stale
cross-reference survived — `tasks.md:7` (see non-blocking notes).

### Verdict: REFUTE

To be explicit about the budget, because it matters: **the plan itself is sound and I found nothing that
requires re-planning.** The placement map, the D3 coupling sweep, the measured 15-file/78-line impact set,
and the normalize-and-compare mechanism all survive a cold re-check. What I am refuting on is three
single-clause defects in the §6 gate spec, two of which are the *same failure class this gate already
refuted twice* — a gate that fails on correct work — and one of which was **introduced this round** by
adopting round 3's advice without following it through. All three are edits to `design.md` D4/D6 and
`tasks.md` §6, nothing else. Round 5 should be a formality.

I would not have refuted on CR2 alone. CR1 and CR3 are what force it: in both, `tasks.md` as written
instructs the executor into a failing gate, and in CR3's case it also instructs them *away* from the
correct fix.

### Change Requests

1. **BLOCKING — Task 6.10 mandates committing a file that task 6.3 mandates must fail the gate.**
   `tasks.md:66` commits the checker as `scripts/check-move-integrity.mjs`; `tasks.md:56` / `design.md:109`
   permit `A` **only** under `openspec/changes/segment-frontend-ui-directories/`. `scripts/*.mjs` is not
   gitignored (`.gitignore` only excludes `scripts/concertino/`), so the checker is tracked. Demonstrated in
   a scratch repo with the identical shape:

   ```
   $ git diff -M --name-status $BASE
   R100  frontend/f1.txt   frontend/sub/f1.txt
   A     openspec/changes/x/design.md
   A     scripts/check-move-integrity.mjs      <- fails 6.3
   ```

   This is structurally identical to round 3's CR2 (task 5.3 requires an edit task 6.4 requires to fail),
   and it fails with certainty on every run after the checker is committed — including the 7.6 re-run.
   Required: name `scripts/check-move-integrity.mjs` explicitly in the `A` allow-list, in **both**
   `design.md:109–111` and `tasks.md:56`. Name the single file, not `scripts/**` — a directory-wide
   carve-out would let a live pre-commit gate be edited invisibly, which task 5.4 exists to prevent.

2. **BLOCKING (cheapest) — The check added *this* round is again the one with no red case.** Round 3's CR3
   was "the two assertions added this round are the two with no red case." The specifier-target check
   (6.7 / `design.md:155–162`) is this round's addition and has no red case among (a)–(f). It is also the
   one the plan *explicitly relies on being the only thing that works*: `tasks.md:63` — "This is what
   catches a wrong-but-existing `.css` path, which nothing else detects." By D6's own premise ("a checker
   never observed failing is not evidence"), a relied-upon check that is never observed failing is exactly
   what D6 forbids. Its failure mode is silent: an implementation that resolves both sides through the same
   map, or that skips a specifier it cannot resolve, passes forever, and re-running it downstream re-runs
   the same tautology.

   Required: add case **(g)** to D6 and to `tasks.md:64` — in a moved file, swap `"./PanelGrid.css"` for
   `"./MobilePanelStack.css"` (both exist, both move); require **6.7 to FAIL and 6.5 to report IDENTICAL**
   in the same run, with both outputs pasted. The paired assertion is the point: it proves 6.7 is carrying
   load that nothing else carries. Fold in the analogue of the prettier clause while editing D4: **a
   specifier that cannot be resolved on either side is a FAILURE, never a skip** — the same
   swallow-the-error-and-compare-nothing false pass, in the same dangerous direction.

3. **BLOCKING — CR1's pin was released on `BASE` but not on the baseline it is compared against; task 7.6
   is again the run where that bites.** `tasks.md:58` requires the post-change `frontend/` path set to equal
   **task 1.2's** manifest plus the rename pairs, and pins per-feature counts at `101 / 76 / 145 / 30`.
   Task 1.2 is captured once, "before any move". Task 7.6 then merges an advanced `origin/main` and re-runs
   6.4. Any file `main` added or removed under `frontend/` in the interim makes that equality false, and any
   file `main` added to one of the three `ui/` dirs breaks the counts — on correct work.

   This is not hypothetical. Of `origin/main`'s last 12 commits, all within two days, **8 touched
   `frontend/`**, adding 2 / 10 / 11 / 14 / 15 / 23 / 34 / 62 files:

   ```
   29fc0528 2026-08-21 HEL-683 ... [frontend files: 2]
   8432f280 2026-08-21 HEL-554 ... [frontend files: 23]
   785e0af9 2026-08-21 HEL-773 ... [frontend files: 14]
   09a7a65c 2026-08-21 HEL-548 ... [frontend files: 34]
   d7815d15 2026-08-20 HEL-528 ... [frontend files: 62]
   ```

   Worse, `tasks.md:59` actively points away from the fix: "Baseline must come from 1.2, never reconstructed
   from the post-move tree." An executor reading that literally will not re-derive, and the ad-hoc remedy
   under gate pressure is to hand-wave the extra paths — loosening the exact assertion round 2's CR5 added.

   Required: derive the baseline path set the same way `BASE` is derived —
   `git ls-tree -r --name-only $BASE -- frontend/`, re-derived at every run — and treat task 1.2's manifest
   and the `101 / 76 / 145 / 30` counts as **expected** values, exactly as `BASE_SHA` is now treated.
   This does **not** reopen the tautology D6(e) guards: `$BASE` predates the move, so the baseline still
   cannot be reconstructed from the post-move tree. Reword `tasks.md:59` accordingly — "from `$BASE`'s tree,
   never from the post-move tree" — so the prohibition still bites where it should.

### Non-blocking notes

- **`tasks.md:7` has a stale cross-reference from the renumbering.** It says the tracked-path set is "for
  the whole-tree assertion in 6.3"; the whole-tree assertion is now **6.4** (6.3 is the whole-repo status
  assertion). One character, but it points a reader at the wrong check.
- **6.7's resolution rule is unstated for 96% of its sites.** 1030 of the 1073 relative specifiers in the
  three dirs are extensionless (`"../hooks/useStepCardState"`), and the design says only "apply the rename
  map" — which is keyed on real filenames. State the resolution (probe `moduleFileExtensions`, or key the
  map on extension-stripped paths). Downgraded from blocking because the `.css` class 6.7 exists for is
  entirely within the 43 with-extension sites, so even a degenerate implementation covers the target class
  — provided CR2's red case proves it does.
- **`design.md:210` understates the worst-case rename-similarity figure.** It claims "worst-case changed-line
  fraction across the 116 movers is 6.5%". I measured every file in the three dirs: the worst is
  `panels/ui/PanelGridSkeleton.tsx` at **13.9%** (5 specifier-bearing lines of 36), and it is a mover
  (→ `grid/`). The conclusion is unaffected — 13.9% is still far above git's 50% similarity floor, and not
  every matching line actually changes — but the number in the doc is wrong by 2×.
- **D6(e) exercises 6.3 as well as 6.4** (deleting a tracked file produces a `D`, which the status assertion
  forbids). Saying so would give 6.3 a named red case at zero cost; as written, 6.3 has none.
- **Task 1.2's `sha256` manifest is never consumed.** No task in §6 references it — content identity runs
  through `git show $BASE:<oldpath>` and normalize-and-compare. Harmless, but either wire it in or drop it,
  so the executor doesn't spend effort producing an artifact nothing reads.
- **`jest.config.cjs` is ambiguous in D3** — there are two (root and `frontend/`). D3's description matches
  `frontend/jest.config.cjs`. I checked the root one as well: it `testPathIgnorePatterns` `/frontend/`, so it
  needs no change either, and D3's conclusion holds. Qualify the filename.
