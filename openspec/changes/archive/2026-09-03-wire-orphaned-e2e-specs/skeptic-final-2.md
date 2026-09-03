## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of commit `71e47638` on top of the previously-CONFIRMed `a0b0d9e3`, plus a
no-regression sweep. Every number below is one I produced myself; the executor's
"41 tests" was NOT inherited. Judged against `ticket.md`'s restated, product-owner-approved
scope, not the original Linear text. No `git stash` used anywhere.

### The one measurement the product owner asked for — CONFIRMED, independently

`npx playwright test --config=playwright.regression.config.ts --list`, **no file argument**:

```
Total: 41 tests in 9 files
```

- Regression harness **IS** collected: `hel813-mobile-touch-target-floor.regression.spec.ts`
  Case A (`:179:7`) and Case B (`:251:7`) — 2 tests. This is the whole point of the override
  config, and it still works.
- The five quarantined specs are **NOT** collected. Keyed on the property, not on the total:
  `--list | grep -cE "hel665-message-composer|hel666-single-assistant-entry|hel716-panel-detail|hel908-tail-attach|hel909-output-picker"` → **0**.
- The 9 files = the 8 the default config collects + the harness. 41 = 39 + 2. The arithmetic
  closes against my own default-config measurement below, so the number is not a coincidence.

The executor's 41/2 is exactly right. The defect `71e47638` set out to fix is fixed, by
measurement.

### Scrutiny 3 — the derivation is genuine, and the predicate is TIGHT

`playwright.regression.config.ts` imports `baseConfig from "./playwright.config"` and computes:

```ts
const REGRESSION_ENTRY = "**/*.regression.spec.ts";
testIgnore: (baseConfig.testIgnore as string[]).filter((pattern) => pattern !== REGRESSION_ENTRY),
```

There is **no second literal list** of the five quarantine globs anywhere in the file (I read
the whole file, not a diff hunk). The preserved list is genuinely derived; adding or removing
a quarantine entry in `playwright.config.ts` propagates here with no edit. That was the
requirement and it is met.

**Addition 1 — over-removal.** The predicate is `pattern !== REGRESSION_ENTRY`: strict
inequality against an exact string literal. It is **not** `.includes()`, not a regex, not
`endsWith`, not a match on the substring `"regression"`. A future quarantine entry such as
`"**/helXXX-regression-thing.spec.ts"` contains the word "regression" and would still survive
the filter, because only the byte-identical `**/*.regression.spec.ts` is dropped. This is the
tight form, and it is the form that is present. No latent one-layer-down reintroduction.

**Addition 1, second half — what if the filter removes ZERO entries?** If someone renames the
regression glob in `playwright.config.ts` without updating `REGRESSION_ENTRY` here, the filter
drops nothing, `testIgnore` retains the regression glob, and the harness stops being
collectible by this config. On the documented usage path (`--config=... <explicit file>`)
Playwright exits non-zero with "no tests found", so that mode fails loudly. On a bare
invocation it would degrade quietly to 39 tests. **Direction of failure is the safe one** —
it can never silently *un*-quarantine, only silently fail to *include* the harness — but it is
not a loud assertion, and I record it as a non-blocking note rather than a change request
because it is strictly better than the state it replaced and no AC reaches it.

### Scrutiny 4 — the type-check-coverage finding is TRUE, and the assertion is safe

Verified independently, not accepted on report:

- `e2e/tsconfig.json` `include` is `["**/*.ts", "../playwright.config.ts"]`. Resolved relative
  to `e2e/`, the glob reaches only `e2e/**`, and the second entry names
  `playwright.config.ts` alone. `npx tsc --noEmit -p e2e/tsconfig.json --listFiles | grep -c playwright.regression.config` → **0**. The file is genuinely not in the program.
- Root `tsconfig.json` has no `include` (only `exclude`), so it *would* pick the file up — but
  I enumerated `package.json`'s scripts: the only `tsc` invocations anywhere are `typecheck`
  (`npm --prefix frontend`), `check:e2e-types` (`-p e2e/tsconfig.json`) and
  `check:helio-mcp-types` (`npm --prefix helio-mcp`). Nothing invokes the root project.
  Confirmed: **zero gate coverage** on this file. This is a real, correctly-reported gap, and
  it is a good instance of standing lesson 4 — the green `check:e2e-types` above scans nothing
  relevant to the file that changed this cycle.

