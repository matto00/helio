# Skeptic Report — design gate (round 6, skeptic-design-6.md)

Worktree: `/home/matt/Development/helio/.claude/worktrees/task/repackage-backend-domain-subpackages/HEL-633`
Base: `29fc0528`. Fresh cold instance, `gawk 5.4.1`. Every figure below is from a command I ran in this
worktree. I read `skeptic-design-{4,5}.md` only to know which claims to test; nothing here is taken from
them or from the artifacts' own assertions.

Per the orchestrator's brief I spent the round almost entirely on D6's patched filter and its new
self-check, and did not relitigate D0, the layer census, the mapping arithmetic, per-layer sequencing, or
round 4's nine non-blocking notes.

---

## What I verified (with evidence)

### 1. I extracted the awk from `design.md` mechanically and ran it — as the executor would

I did not retype it. I pulled the program body out of the fenced block with

```
awk '/^```awk$/{f=1;next} f&&/^```$/{exit} f{print}' design.md > filter.awk
```

which yields exactly five lines (`md5 35ccb98d408f3a9da73568da926ced17`), no `awk '` wrapper, no fence,
no CR, and runs cleanly as `awk -f filter.awk <file>`. `design.md:167-168` and `tasks.md:6` both now say
"program body, not wrapped in `awk '…'`" — round 5's NN-1 is closed, and the mechanical extraction
confirms the block in the document is directly usable.

Ran over all **540** `.scala` files under `backend/src`:

| D6's pre-adoption claim | My measurement | |
|---|---|---|
| 0 residual `import` lines | **0** | ✓ |
| `api/package.scala` 381 → **380** kept | 381 → **380** | ✓ |
| `domain/package.scala` 115 → **114** kept | 115 → **114** | ✓ |
| `domain/panels/package.scala` 33 → **31** kept | 33 → **31** | ✓ |
| multi-line braced imports still swallowed | 0 residual, 0 leftover continuation lines | ✓ |
| **5,649** lines masked | **5,649** (see note below) | ✓ |
| 0 files differing from an independent parser | **0** (my parser — third independent one) | ✓ |

Note on 5,649: a naive `wc -l` accounting gives 5,647, because exactly **2** files in the tree have no
trailing newline (`api/routes/HealthRoutes.scala`, `test/.../InProcessPipelineEngineSpec.scala`) and
`wc -l` undercounts each by one. Counted as records (`awk 'END{print NR}'`), the removed total is
**5,649** — the design's figure is exact. There are **0** CRLF files and **0** empty files. This matters
for `tasks.md`'s check (ii) — see NN-1.

All three `package object X {` header lines survive as code (they are the only 3 lines in the tree
starting with `package` that the anchored rule does not match), and every one of the **540** package
clauses — exactly one per file, corroborating D0 — is removed.

### 2. Two-sided verification against a *genuinely* independent parser (not a re-encoding)

Round 5's core diagnosis was that the previous cross-check "re-encoded the same trigger regex and brace
rule, so both agreed perfectly on the same specification error." So I did not write another regex.

I wrote a character-level Scala lexer that tracks nested `/* */`, `//`, `"…"` with escapes, `"""…"""`,
char literals and backtick identifiers; blanks out comment/string *content* while preserving line
positions; then locates statement-initial `import`/`package` tokens in the remaining code and computes
each statement's true line extent by brace/newline tracking. It explicitly treats `package object X` as
**not** a package clause, and it would report a braced `package … { }` block if one existed. It derives
statement membership by parsing, not by matching `^[[:space:]]*import[[:space:]]`.

For every file I diffed the filter's actual deletions against that parser's statement-line set:

```
FILES: 540
OVER-CONSUMPTION  (filter removed a line NOT part of a package/import statement): 0 files
UNDER-CONSUMPTION (a package/import statement line survived):                     0 files
LEXER NOTES (braced package blocks / odd package clauses):                        0
```

Re-run once for stability: identical. Tree-wide statement-line total from the parser: **5,649** — the
same number the filter removes, independently derived.

**Proof my checker is not a re-encoding (this is the part round 5 said was missing).** I ran round 5's
*defective* filter through the identical harness:

```
OVER-CONSUMPTION files: 3
  api/package.scala          lines 8-… (the package-object body)
  domain/package.scala       lines 8-…
  domain/panels/package.scala lines 9-19
```

