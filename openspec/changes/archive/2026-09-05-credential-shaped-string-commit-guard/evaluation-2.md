# Evaluation Report — Cycle 2 (evaluation-2.md)

Re-evaluation of commit `9a563bbb` ("Fix self-test plant path staleness across
change archival") on top of `a89a204e`, against `origin/main` `4ff73647`.

## Phase 1: Spec Review — PASS

Issues: none.

The fix commit touches only `.gitignore`, `scripts/check-no-credential-in-agent-surface.selftest.mjs`,
`mutation-evidence.md`, and adds `evaluation-1.md`. No production code, no gate
script, no `.husky/pre-commit`, no jest config, no npm script, no migration —
every cycle-1 constraint still holds. Nothing in the new commit plausibly disturbs
the cycle-1 findings, all of which passed.

## Phase 2: Code Review — PASS

### CR1 fix — independently verified by execution, not by reading the diff

I re-ran **my own** archive-rename simulation (the exact reproduction that produced
the cycle-1 crash):

```
$ mv openspec/changes/credential-shaped-string-commit-guard \
     openspec/changes/archive/2026-09-05-credential-shaped-string-commit-guard
$ node scripts/check-no-credential-in-agent-surface.selftest.mjs
...
check-no-credential-in-agent-surface.selftest: OK
SELFTEST EXIT:0
```

No crash, green exit. In cycle 1 this same command produced
`ENOENT ... writeFileSync ... selftest.mjs:796:5` and exit 1. Directory renamed
back immediately; `git status --short` afterward printed nothing (clean tree).

### The other four verification points

2. **`.gitignore` actually matches the new plant path** — verified with
   `git check-ignore -v`, which resolves the rule, not just the text:

   ```
   .gitignore:80:/openspec/.hel846-plant.md	openspec/.hel846-plant.md
   .gitignore:81:/docs/.hel846-plant.md	docs/.hel846-plant.md
   .gitignore:82:/notes/.hel846-plant.md	notes/.hel846-plant.md
   ```

   All three plant paths are ignored. The committable-artifact half of the defect
   (the more serious half) is closed.

3. **`mkdirSync` guard applied to all three plant paths** — `writeHel846Plant`
   (`selftest.mjs:118-121`) calls `mkdirSync(dirname(path), { recursive: true })`
   and is used at all 7 HEL-846 plant-write sites; `dirname` is imported
   (`:27`). Grepping for a raw `writeFileSync` against any `hel846`/`plantPath`
   target returns nothing — the openspec, docs and notes plants all go through the
   helper (the docs/notes plants share the loop at `:787-815` that now uses it).

4. **Independent audit for other paths tied to something that moves** — I did not
   take the executor's audit on trust. Grepping both scripts for
   `openspec/changes` or a date-shaped path leaves exactly one hit, and it is a
   comment explaining the fix (`selftest.mjs:89`). The five remaining raw
   `writeFileSync` plant sites (`:362`, `:388`, `:551`, `:673`, `:705`) all target
   permanent trees — `helio-mcp/`, `frontend/src/features/assistant/`,
   `frontend/src/shared/` — none tied to a change name, date, or ticket
   lifecycle. `.gitignore`'s other `.hel9xx-` entries point at those same permanent
   paths.

5. **Updated transcripts are real and reproduce; Decision 2a still holds** — I
   re-planted at the new path myself:

   ```
   - openspec/.hel846-plant.md:2: contains a hardcoded vendor-prefixed credential-shaped literal — ...
   - openspec/.hel846-plant.md:2: identifier "API_KEY" is assigned a high-entropy credential-shaped value — ...
   ```

   Byte-identical to the §5.1/§5.2 lines as updated in `mutation-evidence.md`. Both
   plants removed afterward. Scanning the updated `mutation-evidence.md` for a
   vendor-prefix shape (≥20 token chars) or a high-entropy named assignment (≥32
   alphabet chars) returns zero hits — no unmarked credential-shaped value was
   introduced at the new path, and no allowlist entry was added anywhere.

6. **Mechanical gates, all re-run fresh by me in `WORKTREE_PATH`:**

   | Gate | Result |
   | --- | --- |
   | `check:no-credential-leak` | OK (5989 files: 13 assistant-surface, 3 fixture, 66 mcp, 5884 delivery-evidence, 15 docs, 8 notes, 0 violations) |
   | `check:no-credential-leak:selftest` | OK |
   | `lint` | exit 0 |
   | `typecheck` | exit 0 |
   | `format:check` | All matched files use Prettier code style |
   | `check:openspec` | `openspec/ is clean` |
   | `check:schemas` | in sync |
   | `check:spec-structure` | passed (351 canonical specs, 0 issues) |
   | `npm test` | 256 suites / 2650 tests passing |

   Working tree clean afterward.

### Code quality of the fix

The comment at `selftest.mjs:86-95` states the defect class and why the surface
roots are the right anchor, so a future author cannot reintroduce it by accident.
`writeHel846Plant` is a small, correctly-scoped helper and its docstring names the
belt-and-braces rationale honestly (the guard is not load-bearing today, and says
so). No over-engineering, no dead code, no behavior change to the gate script
itself.

## Phase 3: UI Review — N/A

**Deliberately skipped**, same reason as cycle 1 and per explicit instruction:
another worktree holds the Playwright session, and this is a build-tooling change
with zero UI surface. No Playwright, no e2e specs, no dev server, no backend.

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

- (Carried, unchanged, still non-blocking) The `deliverySecret` high-entropy rule's
  `["']?` optional quote is asymmetric with `NAMED_SECRET_LITERAL_REGEX`'s required
  quote; a match can end mid-token when a quoted value contains a character outside
  the class. Harmless for a detector — it only ever over-detects a prefix — but one
  line of comment would stop a future reader reading it as a bug.
