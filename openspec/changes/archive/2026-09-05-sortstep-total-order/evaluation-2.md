## Evaluation Report — Cycle 2 (evaluation-2.md)

Review base resolved explicitly: `BASE=$(git merge-base origin/main HEAD)` = `7ab38ad5` (the worktree's
local `main` ref is stale and was not used). Diff under review: 2 commits (`5f6bf48a`, `987970e0`).
Fresh evaluator session; cycle-1 findings recovered by reading `evaluation-1.md`, all evidence below
re-measured by me in this worktree — nothing credited to the executor's transcript.

### Phase 1: Spec Review — PASS

Cycle 1 passed Phase 1; the only question this cycle is whether `987970e0` regressed it. It did not.

- **Scope of the new commit confirmed.** `git show --stat 987970e0` = exactly two files:
  `backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala` (+8/-2) and
  `openspec/changes/sortstep-total-order/mutation-evidence.md` (+39/-16). **No `SortStep.scala`
  change** — the shipped comparator is byte-identical to the cycle-1-approved one, so AC1-AC4 and
  the `numeric-tier-first` committed decision are untouched by construction, not by argument.
- **No other guard weakened.** The only test-file hunk is inside 2.6's body; guards 2.1-2.5 and 2.7
  appear nowhere in the diff. Verified by reading the full hunk, not just the stat.
- **Original permutation-invariance property preserved, not replaced** (your item 5). The guard still
  computes both `sortedA` (from `values`) and `sortedB` (from `permutation`) and now asserts **each**
  against the pinned `expected`. That is strictly stronger than the old `sortedA == sortedB`:
  cross-run equality still follows transitively, and the absolute ordering is now pinned too. It is
  not a single-run assertion — both runs are asserted (SortStepSpec.scala:171-172).
- **No trichotomy assertion introduced** (your item 6). `expected` is
  `Seq(9, "9", 10, "n/a", "zzz", null).map(equivClass)`. `equivClass(9)` and `equivClass("9")` both
  evaluate to `Right(Left(9.0))` — the two adjacent entries are the *same* class, so the guard makes
  no claim about their relative order and `9 ~ "9"` remains permitted. Confirmed by reading
  `equivClass` (SortStepSpec.scala:44-49) and by the actual failure output, which renders that pair as
  two identical `Right(Left(9.0))` elements. Design D4a (assert on classes, never raw values, for a
  fixture containing a cross-type equal pair) is satisfied.
- No migration; no scope creep; tasks/design unchanged and still describe implemented reality.

### Phase 2: Code Review — PASS