It pinpoints the round-5 bug exactly, on the right three files, at the right line ranges. A checker that
shared the filter's specification error could not do that. So the "0 over / 0 under" result above is a
real cross-validation, not two implementations agreeing on one wrong spec.

### 3. Can the corrected filter still fail toward PASS? I hunted for the constructs

Enumerated over the real tree:

- Lines matching the `import` trigger that are **not** real imports (inside a string/comment): **0**.
  (4,359 import-trigger lines, all genuine.)
- Import lines carrying a trailing `//` comment: **1**; of those with an unbalanced `{`: **0**.
- Import-trigger lines with `{` and no `}` (i.e. skip-mode openers): **59** = **41 main / 18 test**,
  exactly D7(a)'s figure; every one is a genuine multi-line braced import.
- Lines matching the anchored `package` rule: **540**, one per file. Lines starting with `package` that
  the rule does **not** match: **3**, all `package object X {`, all correctly kept.
- `import` as an identifier prefix: `importantValue = 1`, `import_foo()`, `importer.run()` all survive
  the filter (the trigger requires whitespace after `import`). Verified directly.

I then built a synthetic stress corpus of ten constructs an executor could plausibly write, and found
**four** residual over-consumption vectors and one (safe-direction) under-consumption vector:

| construct | behaviour | direction |
|---|---|---|
| import line with a trailing `//` comment containing an unbalanced `{` | eats 1 following code line | **toward PASS** |
| an `import …{` line inside a `/* … */` block comment | eats the comment + following code to next `}` | **toward PASS** |
| import-shaped lines inside a `"""…"""` string | eats them + onward to next `}` | **toward PASS** |
| a bare `package com.foo` line inside a `"""…"""` string | drops that line | **toward PASS** |
| a `//` comment containing `}` inside a multi-line import | ends skip early, leaves residue | toward FAIL (safe) |

**None of these five occurs anywhere in the tree** (that is what the 0/0 result in §2 means), and every
one of the four dangerous ones requires the executor to *add* import- or package-shaped text inside a
comment or string — i.e. a body edit that the iron constraint and D6 both forbid outright. This is a
residual inherent to any regex line filter, not a defect in this one, and it is not what round 4 or
round 5 found: those fired on the actual unmodified tree, on files the plan mandates hand-editing. See
NN-2 for a one-command hardening that closes the class anyway.

### 4. Forward simulation — the filter against post-rewrite content, including the hand-edited files

Base-tree cleanliness is not enough; the gate runs on what the executor writes. I simulated it.

**The four files `tasks.md` sends the executor in to hand-edit:**

| file | simulated edit | result |
|---|---|---|
| `domain/panels/package.scala` | add the mandated `DataTypeId`/`MetricId` import (single-line form) | gate **silent** ✓ |
| " | same, as a multi-line braced import | gate **silent** ✓ |
| " | **negative control** — perturb the live `JsonFormat[DataTypeId]` body (`deserializationError` → `deserializationErrorX`) | gate **FIRES** ✓ |
| `api/JsonProtocols.scala` | expand line-3 `protocols._` into 3 statements incl. a multi-line braced one | gate **silent** ✓ |
| `api/ApiRoutes.scala` | fan out line-12 `routes._` into multi-line braced subpackage imports | gate **silent** ✓ |
| " | **negative control** — swap two `pathPrefix("auth"){…}` route mounts (lines 502/512) | gate **FIRES** ✓ |
| `api/package.scala` | rewrite all **466** `protocols.X` → `protocols.<domain>.X`, then D6's `sed -E 's/protocols\.[a-z]+\./protocols./g'` | round-trip **byte-clean** vs base ✓ |
| " | **negative control** — sneak a type-alias rename alongside the rewrite | sed check **FIRES** ✓ |

The exact hole round 5 opened — a live JSON format inside a package object that the gate could not see —
is closed and I demonstrated it closed in both directions on the real file.

`api/package.scala` facts I re-measured for the allow-list check: 381 lines, **0** import lines (so the
raw-byte sed comparison is valid), 466 `protocols.` occurrences, **0** pre-existing `protocols.[a-z]`
(so the sed cannot spuriously collapse anything), 156 `type` / 155 `val`. All 13 domain names are
`[a-z]+`, so the sed's character class covers every segment the change can insert.

**Bulk simulation.** I generated 64 simulated post-move files from real sources — chosen to over-weight
the hard cases (multi-line braced imports, `com.helio.*._` wildcards, indented scope-local imports) —
applying a realistic transformation: rewrite the package clause to a domain subpackage, fan wildcards out
into multi-line braced imports, re-split existing braced imports across two new subpackages, and insert
brand-new `ServiceError`/`ServiceResponse` imports. Two-sided check on the *post-rewrite* corpus:

```
FILES: 64   OVER-CONSUMPTION: 0   UNDER-CONSUMPTION: 0
```

The filter handles post-rewrite content as correctly as base content.

### 5. Is `tasks.md`'s new two-sided self-check sufficient?

`tasks.md:7-8`:

> (i) 0 residual `import` lines remain, **AND** (ii) for every file, `wc -l` minus kept-lines equals
> exactly the number of lines belonging to a `package`/`import` statement, so it removes nothing else
> — Assert (ii) explicitly on the three package objects: `api/package.scala` 381→380 kept,
> `domain/package.scala` 115→114, `domain/panels/package.scala` 33→31. If any body is missing, STOP.

**Would it have caught round 5?** Yes, decisively. Under the round-5 filter, `domain/package.scala` is
115 raw → 6 kept, i.e. 109 removed, against 1 true statement line — a mismatch of 108. Even the crudest
implementation of the counting side (count lines matching a package/import regex) yields 2, not 109,
because counting-matching-lines is a structurally different computation from a stateful brace-swallowing
filter. Check (ii) is a conservation law, and over-consumption breaks conservation.

**Is the check itself defeatable by a shared spec error?** Only partially, and the plan already plugs the
gap that matters. Check (ii) as phrased does not say *how* to compute "lines belonging to a
package/import statement", so a lazy executor could in principle re-encode the filter's own rules. But
the follow-up sentence pins **three literal expected values** — 380 / 114 / 31 — which I verified from
ground truth are exactly right. Those are specification-free assertions: they cannot be satisfied by any
filter that eats a package-object body, no matter what spec the executor's counter shares. And the three
files named are precisely and exhaustively the tree's package objects, i.e. the entire round-5 hazard
class (only 3 lines in 540 files start with `package` and are not package clauses).

**Would it catch a subtler over-consumption?** Multi-line over-consumption: yes, via conservation —
a matching-line counter can never attribute swallowed body lines to a statement, so the arithmetic
diverges. Single-line over-consumption via the `package` rule: only if the counting side is written
differently from the filter — but the anchored `package` rule can only mis-fire on a line that literally
reads `package <qualid>` in a comment or string, of which there are **0** in the tree. I judge the check
sufficient for its purpose.

### 6. Ground-truth spot checks (not relitigation — cheap confirmations from a cold start)

`540` `.scala` files (`322` main / `218` test); `41 main / 18 test` multi-line braced import openers;
`540` single-clause package declarations; `3` package objects at 381 / 115 / 33 lines; `0` braced
`package … { }` blocks. All match the artifacts.

Running the full D6 gate over the whole tree costs **0.69 s** wall-clock (540 `awk` invocations) — which
matters for NN-3.

---

## Verdict: CONFIRM

The single defect this round existed to test is genuinely fixed, and I established that with a checker
that provably disagrees with the old filter's specification rather than one that re-encodes it. D6's
seven pre-adoption claims all reproduce to the unit. The three files whose bodies were blinded in round 5
are back under the gate, verified in both directions on the real files. The mandated hand-edits to all
four non-mover files pass the gate when correct and fail it when perturbed — including a route mount-order
swap in `ApiRoutes.scala`, which is the specific hazard D6 was built to subsume. The new two-sided
self-check would have caught round 5 outright, and its three hardcoded per-file assertions make it immune
to the shared-specification failure that let round 5's bug through review.

The residual over-consumption vectors I found are real but all require the executor to insert
import- or package-shaped text into a comment or string literal — a body edit the change forbids outright
and which does not occur anywhere in the current tree. That is a property of regex line-filtering in
general, not a defect in this plan, and it does not meet the bar (it is neither a behaviour change that
ships from executing the plan *as written*, nor an unreviewable result, nor a decision the executor is
left to guess at). Everything I would otherwise raise is cheap, non-blocking hardening, below.

---

## Greatest remaining EXECUTION risk (brief the executor on this)

**The D6 primary gate is all-or-nothing and `tasks.md` schedules it only at the very end.** It sits in the
"Tests" section, after all seven layers, next to "a second difference fails the change." If it fires 250+
file-moves deep — and the most likely benign trigger is a **blank line** added or removed around an
import block, which the filter faithfully preserves and reports as a difference — the executor faces a
binary gate with the whole change already built, and the single strongest temptation in this change is to
widen the allow-list or loosen the filter. D6 forbids exactly that, in those words, and rounds 4 and 5
both prove the safety net is where defects hide.

