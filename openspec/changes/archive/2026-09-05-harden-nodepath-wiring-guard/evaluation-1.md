# Evaluation Report — Cycle 1 (evaluation-1.md)

## Phase 1: Spec Review — PASS

Issues: none.

- **Zero product diff (AC3): verified independently.** `git diff abcf0da9..HEAD --name-only`
  returns exactly `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` plus ten
  `openspec/changes/harden-nodepath-wiring-guard/` artifacts. An explicit exclusion diff
  (`git diff abcf0da9..HEAD -- . ':!<test file>' ':!openspec' --stat`) returns empty, and
  `git status --porcelain` is clean — no temporary product-code mutation was left behind and no
  untracked mutation scratch file survives.
- **AC1 (guard no longer depends on ambient DOM):** `titleFor()` now scopes `closest` to
  `.pipeline-detail-page__step-section, .pipeline-detail-page__tail-chain-step` and reads `title`
  only after an explicit `hasAttribute("title")` check, with two distinct throw messages
  (`No step wrapper for ...` vs `Step wrapper for ... has no title attribute`). Both render sites
  are covered, and the proposal correctly records why `sectionFor()` is not reusable.
- **AC5 (six HEL-985 assertions unchanged):** diffed the `toBe(...)` expected strings between
  `abcf0da9` and `HEAD` — all six are byte-identical (`root:root-1 > r1a`, `... > r1b > r1c`,
  `... > r1b > lane1a`, `... > r1c > laneA`, the multi-line nested-lane one, `root:root-2 > r2a`).
  The diff hunk over that region (`@@ -673,4 +693,92 @@`) is pure addition; nothing in the
  pre-existing block was touched.
- **AC "fixture indistinguishability":** no fixture change at all — `wiringProps()` is untouched by
  the diff, so no new step was added without a `rootId`-bearing root head. The existing `rootId`
  values keep the correct output (`root:root-1 > r1a`) distinct from the value-mismatch output
  (`r1a`), and run (c)'s transcript shows exactly that pair. The D4b synthetic fixtures introduce
  no such state either: they assert on a *throw*, not on a string, so no correct/mutated
  observation can coincide.
- All 15 task items are marked done and each corresponds to something actually present in the diff
  or the evidence file. No scope creep: the change is confined to `titleFor()` and four appended
  tests. Non-goals (no `data-testid`, no `sectionFor()` refactor, no new render sites) are honored.
- `.openspec.yaml` sets `skip_specs: true`, correct for a test-harness-only change with no
  capability delta. No API contract or schema is affected.

## Phase 2: Code Review — PASS

