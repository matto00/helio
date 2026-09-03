## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from a command I ran or a file I read
in this worktree, not from evaluation-1.md / evaluation-2.md / files-modified.md
(read only as claims).

### What I verified (with evidence)

**Glob actually runs what is claimed (scrutiny 1) — the highest-value check.**
Ran the LITERAL committed `run:` string's discovery (`npx playwright test --list`,
same config path as the committed `npx playwright test`):
`Total: 39 tests in 8 files`. Collected: `auth-cookie-migration`,
`hel773-top-anchored-mobile-nav-sheet`, `hel813-mobile-touch-target-floor`,
`hel908-full-flow`, `hel908-step-card-split`, `hel908-trunk-reorder-drag`,
`hel908-trunk-reorder-order`, `hel910-pipeline-to-dashboard-flow`. NOT collected:
the 5 quarantined specs and the `.regression.spec.ts` harness. `ls e2e/*.spec.ts`
= 14 files = 8 collected + 5 quarantined + 1 regression. Exactly the claimed set —
neither silently-empty nor over-quarantining.

**Suite runs green as a suite (AC11, D7).** Servers via `start-servers.sh` +
`assert-phase.sh servers` → `PASS servers`. `DEV_PORT=6383 npx playwright test`
→ `39 passed (53.9s)`. Wall-clock ~54s, matching the reported number.

**Glob fails loudly for a NEW spec (AC9) — reproduced independently.** I created my
own throwaway `e2e/zz-skeptic-glob-proof.spec.ts` (`expect(1).toBe(2)`); `--list`
collected it (grep count 1) and the run reported
`1 failed  e2e/zz-skeptic-glob-proof.spec.ts:2:5 › skeptic glob proof`. Deleted;
`git status --porcelain` clean afterwards.

**AC1 — three exclusion layers intact.** (a) `playwright.config.ts` still carries
`"**/*.regression.spec.ts"` as the first `testIgnore` entry, and `--list` proves the
harness is not collected; (b) `e2e/hel813-mobile-touch-target-floor.regression.spec.ts:29`
`test.skip(!process.env.HEL813_REGRESSION, ...)`; (c) `playwright.regression.config.ts`
unchanged by this diff and still the only config clearing `testIgnore`. `ci.yml` does
not name the harness anywhere. Anti-goal respected.

**AC2/AC14 — ci.yml comment CORRECTED, not appended.** `git diff` shows the old
7-line block (with its now-false "the ONLY spec run here is…") REMOVED and replaced.
The new comment states the glob mechanism, names `**/*.regression.spec.ts` as a
deliberate exclusion, gives the on-disk-source-mutation reason ("temporarily patches
REAL component source on disk"), points at `e2e/README.md`, and points at
`playwright.config.ts` for the quarantine list.

**AC6/AC7 — mechanism, not just outcome.** `ci.yml`'s two per-spec steps are gone,
replaced by one step whose `run:` is exactly `npx playwright test` (no file args).
Every `testIgnore` entry carries a comment; every quarantine entry names a ticket.
I checked the tickets are REAL, not placeholders: `HEL-960` and `HEL-963` both exist
in Linear (Backlog, High, created 2026-09-03, descriptions matching the quarantine
reasons and explicitly recording that HEL-951 did not fix them). The one entry
without a ticket is the permanent by-design `*.regression.spec.ts` entry, which is
correct per D2.

**AC3/AC12 — Case B's replacement control satisfies all four D5 preconditions,
checked by me against source, not accepted from the report.**
- P1: `e2e/hel813-mobile-touch-target-floor.spec.ts` surface 1 calls
  `sweepSurface(page, { selectors: [".mobile-nav-sheet__item"], scope: dialog })`
  at both widths incl. 430px — genuinely `sweepSurface`, not `assertExpanderFloor`
  (the sibling `.mobile-nav-sheet__create-action` is the expander one, and is not
  the chosen anchor).
- P2: live-measured by me in the harness run: baseline `{"width":404,"height":44}`
  — both axes clear.
- P3: `MobileNavSheet.css:192` base rule has `width: 100%` (not a floor) and
  `min-height: var(--control-lg)`; the mutated mobile rule supplies the 44px height
  floor. No `width`/`min-width` floor anywhere on the selector.
- P4: `MobileNavSheet.css:293` — `@media (max-width: 768px) { .mobile-nav-sheet__item
  { min-height: 44px; } }` is a sole-selector rule, NOT comma-shared. I confirmed the
  disqualification pattern it had to avoid is real (`.ui-empty-state__cta` is indeed
  comma-shared with `.ui-empty-state__secondary-cta`).

**AC13 — epsilon, not a re-typed 44.** The harness imports `DEFAULT_MIN_PX` and
`RENDERED_BOX_EPSILON_PX` and compares against `const FLOOR = DEFAULT_MIN_PX -
RENDERED_BOX_EPSILON_PX`. No bare `44` remains in Case B's discriminators. (Case A
retains bare `44` in its `<44` assertions, which is correct — a `<` comparison is
made stricter, not spuriously red, by the un-adjusted literal, and Case A was not
repaired under criterion 3.)

