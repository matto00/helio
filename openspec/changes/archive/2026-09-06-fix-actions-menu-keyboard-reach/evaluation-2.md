## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `162eb1dc`, on top of `574b7774`. Focused re-evaluation of
cycle-1 CR1; cycle-1's measurements of the fix itself re-confirmed cheaply rather
than re-derived. Every arm below is my own run, not the executor's report.

### Action item for the orchestrator (not a change request)

`openspec/changes/fix-actions-menu-keyboard-reach/proposal.md` is **staged but
uncommitted** (`git status --short` → `M ` in the index). The tree is therefore not
clean, and `git diff main...HEAD` — the review surface — does not contain it. I read
the staged diff: it is a 23-line addition documenting the two-keyboard-test split and
the measured red/green arms, and **every factual claim in it matches what I measured
below** (including the `:focus-within` mechanism and the `{"isTrigger":false,
"isBody":true,"tag":"BODY"}` sentinel). It needs committing before the PR, or it is
silently lost. Not blocking, because the content is correct and it is already staged.

### Scope re-check — intact

- `git diff 574b7774 162eb1dc --name-only` → only the e2e spec, `evaluation-1.md`,
  `files-modified.md`. **`git diff 574b7774 162eb1dc -- frontend/` is 0 lines** — the
  CSS was genuinely not touched this cycle, so cycle-1's fix measurements stand.
- `MobileNavSheet.tsx`: zero commits touching it on this branch.
- Migrations: 102 files, none added by this branch (`git diff --name-only main...HEAD`
  matches no migration path). Still agree none is warranted.
- Rig re-verified serving the fixed CSS (`clip: auto` present via vite) before and
  after every arm.

### CR1 verification — the two-arm claim, measured

Guard as shipped, green arm: **4/4 pass**.

| arm (CSS state) | test 2 (programmatic focus) | test 4 (real Tab walk) |
|---|---|---|
| shipped fix | PASS | PASS |
| **reverted** to `574b7774~1` (`display: none`) | **RED** — `{"isTrigger":false,"isBody":true,"tag":"BODY","className":""}` | **GREEN** |
| reverted **and** `:focus-within` removed from the reveal rule | RED (same sentinel) | **RED** — `Error: trigger not reached by Tab within 40 presses` / `Expected: true, Received: false` |

This settles all four things the cycle asked about:

1. **Test 4 is genuinely green in the reverted arm.** It is a legitimate
   non-discriminating no-regression check, not a second label on test 2's axis. The
   title and comment now match the instrument.
2. **Test 2 is still red in the reverted arm**, with the exact D4 sentinel — the
   discriminating guard is unweakened by this cycle's edit.
3. **The bounded Tab loop can report its negative.** Row 3 above is that negative,
   produced against a real state, with the intended message. It is not vacuous by
   construction either: the loop presses `Tab` *before* each check and starts from the
   "Filter dashboards by name" input, so the break condition is false at entry
   (`spec.ts:174-180`).
4. **The comment's causal claim is accurate.** Row 3 is the negative control for it:
   deleting *only* the `:focus-within` selector from the reveal rule
   (`DashboardList.css:244`) is exactly what turns test 4 red, so "`:focus-within`
   already reveals the wrapper once the row button ahead of it in tab order has
   focus" is the real mechanism, not a plausible-sounding guess.

The rewritten test also closes the AC-2 coverage gap CR1 named: it now asserts
Enter → focus on `Rename`, ArrowDown → `Duplicate`, Escape → back to the trigger
(`spec.ts:182-190`), matching what I measured live in cycle 1. The bounded loop
(max 40) rather than a hardcoded index is the right call and is commented as such.

### Phase 1: Spec Review — PASS

CR1 resolved. AC 2 now has a real Tab/arrow-key guard; AC 1/3/3a/4/5 unchanged and
re-confirmed by the arms above (test 3 still passes on the shipped fix and, per
cycle 1, is the only thing that fails under both paint-trap mutations). AC 6
untouched this cycle. `files-modified.md` corrected — its "non-discriminating keyboard
no-regression check" sentence now says "driven by real `Tab` keypresses" and carries
the arm record; that record matches my measurements.

### Phase 2: Code Review — PASS

Gates, re-run by me in `WORKTREE_PATH` at `162eb1dc`:

| gate | result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0, "All matched files use Prettier code style!" |
| `npm test` | exit 0 — 261 suites / 2676 tests passed |
| `npm --prefix frontend run build` | exit 0 |

No `backend/**` change → `sbt test` N/A.

The spec diff is small, readable and typed; the loop bound is a named constant with a
stated reason; the failure message is informative (`expect(reached, "trigger not
reached by Tab within 40 presses")` — I saw it fire). No dead code, no TODOs. The
comment now states what was measured and cites where the measurement is recorded,
which is the standard this ticket exists to enforce.

### Phase 3: UI Review — N/A

No UI-affecting file changed this cycle (`frontend/` diff is empty; the only source
change is an `e2e/` spec). Cycle 1's full Phase-3 pass against the unchanged CSS
stands.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- Commit the staged `proposal.md` (see the action item above).
- Carried forward from cycle 1, still open and still non-blocking: `tasks.md` 6.1/6.2
  ask for jsdom-triage reasoning "per instance, not blanket", while what shipped is one
  blanket note per file. The rationale is uniform and mutation-verified correct, so
  AC 6's letter is met; either the annotations or the task text should be reconciled.

### Environment / cleanup

- CSS reverted twice for the arms and restored via `git checkout --` both times;
  `git diff HEAD` for `frontend/` is empty and the vite-served bytes match the
  committed fix.
- Deleted every `hel1003-%` account (and its dashboards) created by this cycle's guard
  runs from the shared dev database. No other rows touched. No test data of mine
  remains.
- The only working-tree entry left is the staged `proposal.md` I did not create and
  deliberately did not touch, plus this report.