**Change Request 1 (cycle 1's sole blocker) — RESOLVED, verified by my own mutation runs.**

I re-applied each mutation myself against the current tree, ran the suite, recorded the named
failures, restored the source from a pre-mutation copy, and confirmed `git status --porcelain` clean
(no `backend/` entries) after each restore.

| Guard | Mutation A (all-or-nothing) | Mutation B (numeric-tier-last) | Mutation C (pre-fix per-pair) |
| --- | --- | --- | --- |
| 2.3 transitivity | pass | pass | **FAILED** |
| 2.4 repro fixture | **FAILED** | **FAILED** | pass |
| 2.5 desc + null | **FAILED** | **FAILED** | pass |
| **2.6 (strengthened)** | **FAILED** | **FAILED** | pass |
| 2.7 NaN/Infinity | pass | **FAILED** | **FAILED** |
| Suite totals | 6 passed / 3 failed | 5 passed / 4 failed | 7 passed / 2 failed |

- **Mutation B** (flipped the tier arms in `compareNonNullAsc`: `(Some(_),None) => 1`,
  `(None,Some(_)) => -1`): **2.6 is among the named failures** — 2.4, 2.5, 2.6, 2.7 all red.
- **Mutation A** (applied at the `sortWith` call site per design D6: pre-scan the key's column, and if
  any non-null value is non-coercible compare every pair by `toString`): **2.6 is among the named
  failures** — 2.4, 2.5, 2.6 red.

That is the whole point of this cycle and it holds: 2.6 now discriminates the shipped
`numeric-tier-first` ordering from both rejected alternatives. The AC5 / tasks 2.12 / design D6
"must be strengthened" rule is now *satisfied*, not waived.

**Mutation C — the executor's "2.6 legitimately still passes" claim is sound (your item 4).** I ran C
(restored the pre-fix `SortStep.scala` verbatim from `7ab38ad5`) and independently reproduce
2.6 green, 2.3 and 2.7 red. Judging it rather than accepting it: C's defect is *non-transitivity*
arising from values that coerce via `toDoubleOption` but are non-finite (`"NaN"`, `"Infinity"`) — a
value that compares neither before nor after its neighbours. 2.6's fixture
(`10, 9, "9", "n/a", null, "zzz"`) contains no such value, and for it the pre-fix relation happens to
coincide with the shipped one (`"9" < "n/a"`, `"10" < "n/a"` lexicographically, so numbers still land
first). A guard cannot fire on a defect its fixture cannot express, and the discrimination rule asks
each guard to fail under *at least one* mutation — which 2.6 now does, twice. The C-specific defect is
covered by 2.3 (the property guard, over a value set that *does* include `NaN`/`Double.NaN`/
`"Infinity"`) and 2.7 (the targeted fixture). This is the same accepted situation as 2.4 under C. Not
a gap.

**Gates — all re-run by me in the worktree at `987970e0`, not trusted from the executor's report:**

| Gate | Result |
| --- | --- |
| `sbt "testOnly com.helio.domain.steps.SortStepSpec"` (baseline) | **9/9 pass, 0 failed** — all 9 named tests listed |
| `sbt test` (full backend) | **3844 tests, 254 suites, 0 failed** |
| `npm run check:scala-quality` | clean (156 pre-existing soft warnings; grep confirms neither SortStep file is among them) |
| `npm run format:check` | clean |
| `npm run check:openspec` | clean ("complete but in flight") |
| `npm run check:spec-structure` | passed, 349 canonical specs, 0 issues |

No `frontend/**` changes → frontend gates not applicable.

**`mutation-evidence.md` (your item 7) — waiver prose is gone.** The old closing paragraph arguing
2.6 should be exempt has been removed. What replaces it is a cycle-2 header note that states plainly
what was wrong ("structurally incapable of discriminating between candidate orderings"), the coverage
table row for 2.6 now reads **fails / fails / pass**, and both the A and B sections carry the new
`*** FAILED ***` lines with the actual class-sequence diffs. I checked those recorded outputs against
my own runs: they match, including the line-number shift for 2.7 (148/154 unchanged, 2.7 moved
172→178 by the +6-line hunk). The only remaining "exempt" language covers 2.1/2.2, which is the
AC5-sanctioned exemption, not a self-granted one. This file is now corroborated evidence.

**Code quality (CONTRIBUTING):** the added lines are four statements plus a four-line comment
explaining *why* the pin exists (discrimination), which is the right thing to comment. No inline
fully-qualified names, no magic values (the fixture is named `expected` and derived from the same
`equivClass` helper the assertion uses, so it cannot drift from the tiering it encodes), no dead code,
no TODO/FIXME. `SortStepSpec.scala` is 181 lines — well inside budget. Behaviour-preserving as
expected: this commit is test-only and does not touch production behaviour.

Cycle-1's other findings were re-checked against the current tree and none regressed: `finiteNumeric`'s
load-bearing `.filter(_.isFinite)` is intact (SortStep.scala:95-96), `strictlyBefore` still drives the
real `SortStep.apply` rather than a model, and the nulls-last branch is unchanged.

### Phase 3: UI Review — N/A

No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**` changes (the spec delta
lives under `openspec/changes/`). Backend-only; dev servers not started, per the orchestrator's scope.

### Overall: PASS

The single cycle-1 blocker is fixed in the way requested, and the fix is measured rather than asserted:
guard 2.6 now fails under both mutation A and mutation B in my own runs, while keeping the original
permutation-invariance property and introducing no trichotomy claim. Every gate is green at
`987970e0`, and the evidence artifact now records accurate per-mutation results instead of a
self-granted carve-out.

### Non-blocking Suggestions

- Carried forward from cycle 1, still applicable and still not blocking: a one-line comment on
  `strictlyBefore`'s `x != y` naming what boxed-`Any` equality does for the `Double.NaN` element, and a
  comment on 2.1 distinguishing what `contain theSameElementsAs` actually measures from the
  irreflexivity property it is named for.
- `expected` in 2.6 is written as raw values mapped through `equivClass`, which reads well and keeps the
  D4a rule visible at the assertion site. If the tiering ever changes, note that this fixture will need
  updating in lockstep with `equivClass` — the comment above it already gestures at the tier order,
  which is enough.
