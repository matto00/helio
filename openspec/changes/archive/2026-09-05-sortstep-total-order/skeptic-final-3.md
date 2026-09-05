## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Cold spawn. Review base resolved explicitly:
`BASE=$(git merge-base origin/main HEAD)` → `7ab38ad5998ffaa2128f6989a6e34aa00799eaed`
(origin/main is `de43dc9c`; the worktree's local `main` is stale — never used). Diff read as
`git diff $BASE...HEAD`: 13 files, 1015 insertions / 12 deletions. Only two non-`openspec/`
files touched (`SortStep.scala`, `SortStepSpec.scala`). No migration anywhere (AC6).

### What I verified (with evidence)

**1. The recurring rationale defect — all five sites now state the correct, true rationale.**
Read each replacement text in full and judged it against the implementation, not merely
confirmed the old string is gone.

| # | Site | Current text | Verdict |
|---|---|---|---|
| 1 | `SortStep.scala` class scaladoc (tier-2 bullet) | "excluded from tier 1 on data-semantics grounds: a cell that only *looks* numeric but coerces to `NaN`/`Infinity` is junk data … (Tier 1's own within-tier comparison is `Double.compareTo`, a genuine total order that places `NaN` last — the exclusion is not needed for transitivity, which would hold either way.)" | correct |
| 2 | `SortStep.scala` `finiteNumeric` scaladoc (:90-97) | same data-semantics framing + explicit "(Not needed for transitivity: … `Double.compareTo`, a total order that already places `NaN` last …)" | correct |
| 3 | `design.md` Risks, bullet 2 | "…which is a genuine total order placing `NaN` last, so transitivity would hold even if these values stayed in tier 1 — this is **not** a transitivity requirement. Excluding … is a data-semantics choice instead…" | correct |
| 4 | `specs/pipeline-sort-op/spec.md` tier-2 clause (~L22) — **highest value, archives permanently** | "because a cell that only *looks* numeric but coerces to `NaN`/`Infinity` is junk data, not a magnitude the user meant to rank — ranking it among real numbers (`NaN` sorting above every actual value) would be a nonsensical result, not a correctness requirement." | correct |
| 5 | `SortStepSpec.scala` :17-22 | "…a cell that only looks numeric but coerces to NaN/Infinity is junk data, not a magnitude the user meant to rank … — a data-semantics choice, not a transitivity requirement; see mutation-evidence.md Mutation D" | correct |

The claim itself is true of *this* implementation: `compareNonNullAsc` (`SortStep.scala:114`)
compares tier 1 with `xd.compareTo(yd)`. Independent empirical confirmation that this is the
total order (not IEEE `<`): the Mutation D transcript in `mutation-evidence.md` records output
`5, Infinity, NaN, 0aa, n/a` — `NaN` sorted *greatest* among tier 1 rather than compared false,
and guard 2.3 (transitivity) stayed **green** under that mutation. That transcript is the direct
disproof of the old rationale, and it is now the artifact site 5 cites.

**2. Site 5's laundered attribution is fixed.** It previously cited "design.md D5 / D1 risk" as
the source of a claim those sections refute. It now cites `design.md Risks` (which states the
data-semantics rationale verbatim) and `mutation-evidence.md Mutation D` (which is the evidence).
Both actually support the claim.

**3. No surviving IEEE-comparison variant in load-bearing code or specs.** Grepped
`compares false|false against everything|break(s) transitivity|IEEE|transitivity within` across
all `*.scala` and `*.md`: zero hits inside this change's code, `design.md`, `spec.md`, `tasks.md`,
`mutation-evidence.md`, `files-modified.md`. The only IEEE hits repo-wide are in an unrelated
archived change (`2026-07-27-column-statistics-workspace-context`), correctly used there.

**4. No overcorrection into a fresh false claim.** The wording never implies the `.filter(_.isFinite)`
is optional: `spec.md` states tier-2 membership normatively ("This tier explicitly **includes**…"),
`tasks.md 1.1` mandates "accepting **only finite** doubles", and guard 2.7 pins it by failing under
Mutation D. The parenthetical "would hold either way" is scoped strictly to transitivity in every
one of the five sites, never to output correctness. Nor does any site claim NaN-in-tier-1 is
harmless in output terms — spec.md explicitly calls that outcome "a nonsensical result".

**5. No trichotomy asserted.** `design.md` D1, `spec.md` ("implementations and tests SHALL NOT
assume trichotomy"), and the class scaladoc all state the relation is a strict weak ordering with
`9` ≡ `"9"`. Guard 2.2 is written to permit equivalence (`strictlyBefore` guards `x != y` and
requires agreement across both input orders); guard 2.6 asserts on equivalence classes, not raw
values. Nothing demands strict inequality anywhere.

**6. `mutation-evidence.md` / `tasks.md` remain accurate after the edits.** Read both in full.
Mutation D section, the four-column coverage table (2.7 fails under A/B/C/D; 2.1/2.2 exempt;
2.3 fails only under C), the 2.6 cycle-2 strengthening note, and task 2.14 all match the shipped
`SortStepSpec.scala` — I re-derived 2.7's expected output by hand for both tierings
(shipped `5, "0aa", "Infinity", "NaN", "n/a"` vs. mutated `5, Infinity, NaN, "0aa", "n/a"`) and it
matches the recorded transcripts. Guard names/line refs line up.

**7. Gates re-run by me, not taken on report.**
- `sbt -batch test` (from `backend/`): `Tests: succeeded 3844, failed 0` / `Suites: completed 254, aborted 0` / `[success] Total time: 288 s`.
- `node scripts/check-scala-quality.mjs` → `Scala code-quality check: clean (156 soft warning(s))` (all pre-existing test-file line-budget warnings; none in the two changed files).
- `npm run format:check` → `All matched files use Prettier code style!`
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`
- `node scripts/check-spec-structure.mjs` → `passed (349 canonical specs, 0 issues)`
- `npx openspec validate sortstep-total-order --strict` → `Change 'sortstep-total-order' is valid`

**8. AC spot-checks (not a third full sweep, per scope).**
- AC3: `git diff $BASE...HEAD -- …/SortStepSpec.scala | grep '^-'` yields only the `--- a/…` file header — **zero deleted or modified lines**, so HEL-893's two guards are provably unmodified. Null-last behaviour preserved in the untouched `case (None,_)/(_,None)` branch.
- AC4: `SortStep.apply`'s `foldRight`/`sortWith` multi-key structure is unchanged; the whole fix is inside the pair comparison.
- AC6: no file under `db/migration/` in the diff.

**9. No UI changes** — diff touches only backend Scala and `openspec/`. Section 4 (visual/design
judgment, servers) correctly skipped; not started, so no environmental risk taken.

### Verdict: CONFIRM

Round 2's sole blocker was documentation consistency, and the two follow-up commits (`58f849dd`,
`4b9a070b`) close it at all five sites with text that is true of the shipped implementation,
mutually consistent, correctly attributed, and not overcorrected. Gates are genuinely green under
my own execution. Ships.

### Non-blocking notes

- `files-modified.md` line 3 still enumerates `mutation-evidence.md` as containing "mutations A …,
  B …, and C …" — Mutation D was added in cycle 3 and is not listed. This is an incomplete
  inventory line, not a false technical claim, and `mutation-evidence.md`/`tasks.md 2.14` are both
  accurate. Worth a one-word fix if anything else touches the branch; not worth a round on its own.
- `skeptic-design-1.md:24` still contains that round's own analysis line "Excluding NaN/infinite
  from tier 1 is necessary and correctly identified". It is a dated design-gate review report — a
  historical audit artifact in the same category as `evaluation-*.md`, explicitly labelled as that
  round's reasoning, and it is *not* folded into `openspec/specs/` on archive (only
  `specs/pipeline-sort-op/spec.md` is, and that site is correct). Flagged for the record, not a
  finding. Rewriting a past review report to match a later conclusion would falsify the audit trail.