**Gates re-run independently by me** (not trusting the executor's report), in
`WORKTREE_PATH/frontend`. `CLEAN_WORKTREE` was not set, so gates ran directly in the worktree.
Backend gates are not applicable (no `backend/**` file changed) and were additionally forbidden by
the hard environment constraint.

| Gate | Command | Result |
| --- | --- | --- |
| Targeted tests | `npm test -- --testPathPatterns=PipelineRiverView` | **34 passed / 34 total**, 1 suite passed |
| Lint | `npm run lint` (`eslint src --max-warnings=0`) | clean, no output |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | clean, no output |
| Format | `npm run format:check` | "All matched files use Prettier code style!" |

Note on the flag: the assigned command `--testPathPattern` (singular) now **errors** in this repo's
jest — `Option "testPathPattern" was replaced by "--testPathPatterns"`. I reproduced that error
myself and then ran the plural form. This independently corroborates the executor's stated
substitution in `mutation-evidence.md`; it is a jest CLI rename, not a dodge.

**Mutation evidence (focus area 2) — all five/six runs present, each named, each with a verbatim
observation rather than a narrated claim:**

- **(a0-i) pure vacuous green** — pre-change helper + call-site deletion + ancestor `title` set to
  the step's *exact* expected path (`root:root-1 > r1a > r1b > lane1a` on
  `.pipeline-detail-page__tail-chain`). Recorded as PASSED, with the probe's source inlined and the
  scope of the claim explicitly bounded to that one assertion ("the other five are expected red and
  are explicitly not part of this claim"). This is the honest form of the claim.
- **(a0-ii) axis collapse** — same helper/deletion, arbitrary tooltip; verbatim
  `Expected: "root:root-1 > r1a > r1b > lane1a" / Received: "ancestor tooltip"`, correctly
  characterized as the *same* string-mismatch shape as run (c). Same explicit scoping of which
  assertion is under discussion.
- **(a) baseline green** — 34/34, which I reproduced exactly.
- **(b) ancestor-title + deletion** — 8 failed / 26 passed, verbatim
  `Step wrapper for "Trunk one" has no title attribute` — a genuine **absent-attribute** message,
  not a value mismatch. Revert confirmed via `git checkout --` plus a `git diff --stat` check.
- **(c) value-mismatch** — 8 failed / 26 passed, verbatim `Object.is` failure
  `Expected: "root:root-1 > r1a" / Received: "r1a"` — a genuine **string-mismatch** message.
- **(d) restored green** — 34/34 with a clean product diff, which I re-verified myself.

(b) and (c) therefore fail with **genuinely different messages**, which is the independence property
the ticket asks for. See the non-blocking note below on "different assertions".

**D4a-vs-D4b separation (focus area 3) — correctly handled, not conflated.** The D4a tests are
labelled in the file's own comment as "GUARD, not the proof … Green on the pre-change helper too …
it does not by itself demonstrate the hardening was necessary. See D4b below for the falsifiable
half." D4b is labelled "the actual proof" and explains precisely why it is the only configuration
where the two helpers diverge. This matches design.md D5 and tasks 1.7/1.7a/1.7b. I confirmed the
D4b proof is genuinely red on the pre-change helper by construction: on a title-less
`.pipeline-detail-page__step-section` nested inside a titled `div`, `closest("[title]")` walks past
the wrapper and returns `"outer tooltip"` without throwing, so `expect(...).toThrow(...)` must fail.
The D4a vacuity risk is closed as designed: each test asserts `ancestor.contains(resolved)` and
`ancestor !== resolved` (strict ancestor, not the wrapper and not a descendant) plus a title-string
inequality against the injected value.

Code-quality checks:

- **CONTRIBUTING.md compliance** — no inlined fully-qualified names; no new imports; file-size
  budget unaffected in kind (test file, +122 lines). No `[mechanical]` violations found.
- **DESIGN.md** — not applicable: no component, style, token, or rendered markup changed. Zero
  product diff means there is no design surface.
- **DRY / readability** — the scoped selector string is repeated in the two D4a tests alongside its
  use in `titleFor()`. This is deliberate and correct: the tests must resolve the wrapper
  *independently* of the helper under test, so extracting a shared constant would couple the guard
  to the thing it guards.
- **Type safety** — the `as HTMLElement` casts are standard RTL/DOM narrowing and are immediately
  followed by `expect(...).not.toBeNull()` or a `contains` assertion; no `any`, no `@ts-ignore`.
- **Error handling / test hygiene** — every DOM mutation is undone in a `finally`
  (`removeAttribute`, `removeChild`), and the comment explains why (`RTL auto-cleanup only unmounts
  React trees, not manually appended DOM`). The D4b labels are strings absent from the fixture, so
  they cannot collide with other by-text queries.
- **No dead code, no TODO/FIXME, no over-engineering.** The stale HEL-985 "D3" doc comment was
  replaced rather than left alongside the new one, as task 1.4 required.
- **Behavior-preserving** — trivially: zero product diff, verified twice above.

## Phase 3: UI Review — N/A

Not run, by explicit orchestrator direction and because there is nothing to review. The hard
environment constraint (HEL-974 holds the dev PostgreSQL exclusively for an RLS migration) forbids
starting the frontend or backend dev server, opening a database connection, and using
Playwright/e2e. Independently, this change has a **verified zero product diff** — it renders
nothing new and alters no component, so the `frontend/**` trigger matches only a test file and
there is no observable UI surface. No server was started, no database connection was opened, and
Playwright was not invoked at any point during this evaluation.

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

- **"Different messages on different assertions."** The brief's focus area 2 asked for (b) and (c)
  to fail "with genuinely different messages on different assertions". What was delivered is
  different *messages* on the *same* eight assertions (the six HEL-985 value assertions plus the two
  D4a guards). This is not a gap: design.md D5 and task 1.11 explicitly *predicted* that set
  ("D4b green in both; D4a and the six HEL-985 value assertions red in both"), and the evidence
  matches the prediction rather than being reshaped to fit a looser phrasing. The independence the
  ticket actually requires — each form failable without relying on the other — is established by
  the distinct message shapes plus D4b staying green under both product mutations. Worth
  recording only so a later reader does not mistake the wording difference for an unexamined one.
- `titleFor()`'s final line keeps `?? ""` after the `hasAttribute("title")` guard, so the fallback
  is now unreachable. It is required by `getAttribute`'s `string | null` return type, but a short
  trailing comment (or a non-null assertion) would make the unreachability self-evident rather than
  reading as a third, silent failure mode.
- `mutation-evidence.md`'s header explains the `--testPathPattern` → `--testPathPatterns` rename
  well. Consider mirroring that one-line note into the ticket's "Verification is limited to" list
  the next time a ticket hard-codes the old flag, so the next executor does not have to rediscover
  the error.
