## Evaluation Report — Cycle 1 (evaluation-1.md)

Scope judged against `ticket.md`'s 14 restated acceptance criteria (product-owner
approved premise correction), not the original Linear text.

### Phase 1: Spec Review — FAIL

Verified PASS:

- **AC 1 (anti-goal)** — all three exclusion layers intact and verified in the tree:
  `playwright.config.ts` `testIgnore` still lists `"**/*.regression.spec.ts"` (first
  entry, expanded comment); the spec still carries
  `test.skip(!process.env.HEL813_REGRESSION, ...)` at line 29; `playwright.regression.config.ts`
  is unchanged and still the only config clearing `testIgnore`. `ci.yml` does not name
  the regression spec.
- **AC 2 / AC 14** — the stale HEL-813-era comment at `ci.yml` 199-205 was **replaced**,
  not appended to (diff shows the whole 7-line block removed and a new block added).
  The new comment records the glob, the investigation pointer, the deliberate
  `*.regression.spec.ts` exclusion, the on-disk-source-mutation reason, and points at
  `e2e/README.md`.
- **AC 3 / AC 12 (D5 P1-P4)** — verified independently against source, not the report:
  - P1: `.mobile-nav-sheet__item` is measured by `sweepSurface` in
    `e2e/hel813-mobile-touch-target-floor.spec.ts:118-122` (surface 1), and `WIDTHS = [430, 768]`
    (line 24), so it is measured at 430px. It is `sweepSurface`, not `assertExpanderFloor`
    (which covers the sibling `.mobile-nav-sheet__create-action`) and not `assertHiddenAtWidth`.
  - P2: baseline measured 404x44 at 430px, recorded in `caseb-search-and-mutation-proof.md`
    and reproduced in the harness's own `[Case B][baseline PASS]` log line.
  - P3: `MobileNavSheet.css:192-210` declares `width: 100%` (container-driven, not a floor)
    and `min-height: var(--control-lg)`; the mobile block at line 293 adds the literal
    `min-height: 44px`. No `width`/`min-width` floor anywhere on the selector.
  - P4: the mobile rule is `@media (max-width: 768px) { .mobile-nav-sheet__item { min-height: 44px; } }`
    — **sole selector, own rule, not comma-shared**. Confirmed it does NOT have
    `.ui-empty-state__cta`'s problem: that one is comma-shared at `EmptyState.css:224`
    (`.ui-empty-state__cta,` + sibling), so the report's disqualification is accurate.
- **AC 4 (Case B per-assertion mutation)** — genuinely per-assertion: mutation 1
  (`width: 20px`) proves (a) `assertFloor` throws and (b) width below floor; mutation 2
  (`min-height: 20px`) independently proves (c) the height assertion is falsifiable and
  not vacuous. Two separate mutations, two transcripts.
- **AC 5 / AC 10** — `orphan-status-report.md` enumerates all 14 specs with per-spec
  verdict, error text, and disposition; produced before wiring (task ordering + report
  content consistent). `ls e2e/*.spec.ts` = 14, matching.
- **AC 6** — `ci.yml`'s two named-spec steps replaced with a single
  `run: npx playwright test`, no per-file arguments.
- **AC 8** — no `frontend/**` or spec-body fixes to any red orphan; `git diff main...HEAD --stat`
  shows zero `frontend/src` changes.
- **AC 9** — `glob-proof-transcript.log` shows `e2e/zz-glob-proof.spec.ts` collected BY NAME
  and going red, in the same run where both previously-wired specs are collected and pass;
  the throwaway is gone from the tree (`git status` clean, no `zz-*` files under `e2e/`).
- **AC 11** — `final-whole-suite-run-cycle2.log`: 39 passed, 0 failed, 48.8s wall-clock,
  post-Case-A-repair. Nothing red only in the combined run.
- **AC 13** — the wrong-axis discriminator imports `DEFAULT_MIN_PX` and
  `RENDERED_BOX_EPSILON_PX` from `e2e/support/touchTargetProbe.ts`, computes
  `const FLOOR = DEFAULT_MIN_PX - RENDERED_BOX_EPSILON_PX`, and both mutated assertions
  compare against `FLOOR`. No re-typed `44` survives in the repaired Case B path.