**Harness runs green, fresh, on my own invocation.**
`DEV_PORT=6383 HEL813_REGRESSION=1 npx playwright test --config=playwright.regression.config.ts …`
→ `2 passed (17.6s)`, with Case A `44x44 → 20x20 threw=true → 44x44` and Case B
`404x44 → 26x44 threw=true → 404x44`. `git status --porcelain` immediately after
shows only the untracked `evaluation-2.md` — both CSS files self-reverted.

**Scrutiny 2 — my own view on Case A's three co-varying assertions.** I agree with
the loop's disclosure, and I do not consider any assertion dead weight, but for a
reason worth stating precisely: (b) and (c) are not independent guards, they are
*attribution*. `expect(redError).not.toBeNull()` alone would pass if `assertFloor`
threw for a reason unrelated to geometry (element detached, not visible, locator
resolving to nothing). Pinning `mutatedBox` to 20x20 is what rules that out. So Case
A is honestly ONE guard with two attribution assertions, not three proofs — which is
exactly how casea-marker-repair-and-mutation-proof.md describes it. The standing
"conjunction guards neither leg" lesson bites when a conjunction is the *only* proof
of two separate behaviors; here there is only one behavior (the whole floor rule
going inert), and its two axes cannot be decoupled by construction. Case B, by
contrast, correctly got two INDEPENDENT mutations, precisely because its height leg
CAN be decoupled — and mutation 2 (min-height → 20px, measured `404x20`) proves the
height assertion is not vacuous. That asymmetry is the right call, not an oversight.

**Scrutiny 4 — repaired assertions still protect what they were written to protect.**
Case B's contract is "a height-only floor on a control that also carries a sub-44px
fixed width must be caught." The repair changed the ANCHOR (a control that no longer
exists → one that does) and the CSS the mutation edits; it did not weaken the
assertions to match today's markup. The mutated measurement `26x44` is the genuine
wrong-axis shape (width red, height clear), i.e. still HEL-781's failure mode, not a
tautology. Case A's repair changed only the marker CONSTANT used to locate the base
rule — no assertion was touched — and it made the failure mode LOUDER
(`assertToastBaseRuleMarkerUnique` throws "source drifted" if the count is ever not
exactly 1). I verified the uniqueness premise myself: `grep -n "toast__close {"`
returns line 126 (unindented) and line 163 (two-space indented), so `"\n.toast__close {"`
matches exactly once.

**AC5/AC10 — reports exist and are deliverables.** `orphan-status-report.md` carries
the full 14-spec enumeration with wired/globbed/quarantined/deliberately-excluded
classification, two samples per passing spec, and an explicit statement that FAIL
verdicts are single-sampled. AC8 held: no red orphan was fixed (no `frontend/src`
file appears in `git diff --stat 71c8b55a..HEAD` at all).

**Gates re-run by me from the repo root (not asserted):**
`npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm run check:e2e-types` →
exit 0; `npm run format:check` → "All matched files use Prettier code style!";
`npm test` → `22 passed, 216 tests` (helio-mcp) then `252 passed, 2588 tests`
(frontend). Note: the executor's original "5 pre-existing helio-mcp failures" claim
was an artifact of running jest from inside `helio-mcp/`; from the root everything is
green, and commit 9fc3f1d0 already corrected that claim.

**Hygiene.** `git status --porcelain` = only untracked `evaluation-2.md`. No
`e2e/zz-*` survivor. No `*.png` at repo root. `git diff --stat main -- toast.css
PanelList.css MobileNavSheet.css` → empty (byte-identical to main).

**UI/design judgment:** N/A — this change touches only `.github/workflows/ci.yml`,
`playwright.config.ts`, `e2e/`, and `openspec/`. No `frontend/` source or CSS is
modified, so there is no rendered surface to judge against DESIGN.md.

### Verdict: CONFIRM

All 14 acceptance criteria trace to evidence I generated myself. The load-bearing
claim — that the glob collects exactly the intended 8 files and no more — is
reproduced, not inherited.

### Non-blocking notes

1. `playwright.regression.config.ts` sets `testIgnore: []`, which now clears the five
   HEL-951 quarantine entries as well as the regression exclusion. In practice it is
   only ever invoked with an explicit single-file argument (documented in the file
   and in `e2e/README.md`), so nothing changes today — but a future bare
   `--config=playwright.regression.config.ts` run would pull in the quarantined red
   specs. If a cheap hardening is ever wanted, `testIgnore` there could be narrowed to
   the quarantine entries only rather than emptied. Not worth a round.
2. Case B's flow uses three `page.waitForTimeout(400)` sheet-settle waits. The harness
   is opt-in and never runs in CI, so this is not a CI-flake vector, but it is a
   timing assumption rather than a state assertion.
