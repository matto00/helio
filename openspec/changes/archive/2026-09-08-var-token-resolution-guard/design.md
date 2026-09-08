# Design — HEL-1037 var(--*) token-resolution guard

## Context

Base `origin/main` @ `3a0c0fe8`. An undefined custom property fails OPEN — `var(--nope)` falls back
to the inherited or initial value, so the element renders wrong rather than erroring. Independently
re-measured on this base: **81** unique tokens in `theme.css`, **83** across all `frontend/src` CSS,
**89** unique `var(--*)` references pre-strip (**88** post-strip; the difference is exactly
`--app-top-chrome-`, the comment artifact of D2), **8** genuinely unresolved.

Two directly relevant precedents already exist in the repo, and this design follows both rather than
inventing a third shape:
- **HEL-441's motion guard** (`frontend/src/theme/motionTokenGuard.css.test.ts`) — same shape of
  protection for a different property, and it already contains a `stripComments` helper.
- **The `:selftest` convention** — four existing guards (`check:dependabot`, `check:openspec`,
  `check:node-root-encoding`, `check:no-credential-leak`) ship a companion selftest run in BOTH
  pre-commit and CI.

## Goals / Non-goals

**Goals.** Fail on any `var(--*)` that cannot resolve; do not fail on correctly-defined tokens;
allowlist runtime-injected tokens with evidence; prove the guard's own failability continuously;
fix the three known defects.

**Non-goals.** HEL-830/680/732 cleanups; token renames beyond the three defects; parsing `var()` out
of `.ts`/`.tsx`; replacing HEL-441's motion guard.

## Decisions

### D1 — A `check:tokens` script with a `:selftest`, NOT a Jest test

HEL-441 implemented its guard as a Jest test. This one follows the **`check:*` + `:selftest`**
convention instead, deliberately:

- The ticket's own scope says "alongside the other `check:*` scripts".
- **The selftest convention only exists for `check:*` scripts.** HEL-441's Jest guard has no
  selftest, so following that precedent would forgo the one mechanism that keeps a guard honest.
- The acceptance criterion is that the guard *fails on a newly introduced undefined token,
  demonstrated by mutation*. A one-off manual mutation at review time proves the guard worked
  **once**. A `:selftest` proves it on **every commit and every CI run** — so the guard cannot
  silently stop being failable through a later refactor. That is the whole deliverable of this
  ticket, and this is the difference between a guard that proves something and one that looks like
  protection. **Shipping the weaker form on this ticket specifically would be self-undermining:** a
  guard whose own failability is unproven is precisely the thing this change exists to eliminate.

### D2 — Strip CSS comments before extraction (required, not defensive)

Port HEL-441's proven approach (`motionTokenGuard.css.test.ts`): replace `/* ... */` with spaces
while **preserving newlines**, so reported line numbers stay correct.

**It must be PORTED, not imported.** `motionTokenGuard.css.test.ts` has **zero exports** —
`stripComments` is file-local inside a TypeScript Jest test, so a standalone check script cannot
import it. The options are (a) copy the implementation with a provenance comment naming its source,
or (b) extract a shared module and change HEL-441's shipped guard to consume it. **(a) is chosen**:
(b) edits a guard that shipped hours ago on another lane's ticket, for no behavioural gain, and
scope discipline on this ticket is explicit. The copy carries a comment naming
`motionTokenGuard.css.test.ts` as its source so the duplication is deliberate and traceable rather
than accidental.

Without it the guard is **red on `main` from its first run against a correctly-defined token**.
`shared/chrome/MobileNavSheet.css:54-55` wraps a comment mid-token:

```
 * entirely from the wrapper's anchor. Repeating `top: var(--app-top-chrome-
 * -height)` here would be a RELATIVE offset ...
```

A naive extractor reads `--app-top-chrome-` as an undefined reference. The real
`--app-top-chrome-height` is defined in `theme.css` and used correctly at `App.css:60`,
`MobileNavSheet.css:12`, `:44`, `:69`.

**This is the design driver, not a nicety.** A guard that cries wolf on day one is a guard someone
disables, which is a worse outcome than never building it. It is also why the acceptance criterion
"passes on `main` after the 3 defects are fixed" is only true *with* comment-stripping — fixing the
three defects alone leaves the check red.

### D3 — The token source set is every `--x:` definition under `frontend/src`, not just `theme.css`

`theme.css` defines 81; two more are defined legitimately elsewhere — `--toast-exit-duration` and
`--toast-intent-color`, both in `shared/ui/toast.css`. Restricting the source set to `theme.css`
would report those two as undefined: **two more false positives, same failure mode as D2.**

The rule is therefore "defined anywhere in the scanned CSS set", which is also the rule that matches
how the cascade actually resolves them.

### D3a — A definition is a DECLARATION, not any `--x:` in the file (the fail-OPEN hole)

**This is the most dangerous defect available to this ticket: the guard failing open on exactly the
class it exists to catch.**

