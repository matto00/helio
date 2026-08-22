# Retrospective — what five design-gate rounds actually found

Written at Phase 4, after PR #417 merged as `06cdc1b8`. Recorded here rather than folded into
`design.md`, which is left as the historical record of what was decided.

## The headline finding

For a change of this shape, the dominant failure mode of the verification gate was **failing on
correct work**, not passing on broken work. That inverts the intuition the gate was designed
around, and it is the single most transferable lesson from this ticket.

**Gate rejects correct work (8 distinct instances):**

| Round | Instance |
| --- | --- |
| 2 | Byte-identity false-failed on 5 lines: prettier legitimately re-wraps specifiers that cross `printWidth: 100`, so tasks 6.4 and 7.5 directly contradicted each other |
| 2 | The substitution-site check rejected 23 legitimate sites (wrapped-import closers, `jest.requireActual`) |
| 3 | Task 5.3 edits `docs/compute-expression-grammar.md`, which task 6.4 was guaranteed to fail on — the citation is backticked and repo-root-relative, so the normalizer cannot touch it |
| 3 | A hard-pinned `BASE` drags every unrelated `main` commit into the change set at task 7.6's re-run |
| 4 | The committed checker tripped **its own** `A` allow-list |
| 4 | The baseline path set and counts stayed pinned while `BASE` was un-pinned — half a fix |
| 5 | Non-extension-aware specifier resolution: ~1030 of ~1073 specifiers are extensionless, so a naive implementation throws hundreds of false mismatches |
| Delivery | `openspec archive` relocates the very artifacts the status allow-list pins — 16 spurious `A` failures while all six substantive checks still passed |

**Gate accepts broken work (5 instances):**

| Round | Instance |
| --- | --- |
| 1 | The line-stripping filter over-consumed, swallowing 4 real content lines (`import("react").ReactNode`; `renamed from "Test connection"` comments) |
| 1 | The content check covered only renamed files, leaving 15 in-place-modified files (78 lines) unguarded |
| 3 | Prettier exits non-zero with **empty stdout** on invalid input; a checker that swallows the error compares `"" == ""` and reports IDENTICAL |
| 4 | Two assertions had no red case, so a tautological baseline would pass forever and re-running it would prove nothing |
| Execution | The path-set check used index-based `git ls-files`, blind to an unstaged working-tree deletion — a real bug, found only because red case (e) existed |

## Why "fails on correct work" is not the safe direction

It is tempting to treat a false failure as harmless — the gate is merely too strict. It is not
harmless. Every instance above would have landed on an executor who knew their work was correct,
and the cheapest way out of a wall of spurious failures is to loosen the check. Round 3 said this
explicitly: the likely response to 16 unrelated failures is to narrow the change set back to the
three `ui/` directories, **which reopens exactly the hole the whole-tree assertion was added to
close**. A gate that cries wolf gets disarmed, and then it is a gate that passes broken work.

So a verification mechanism needs adversarial review in *both* directions. Testing only "does it
catch corruption" is half a review.

## Fix-induced regressions, and why cold spawns paid for themselves

**Three times, a fix introduced the next round's blocker:**

- Round 2's fix (pin `BASE`) created round 3's CR1 (pinned base is wrong once `main` advances).
- Round 3's fix (commit the checker) created round 4's CR1 (the checker trips its own allow-list).
- Round 3's fix (un-pin `BASE`) was incomplete, creating round 4's CR3 (the baseline it compares
  against was still pinned).

Each was found by a *fresh cold* skeptic. A warm reviewer would have carried forward the same
mental model that produced the fix, and these are precisely the defects that model cannot see.
The per-round cost of a cold spawn bought exactly this.

## Two notes on verifying the verifier

**A test can pass for the wrong reason.** The first attempt to validate normalize-and-compare
reported IDENTICAL — but only because it simulated the moved line *un-wrapped*, so it never
exercised the prettier re-wrap that was the entire point. Re-running it against real prettier
output showed the normalize-only approach false-failing. A green result from a test you just wrote
deserves the same suspicion as a green result from the code under test.

**Red-before-green found a bug in the checker itself.** Case (e) failed on its first run, exposing
the `git ls-files` index-blindness above. Without that case, a guard that could not fail on the
case it was written for would have shipped.

## What ultimately made the content check sound

Normalizing rather than stripping. Substituting every quoted relative literal with a fixed-length,
syntactically valid token on **both** sides and comparing byte-for-byte means nothing is ever
deleted from either side, so over-consumption is **structurally impossible** rather than merely
tested-for. Preferring a structural guarantee over a tested behaviour is what ended the loop.

## One limit worth stating plainly

The gate proves the moves were **faithful**, not that they were **correct**. A file relocated into
the wrong subdirectory passes all six assertions. That is why the final gate enumerated all six
subdirectories and both roots member-for-member instead of leaning on the green checker.