Mitigation to brief: **run the D6 gate at the end of every layer, not just at the end.** It costs 0.69 s
over the entire 540-file tree — measured — so there is no reason not to. A difference then surfaces
inside the layer that caused it, while the fix is one file and one blank line, instead of surfacing once
as an opaque N-file failure with no local cause.

Two concrete blank-line cases to name in the brief: (a) fanning out a wildcard must not add or remove
blank separators inside the existing import block (`tasks.md:9` already says this); (b) the handful of
files with **zero** imports today that gain their first one — the whole tree has 12 such movers, of which
by my measurement only `domain/ConnectorRegistry.scala` and `domain/PipelineSchemaDrift.scala` can
possibly need an insertion — must place it adjacent to the package clause **without** adding a blank
separator line, or D6 fires on a correct edit. Both are safe-direction (loud) failures; the risk is the
executor's reaction to them, not the failures themselves.

---

## Non-blocking notes

**NN-1 — `tasks.md`'s check (ii) will raise exactly two false alarms if implemented with `wc -l`.**
Two files have no trailing newline, so `wc -l` undercounts them by one and check (ii) reports a mismatch
of **−1** on each:

```
api/routes/HealthRoutes.scala                 wc -l=14   kept=11   (14−11)=3  vs true 4   → −1
test/.../InProcessPipelineEngineSpec.scala    wc -l=2278 kept=2262 (16)       vs true 17  → −1
```

`tasks.md` says "If any body is missing, STOP", so this could trigger an unnecessary halt on the very
first task. The one-word fix: count with `awk 'END{print NR}'` (records) rather than `wc -l` (newlines).
Verified: that yields 15 and 2279, and both files then reconcile exactly (4 and 17). Neither file is a
package object, so the three hardcoded assertions are unaffected.

**NN-2 — run the two-sided self-check against the *worktree* tree at gate time, not only the base tree.**
The self-check tasks sit under "capture BEFORE any move", so they only ever certify the filter against
base content. That is the right place for them, but re-running the same check over the post-rewrite tree
costs one command and closes the entire residual over-consumption class in §3 — every one of those
vectors requires *newly written* text, which a baseline-only check cannot see by construction. Cheap,
strictly additive.

**NN-3 — run the D6 gate per layer.** See "greatest remaining execution risk" above; folded here so it
lands in `tasks.md`'s per-layer loop next to `sbt Test/compile`, rather than only in the Tests section.

**NN-4 — nothing asserts that a moved file's `package` declaration agrees with its new directory.**
This is the one correctness dimension in the change with **no** gate at all. D6 masks `package` lines by
construction, so it cannot see a mismatch; and the compiler cannot either, because every consumer imports
the FQN from `mapping.tsv`'s *new FQN* column — so a row whose new-path and new-FQN columns disagree
compiles green, tests green, and passes D6, while landing the file in a package that contradicts its path.
That defeats the ticket's stated purpose (one grep on a domain name surfaces its whole stack) silently.
`tasks.md` asserts per-root coverage, target-name validity, and `grep -c '^package '` == 1, but never
path↔declaration agreement. One line closes it, e.g.: for every `.scala` under `backend/src/main`, the
sole `package` clause must equal `com.helio.` + the path segments below `com/helio/` with `/` → `.`
(excluding the filename) — with the three package objects and any deliberate exception enumerated. I rate
this the second-most-important thing to brief after the gate cadence; it is not blocking because
`mapping.tsv` supplies both columns and the derivation is mechanical, so the executor is not being asked
to guess.

**NN-5 — `design.md`'s "5,649 lines masked" is right, but only under record-counting.** Worth a
parenthetical in D6 so the executor who reproduces it with `wc -l` and gets 5,647 does not go looking for
a filter bug that is not there. Same root cause as NN-1.

**Credit.** The patched filter is correct, and the way it was corrected is right: the `package` rule was
anchored to end-of-line rather than the trigger being loosened, which is the only fix that keeps the
brace-swallow behaviour that D7(a)'s 59 multi-line imports actually need. D6's decision to record *how*
the previous round's verification passed a check it should have failed — and to convert that into a
two-sided invariant with three literal expected values — is the reason I could close this out in one
round instead of finding a fourth variant of the same bug.