The obvious matcher — `(--[a-z0-9-]+)\s*:` anywhere in the file — yields **99** "definitions"
against the real **83** once comments are stripped (D2), i.e. **16** spurious. Measured WITHOUT
comment-stripping it is 100/17. The 17-name list below is the PRE-STRIP set; post-strip it is the
same list MINUS `--error`, which is prose inside a comment at
`features/assistant/ui/ToolCallIndicator.css:81`, which D2 already removes. **State the precondition
whenever quoting either number** — a reader who re-measures under the other precondition gets a
mismatch and rightly distrusts the rest. The 16 are BEM modifier selectors, not declarations:
`.foo__btn--primary:hover`, `.x--danger:hover`, `.y--queued::before`. Measured on this base, they
admit: `--active --cancel --collection --danger --error --getting-started --ghost --link --primary
--queued --running --save --secondary --settings --signout --table --text`.

Those are plausible token names. **`--text` is the one that proves the danger**: `--text-small` was
one of the three real defects this ticket fixes, so a future `var(--text)` typo would resolve
against a *selector fragment* and pass silently — the guard would fail open on the very typo class
it was built for.

**A definition is a declaration**: a `--x:` appearing where a property may appear (start of a
declaration, i.e. anchored to line start / following `{` or `;`), NOT a `--x:` anywhere in the text.
Pseudo-class and pseudo-element colons in selectors must never be read as declaration colons.

**Why this is uncatchable by running the guard.** With or without the hole, the guard is GREEN on
`main`. Running it proves nothing about this, because a green result answers a narrower question
than the one being asked. Two mechanisms are therefore required, and neither is optional:

1. **An exact-set assertion over a CONTROLLED FIXTURE, in the selftest — not a live count in the
   guard.** The fixture contains a real declaration plus decoys, e.g. `--real: 1px;` alongside
   `.a__b--decoy:hover {}` and `.x--other::before {}`, and the selftest asserts the extracted
   definition set **equals exactly `["--real"]`**. That is cardinality AND membership, it fails
   loudly on precisely the over-permissive matcher, and it is **unaffected by token growth on
   `main`**.

   **A live "definitions == 83" assertion inside the guard is REJECTED**, though it was the first
   thing I reached for. Wired into `.husky/pre-commit`, it would make the next unrelated ticket that
   adds a legitimate token red at commit time, with a message about a number — and concurrent lanes
   are moving frontend files right now. A contributor who bumps 83→84 to get their commit through has
   silently disabled the check: the inverse of protection, and the same "guard someone disables"
   failure mode as D2, arriving from a different direction. The repo's own precedent is a membership
   baseline of accepted *exceptions* (`check-node-root-encoding.mjs:49 KNOWN_ROOT_QUALIFIED_LINES`),
   not a count every legitimate addition invalidates.
2. **Every selftest case asserts on the TOKEN NAMED IN THE GUARD'S OUTPUT, never on the exit code
   alone.** This is not a refinement — without it the mechanisms above collide fatally. The
   scan-root seam (below) points the guard at a `mkdtemp` fixture whose contents are nothing like
   `main`'s, so ANY assertion tied to the whole-corpus shape would fire on every selftest case: every
   "must fail" case would pass on an exit code the fixture's own size produced (the decoy proving
   nothing — the green-only failure this very decision exists to prevent, re-entering by the back
   door), and every "must pass" case could never go green. So: the decoy case asserts a
   `var(--decoy)` reference fails AND that the output names `--decoy`; the undefined-reference case
   asserts the output names `--nope`; the comment and allowlist cases assert the output names
   nothing.

### D3b — A fallback does NOT exempt a reference

`var(--token, fallback)` semantics are decided HERE and nowhere else in these artifacts — a gap
worth naming, because a question no artifact answers is one the executor answers by accident. **4 of the 5
allowlisted tokens are referenced in that form** (`var(--dashboard-background-override, transparent)`,
`var(--panel-surface-override, var(--app-surface))`, …), while `--mobile-panel-height` is referenced
bare.

**Decision: a reference is checked regardless of any fallback.** A fallback-bearing reference does
not fail open in the inherit sense — the fallback renders — so exempting it is superficially
defensible. It is rejected because:

1. `var(--typo, 4px)` is still a typo. The intended design-system token does not exist, and a
   literal has silently substituted for it. That IS the design-system violation HEL-346 exists to
   eliminate; it merely fails *quietly* instead of *open*.
2. Exempting creates a **permanent blind spot**: any typo written with a fallback passes forever, and
   fallbacks are common in exactly the code most likely to be hand-written.
3. The legitimate case — a token that is genuinely undefined in CSS because JS assigns it — is
   already covered by the allowlist (D4). That is what the allowlist is FOR. A fallback is a
   rendering default, not a justification for the token being undefined; note that
   `--mobile-panel-height` needs the allowlist and has no fallback at all, so exempting fallbacks
   would not even remove the need for one.

### D4 — An allowlist entry names its SETTER, not a reason