**Case A mutation-proof argument (highest-priority scrutiny item): SOUND, and correctly
disclosed — not a conjunction masquerading as a proof.**

Verified against the code, not the report. Case A's mutation reorders the entire
`@media` block above the base rule, so the floor mechanism goes inert as a unit; there is
no source edit that breaks the height conjunct without the width conjunct for *this* bug
shape. The HEL-949 lesson ("a conjunction of two mutations guards neither leg") targets
the inverse situation — N mutations applied together, one red observed, so no leg is
individually attributed. Here it is one mutation with N assertions, and the executor
supplies the thing that actually matters: each assertion is shown **false at baseline and
true only under the mutation** (baseline box 44x44, mutated 20x20, both logged in
`caseA-repair-run.log`). An assertion that is dead weight would be true at baseline too;
none are. So no assertion is vacuous.

Per the sharpened decision rule: because one mutation flips all three, they are **one
guard, not three**, and the record must say so rather than present three independent
proofs. `casea-marker-repair-and-mutation-proof.md` does say so, explicitly and in its own
words ("all three genuinely co-vary under this single mutation... there is no way to break
one conjunct independently of the others for THIS specific bug shape"), and
`files-modified.md` repeats the caveat. The two statements the brief flagged as "in
tension" are reconciled in the artifact itself, in the correct direction. No
misrepresentation. Note also that AC 4 binds "any assertion repaired under criterion 3"
— Case A's assertions were not repaired at all (only the marker constant was), so AC 4
does not strictly reach them; the evidence exceeds what was required.

**Case A anchor robustness (whitespace vs. rule): loud in every drift case, and the
uniqueness assertion covers the only call path.**

`TOAST_BASE_RULE_MARKER` is consumed at exactly one place —
`reorderToastMediaAboveBaseRule` (lines 121-148), itself called from exactly one place
(line 205, the Case A test). `assertToastBaseRuleMarkerUnique(original)` is the **first
statement** of that function, before any `indexOf`. Verified by grep: lines 89, 91-92,
126, 131, 145 are the only references, and 131/145 are downstream of 126 within the same
function. There is no second path reading the marker unchecked.

Failure modes traced: a reformatter that indents the base rule → 0 matches → the
uniqueness assertion throws "found 0 — source drifted" (the loud path), and the later
`baseIndex === -1` throw is unreachable dead-lettering rather than the actual guard. A
reformatter that un-indents the media block's copy → 2 matches → throws. Neither can
silently mutate the wrong rule. The residual is real but acceptable and honestly
documented: the anchor *is* a whitespace property, and any reformat costs a loud harness
failure requiring a one-line marker update — which is exactly the behaviour the ticket
wanted in place of the silent rot HEL-851 caused.

Issue (blocking, AC-7-adjacent):

1. **A `HEL-951-FOLLOWUP-N` placeholder survives in the record.** `tasks.md:26` still
   reads: "NOTE: ticket identifiers are placeholders (HEL-951-FOLLOWUP-1..4) pending
   actual filing — see final report." That statement is now false — HEL-960/961/962/963
   are filed (all four verified live in Linear, correct titles/descriptions/backlog
   status) and are what `playwright.config.ts` actually cites. Cycle 2 updated
   `playwright.config.ts`, `files-modified.md` and `orphan-status-report.md` but missed
   `tasks.md`. This is the ticket's own named failure mode (a stale-but-confident note
   surviving a correction sweep) and the exact class of artifact the Phase-1 criterion
   "planning artifacts reflect the final implemented behavior" covers. Config itself is
   clean — the placeholder does not appear in `playwright.config.ts` or `ci.yml`.

### Phase 2: Code Review — PASS

Gates re-run independently by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set), fresh:

| Gate | Result |
|---|---|
| `npm run lint` | PASS (`eslint . --max-warnings=0`, exit 0) |
| `npm run typecheck` | PASS (`tsc --noEmit`, no output) |
| `npm run check:e2e-types` | PASS (`tsc --noEmit -p e2e/tsconfig.json`, no output) |
| `npm run format:check` | PASS ("All matched files use Prettier code style!") |
| `npm test` (repo root) | PASS — root jest **22 suites / 216 tests**, frontend jest **252 suites / 2588 tests**, **0 failures** |

The corrected `npm test` claim in `files-modified.md` is **accurate**, and matches my own
run digit-for-digit (22/216 + 252/2588, 0 failures). It states plainly that there is no
pre-existing `npm test` breakage; the narration of the retracted cycle-1 claim is a record
of the correction, not a hedge, and leaves no ambiguity about the current state. The
cycle-1 root cause given (missing `helio-mcp/node_modules`, plus a `git stash` baseline
that was both wrong and cross-worktree-unsafe) is consistent with what I observe.

No `git stash` was used anywhere in this evaluation.

Other checks:

- **Cleanliness**: `git status --porcelain` empty; no `e2e/zz-*.spec.ts` survives; no `*.png`
  at repo root; `git diff main...HEAD --stat -- frontend/src` is empty, so `toast.css`,
  `PanelList.css` and `MobileNavSheet.css` are all unmutated.
- **No magic values**: the epsilon floor is derived, not literal, in the repaired path.
- **No dead code / no TODO-FIXME** introduced.
- **Comments**: substantial, but every block earns its place (each documents a
  non-obvious cascade/whitespace/precondition fact); consistent with `CONTRIBUTING.md`'s
  comment standard (explains *why*, references the deciding ticket).
- **Behavior-preserving where expected**: the Case B rewrite changes the anchor and the
  navigation to reach it, and nothing else; the Case A change touches only the marker
  constant and adds a guard — no assertion semantics altered.

### Phase 3: UI Review — N/A

No UI-affecting files changed. The diff touches `.github/workflows/ci.yml`,
`playwright.config.ts`, `e2e/**`, and `openspec/changes/**` only — no `frontend/**`, no
`backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`.
(`openspec/changes/` is not a Phase-3 trigger.) Dev servers were therefore not started.

### Overall: FAIL

One narrow, mechanical change request. Everything the brief singled out for hard scrutiny
— the Case A co-variance argument, the four D5 preconditions, the epsilon requirement, the
`ci.yml` comment correction, the three exclusion layers, the gates — holds up under
independent verification.

### Change Requests

1. **`openspec/changes/wire-orphaned-e2e-specs/tasks.md:26`** — delete the now-false
   trailing note "NOTE: ticket identifiers are placeholders (HEL-951-FOLLOWUP-1..4)
   pending actual filing — see final report." and replace it with the real identifiers,
   e.g. "Entries cite the filed follow-ups HEL-960 (hel665 + hel666), HEL-961 (hel716),
   HEL-962 (hel908-tail-attach), HEL-963 (hel909)." After the edit, re-run
   `grep -rn "FOLLOWUP" --exclude-dir=node_modules --exclude-dir=.git .` and confirm zero
   matches repo-wide.

### Non-blocking Suggestions

- `files-modified.md`'s `playwright.config.ts` bullet says "added four new `testIgnore`
  entries" and then parenthetically lists **five** spec filenames. There are five entries
  mapping to four tickets (hel665 + hel666 share HEL-960). Wording nit only; the config is
  correct.
- `playwright.regression.config.ts` spreads the base config with `testIgnore: []`, which
  now also clears the four new quarantine entries. Harmless in practice (that config is
  only ever invoked with the regression spec named explicitly, per `e2e/README.md`), but a
  one-line comment there noting it clears the quarantine register too — not just the
  regression exclusion — would stop a future reader from running it bare and being
  surprised by four known-red specs.
- Case A's own assertions still compare against a bare `44`
  (`expect(mutatedBox.height).toBeLessThan(44)`). AC 13 binds only the *repaired
  wrong-axis discriminator*, so this is out of scope for this ticket and correctly left
  alone — but if Case A is ever touched again, deriving those from `FLOOR` (already
  imported in this file) would be consistent.