**Is `as string[]` safe?** Playwright types `testIgnore` as
`string | RegExp | (string | RegExp)[] | undefined`, so the assertion is a genuine narrowing
and could in principle be wrong. I enumerated the failure modes:

| Actual value | Behavior |
|---|---|
| array of strings (today) | correct |
| `undefined` | `.filter` on undefined → `TypeError` at config load → **loud crash**, config unusable |
| a bare `string` | `.filter is not a function` → **loud crash** |
| contains `RegExp` entries | filter runs, exact-equality never matches them → they are **retained** (over-conservative, never un-quarantining) |

Every branch is either a loud crash or fails safe toward *more* exclusion. There is no path
where a bad assertion silently un-quarantines a red spec, which is the only outcome that would
matter here. Combined with the fact that the current value is a six-element string array in the
same repo, one file away, I do not consider the untype-checked assertion shippable-blocking.
The missing coverage itself is a pre-existing repo gap, not something this change introduced,
and the ticket's scope does not reach `e2e/tsconfig.json`.

### Addition 2 — the corrected header comment is TRUE of the code as written

I checked the new comment clause by clause against the code, since a confidently-wrong comment
on this exact file is what caused this cycle:

- "`playwright.config.ts`'s `testIgnore` is now a quarantine REGISTER, not a single entry" —
  true; I read it, six entries (1 permanent + 5 quarantines, HEL-960/961/962/963).
- "This override must clear ONLY the permanent `**/*.regression.spec.ts` entry" — true, and the
  code does exactly that (exact-equality filter).
- "clearing the whole list (as the original `testIgnore: []` did, back when the base register
  held exactly that one entry) would silently un-quarantine every one of those known-red specs"
  — true; `git show a0b0d9e3:playwright.regression.config.ts` confirms it was `testIgnore: []`,
  and the historical framing ("back when … held exactly that one entry") is accurate.
- "DERIVED from `baseConfig.testIgnore` (a filter, not a hand-copied second literal list) …
  so a future addition/removal in the base register can never drift out of sync" — true for
  additions and removals of *quarantine* entries, which is the claim's scope. It does not
  overstate: it says the *preserved list* cannot drift, and it cannot. It makes no claim about
  the `REGRESSION_ENTRY` constant itself being rename-proof, and correctly doesn't.
- "Never referenced by `npm run e2e`, CI, or any other script" — true; `package.json`'s `e2e`
  is bare `playwright test`, and `ci.yml` never names this config.

The old false clause ("without weakening that default-run protection") is **removed**, not
appended to. The new text is true, not merely less wrong.

### Scrutiny 5 — `files-modified.md`'s corrected claim: sound, not evasive

The old text asserted "zero hits anywhere else, confirmed via `grep … | grep -v evaluation-1.md`
returning nothing." I re-ran that exact pipeline: it returns its own lines. The old claim was
false as written; the correction is warranted.

On whether the rewording dodges its own grep: it does **not**. The corrected paragraph still
contains the literal search terms (`FOLLOWUP-[0-9]`, "not yet filed", "pending actual filing"),
so it still self-matches — it was not sanitised to drive the count to zero, which is exactly
what cycle 4's instruction forbade. It states plainly that the earlier claim was false and why
(grep run before the paragraph describing it was written).

On refusing to freeze a line count and pinning an invariant instead: I judge this **sound**.
A count over a file that documents its own search terms is self-referential and changes with
every honest edit — pinning it would guarantee a repeat of the same staleness one paragraph
later. The substituted invariant is the one a reader actually cares about, and it is falsifiable.
I falsified it myself:

```
grep -rniE "FOLLOWUP-[0-9]|not yet filed|pending actual filing" \
  openspec/changes/wire-orphaned-e2e-specs/{tasks.md,orphan-status-report.md} \
  playwright.config.ts playwright.regression.config.ts .github/workflows/ci.yml
```
→ **zero hits**, across all five live artifacts (I added `ci.yml`, which the executor did not
name). The invariant holds. Choosing a stable, checkable property over an unstable snapshot is
better verification practice, not evasion.

### Scrutiny 6 — nothing from skeptic-final-1's CONFIRM regressed

- Default config, the committed CI `run:` string's discovery (`npx playwright test --list`):
  **`Total: 39 tests in 8 files`** — identical to round 1. The 6 newly-enabled orphans are still
  collected.
- Quarantined-or-harness present in the DEFAULT collection:
  `grep -cE "hel665…|hel666…|hel716…|hel908-tail-attach|hel909…|regression.spec"` → **0**. All
  five quarantines still excluded AND the regression harness still excluded from the default
  config — the anti-goal holds.
- Three exclusion layers intact: (a) `playwright.config.ts:31` still carries
  `"**/*.regression.spec.ts"` as the first `testIgnore` entry, with its comment; (b) the spec's
  own `HEL813_REGRESSION` env skip is untouched (`git diff a0b0d9e3..71e47638` touches no file
  under `e2e/`); (c) `playwright.regression.config.ts` remains the sole override — and is now
  *stronger* than in round 1, since it no longer clears the quarantines.
- The diff is exactly two functional/doc files plus two committed audit reports. Nothing under
  `e2e/`, `.github/workflows/ci.yml`, `playwright.config.ts`, `frontend/`, or `backend/`
  changed, so every round-1 finding (Case A/B repairs, D5 preconditions, epsilon derivation,
  ci.yml comment correction) is byte-identical to what was already CONFIRMed.

### Gates — all re-run by me from the repo root

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run check:e2e-types` | PASS (but see: it does not scan the changed file) |
| `npm run format:check` | PASS |
| `npm test` (root, `jest && npm --prefix frontend test`) | PASS — 22 suites / 216 tests, then 252 suites / 2588 tests, 0 failures |

Run from the repo root, not from `helio-mcp/`. No spurious mass failure.

### Hygiene

`git status --porcelain` empty · `git stash list` empty (stack untouched) · no `e2e/zz-*`
survivor · no `*.png` at repo root · `git diff main --stat -- frontend/src` empty, so
`toast.css` and `PanelList.css` are byte-identical to `main`.

### UI / design judgment

N/A. The diff touches only `playwright.regression.config.ts` and markdown under
`openspec/changes/`. No `frontend/` source or CSS, no rendered surface to judge against
`DESIGN.md`. Servers were not started, deliberately — there is nothing to look at.

### Verdict: CONFIRM

The defect `71e47638` targeted is real, the fix is a genuine derivation with a tight
exact-equality predicate, the load-bearing property is reproduced by my own `--list`
(41 tests / 9 files, harness in, all five quarantines out), the corrected comment and the
corrected `files-modified.md` claim are both true as written, and nothing from round 1
regressed. Ships.

### Non-blocking notes

1. **Rename fragility (round-2 addition).** If `**/*.regression.spec.ts` is ever renamed in
   `playwright.config.ts` without updating `REGRESSION_ENTRY`, the filter removes nothing and
   this config silently stops collecting the harness. It fails in the safe direction and
   errors loudly on the documented explicit-file invocation, but a
   `if (!list.includes(REGRESSION_ENTRY)) throw new Error(...)` guard would make the drift
   loud in every mode. Cheap; not worth a round.
2. **`playwright.regression.config.ts` has zero type-check coverage** (verified above). Worth a
   follow-up ticket to add `"../playwright.regression.config.ts"` to `e2e/tsconfig.json`'s
   `include` — a one-line change deliberately and correctly left out of this ticket's scope,
   but the file now carries a type assertion and a `.filter()`, so the gap has more teeth than
   it did before.
3. Carried forward from round 1, still non-blocking: Case B's three `page.waitForTimeout(400)`
   sheet-settle waits are timing assumptions rather than state assertions (opt-in harness,
   never in CI, so not a CI-flake vector).