A free-text reason decays into "legacy" or "needed". Each entry names the file that assigns the
token at runtime, so the claim is checkable and the entry dies naturally when its setter does:

| token | setter |
| --- | --- |
| `--dashboard-background-override` | `app/App.tsx` |
| `--dashboard-grid-background-override` | `features/panels/ui/PanelList.tsx` |
| `--panel-surface-override` | `features/panels/ui/PanelCard.tsx` |
| `--panel-text-override` | `features/panels/ui/PanelCard.tsx` |
| `--mobile-panel-height` | `features/panels/ui/grid/MobilePanelStack.tsx:104` (inline `CSSProperties`) |

**`--mobile-panel-height` is the case that proves the rule.** Its only non-CSS hits are test files;
it looked test-only until the real setter was traced. "It appears in a test" would have been an
unjustified allowlist entry — an allowlist entry needs a **setter, not a sighting**.

### D5 — Fix the three defects, and only those three

`--radius-sm` ×2 and `--text-small` in `PipelineDetailPage.css`; `--space-sm` in
`AddSourceModal.css`. Each maps to an existing token; pick the intended one by reading the
declaration, not by nearest-name. Do not absorb HEL-830/680/732.

## Gate-Chain Implications Checklist

This change adds a script to `.husky/pre-commit` and CI, so it modifies the commit-gate chain.

**What does it execute?** A Node script that reads `frontend/src/**/*.css`, extracts `var(--*)`
references and `--x:` definitions, and exits non-zero listing unresolved references with file:line.
It runs no build, spawns no server, makes no network call, and reads nothing outside `frontend/src`.

**What environment does it inherit, and from where?** The repo's Node from the invoking shell, the
same as the other `check:*` scripts. It reads no environment variables and requires no `.env`, so a
missing or partial environment cannot change its verdict.

**Does it write anything outside its own sandbox?** No. The guard is read-only. The **selftest**
writes a temporary fixture, and must do so in a `mkdtemp` directory it removes afterwards — it must
NOT mutate a tracked file, because a crashed selftest that leaves a planted `var(--nope)` behind
would block every subsequent commit in the repo.

**This requires a SEAM the guard does not otherwise have.** If the scan root is hardcoded to
`frontend/src/**/*.css`, a `mkdtemp` fixture is never scanned and the selftest cannot work at all.
The guard must therefore expose **a pure extractor function** the selftest can drive over in-memory
strings — this is MANDATORY, not one of two options: task 4.2a's exact-set assertion needs the
extracted DEFINITION set, and the guard's stdout lists unresolved REFERENCES only. It must ALSO take
an explicit scan-root argument, because tasks 4.1 + 4.3 + 4.2b jointly require running the guard's
CLI over a `mkdtemp` fixture and asserting on its output — the extractor alone cannot exercise
`main()` end to end. Both, not either. Without them the `mkdtemp` requirement is unimplementable.

**Precedent, checked rather than assumed:** `check:no-credential-leak:selftest` DOES plant inside the
repo tree — gitignored, `finally`-guarded, AND idempotently cleaned at startup. **Take the
startup-cleanup half, reject the in-repo-planting half.** `finally` does not survive `SIGKILL`, so
in-repo planting leaves the repo uncommittable if the process is killed; startup cleanup is the only
mechanism that recovers from that, and it costs nothing to add alongside `mkdtemp`.

**Does it behave differently from a linked worktree than from a main checkout?** No — it resolves
paths relative to the repo root it is invoked from and reads only tracked source files. It must not
use `git` commands that behave differently in a linked worktree, and must not assume `.git` is a
directory (in a worktree it is a file).

**What happens on its first run?** It must PASS — which is exactly why D2 and D3 are required. A
naive implementation fails on `main` against three correctly-defined tokens
(`--app-top-chrome-height` via the comment, plus the two `toast.css` definitions), and a gate that
fails on first install gets bypassed rather than fixed.

## Risks

| Risk | Mitigation |
| --- | --- |
| Guard red on `main` at install → disabled | Comment-stripping (D2) + full token source set (D3); first-run pass is an explicit AC |
| Allowlist rots into unexplained entries | Each entry names its setter (D4); a sighting is not a justification |
| Guard silently stops being failable | `:selftest` runs on every commit and CI run, not once at review (D1) |
| Selftest leaves a planted token behind, blocking all commits | `mkdtemp` + cleanup; never mutate a tracked file |
| Line numbers wrong after stripping | Comment replacement preserves newlines (D2, HEL-441's approach) |
| Scope creep into token cleanup | Only the three named defects (D5) |

## Test plan

`check:tokens:selftest` — plants a bogus `var(--nope)` in a temp fixture, asserts the guard exits
non-zero and names the file:line; asserts a `var()` inside a comment does NOT trip it, exercised
against the real `MobileNavSheet.css:54-55` shape; asserts an allowlisted token passes and a
non-allowlisted undefined one fails. The guard's failability is then demonstrated by mutation at
review time as well — add a bogus reference, watch it go red, remove it — but the selftest is what
keeps that true afterwards.
