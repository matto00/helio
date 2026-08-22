## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold re-review of the HEL-775 planning artifacts against round 2's four blocking change requests.
Every claim below is derived from the real openspec 1.2.0 parser/validator at
`/usr/lib/node_modules/@fission-ai/openspec/dist/core/` and from real `openspec validate` /
`openspec archive` runs in sandboxed tree copies under
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/r3`.
Nothing in `WORKTREE_PATH/openspec/changes/` was written or archived.

**No round-1 or round-2 change request survived unfixed.** All four round-2 items are genuinely
fixed, and I verified each by executing the revised instruction rather than by reading it. I then
executed the *entire* plan mechanically end to end against a sandbox copy of the tree, and it
completes without hitting a self-contradiction or a mandated stop on benign output.

One measurement caveat worth recording: my first enumeration pass reported all 317 specs invalid.
That was **my** error — `Validator.validateSpecContent(specName, content)`, not `(content, specName)`.
I re-ran it corrected before drawing any conclusion. Anomalous readings were reproduced, not trusted.

---

### What I verified (with evidence)

#### CR4 — base staleness. VERIFIED FIXED, and `main` has NOT advanced again.

```
git fetch origin main
HEAD        = 8432f2805bccafcfcd376745e8aafd6a3e248461
origin/main = 8432f2805bccafcfcd376745e8aafd6a3e248461
merge-base  = 8432f2805bccafcfcd376745e8aafd6a3e248461
origin/main tip = 8432f280 HEL-554 Add guided first-dashboard onboarding checklist (#413)
```

Task 1.1's condition now holds. Corpus at HEAD = **317** specs. I re-ran the full enumeration
independently (my own script, importing the real `extractRequirementsSection`, the real
`MarkdownParser`, and the real `Validator`):

```
total specs: 317
validator ERROR files: 24
set-inequality files:  25
delta-heading files:   22
UNION malformed:       26
```

The 26 names partition **exactly** into design.md's four classes: 19 Class A, 2 Class B
(`schema-inference` A=4/C=8, `shared-inline-error` A=3/C=6), 3 Class C
(`dashboard-create-route-validation`, `dashboard-duplication`, `overlay-management`), 2 Class D
(`resource-metadata` with the stray `MODIFIED`, `user-preference-update`). The real CLI agrees on the
validator half: `Totals: 293 passed, 24 failed (317 items)`, `EXIT=1` (captured without a pipe —
`$? ` after `| tail` reports `tail`'s status, which is how a "0" can be misread here).

HEL-554's two specs are clean and outside the repair set — `first-run-onboarding` and
`frontend-panel-empty-state` both `is valid`, as is `shared-status-message`, so **AC5's post-merge
re-take holds**. The exception's width is still one requirement at 317:

```
specs=317 requirements=1476
scenario-less: 1   -> schema-inference :: InferredSchemaResponse wire format
SHALL/MUST-less bodies: 0
duplicate requirement names: 0
```

Task 6.3's derived assertion is satisfiable: on my fully repaired sandbox,
`openspec validate --specs` → `Totals: 317 passed, 0 failed (317 items)`, `EXIT=0`.

#### CR1 — task 3.4's hash claim. VERIFIED FIXED by performing the repair, not by reading it.

I applied the revised 3.1–3.4 wording literally to temp copies of both Class B files and hashed every
full requirement block per task 1.2's boundary:

```
--- schema-inference NAIVE (round 2's failing reading: delete heading lines only) ---
   DIFF 3: 480a83208dc4347f -> aa3682672fd4e467   displayName auto-generation

--- schema-inference REVISED 3.3 (heading + one immediately-adjacent blank line) ---
   ok  0..7  ALL EIGHT BLOCK HASHES BYTE-IDENTICAL
   ok  3: 480a83208dc4347f -> 480a83208dc4347f    displayName auto-generation

--- shared-inline-error 3.2 ---
   ok  0..5  ALL SIX BLOCK HASHES BYTE-IDENTICAL
```

Both hash values tasks.md 3.3 names (`480a83208dc4347f`, `aa3682672fd4e467`) reproduce exactly, so
the rationale in the task is accurate and the fix is the thing that restores stability. I also tested
the residual before-vs-after ambiguity in "one immediately-adjacent blank line" (line 110 has a blank
on both sides): **both choices are byte-identical**, because both adjacent lines are empty strings.
Harmless.

Then the whole-corpus form of the same check — the full planned repair (all four classes + task
10.1's scenario) applied mechanically to a sandbox copy, diffed block-by-block against HEAD:

```
### schema-inference  (8 -> 8 blocks)
  DIFF [6] before=e1294cc7029bca87 InferredSchemaResponse wire format
             after =bd627d00fd21df14 InferredSchemaResponse wire format

files with block differences: 1   differing blocks: 1
files with requirement name/order differences: 0
```

**Exactly one differing block across all 317 specs, and it is the approved exception.** Task 10.3's
"any second difference is a defect — stop" does not fire on benign output. Task 6.1 runs clean.

#### CR2 — task 1.2's block boundary. VERIFIED FIXED; single-reading and provably not blind.

The stated regex `/^(##|###)\s/` genuinely excludes `#### Scenario:` (`##`+`#` fails `\s`; `###`+`#`
fails `\s`), so the specified reading and the forbidden reading are now distinguishable from the text
alone. I implemented the specified boundary literally and mutated a copy of `dashboard-delete`:

```
mutation                 task-1.2 boundary            forbidden naive startswith('###')
del **THEN** bullet      f248e0d7 -> ea9c4224 CAUGHT  b2ca32c0 -> b2ca32c0  *** BLIND ***
del SHALL prose line     f248e0d7 -> b9c31406 CAUGHT  b2ca32c0 -> b53c29e9  CAUGHT
del **WHEN** bullet      f248e0d7 -> 04eace8d CAUGHT  b2ca32c0 -> b2ca32c0  *** BLIND ***
DROP whole requirement   f248e0d7 -> 972a02f0 CAUGHT  b2ca32c0 -> ceab0aa1  CAUGHT
alter **THEN** text      f248e0d7 -> 0bd09fbd CAUGHT  b2ca32c0 -> b2ca32c0  *** BLIND ***
```

The specified implementation catches all five; the explicitly-forbidden one is blind to three. The
warning in 1.2 is load-bearing and correctly aimed.

#### CR3 — task 6.2 vs task 10.1. VERIFIED FIXED; I traced sections 3, 6 and 10 for residual conflicts.

6.2 now names `schema-inference` and the one requirement, admits 3.3's whitespace-only change, and
closes with "everywhere else this rule is absolute". Cross-checking the whole chain against what the
repair actually produces: the only lines the diff changes outside `##` headings and prepended
`## Purpose` blocks are (a) one blank line in `schema-inference` (3.3) and (b) the four lines of
10.1's scenario — both explicitly admitted. No contradiction fires. The one asymmetry (6.1 has no
parallel carve-out) is resolved by 10.3 naming task 6.1 explicitly and by section ordering; see note 6.

#### The plan is executable end to end — proven, not judged

Beyond the four items, I ran the plan's own proof steps to confirm they are achievable as written:

- **Repaired tree is clean.** `317 passed, 0 failed`; set-equality invariant: 0 failing files;
  0 delta-only headings; 0 duplicate names; 0 scenario-less requirements.
- **Task 8.1, real `openspec archive`, MODIFIED vs a repaired Class A capability**
  (`dashboard-delete`): `~ 1 modified` / `Specs updated successfully.` — no `Aborted`, both
  requirements intact afterwards.
- **Task 8.1, real `openspec archive`, REMOVED vs a repaired Class B capability** (`schema-inference`,
  8 requirements): `- 1 removed` / `Specs updated successfully.`, 7 requirements remain. This also
  independently confirms all 8 became visible to the delta parser, since the removal target
  (`DataFieldType sealed type`) was in the first section and the previously-hidden ones survived.
- **Task 7.4, the guard must be provably capable of failing red.** I implemented decision 3's
  invariant and ran it against all five fixtures 7.4 specifies, plus a duplicate-name fixture and a
  well-formed control:

```
OK  fx0-well-formed (control)                  -> green
OK  fx1-raw-delta-file                         -> RED: set mismatch 0/0/1; Purpose ERROR; delta heading
OK  fx2-appended-hidden-ADDED-section          -> RED: set mismatch 1/1/2; delta heading
OK  fx3-purpose-deleted                        -> RED: validator ERROR Spec must have a Purpose section
OK  fx4-stray-MODIFIED-heading                 -> RED: set mismatch 0/0/1; Requirements ERROR; delta heading
OK  fx5-level-1-heading-hides-from-validator   -> RED: set mismatch parser=2 validator=1
OK  fx6-duplicate-requirement-name             -> RED: duplicate requirement name: One
ALL FIXTURES BEHAVE AS SPECIFIED
```

  fx5 is caught **only** by the set-equality invariant — all three narrower checks are green on it —
  which independently re-confirms decision 3's central claim that the invariant is not decorative.
- **This change's own archive path is not blocked.** Archiving
  `repair-malformed-canonical-specs` in a sandbox produced
  `openspec/specs/openspec-spec-hygiene/spec.md` with all 5 requirements, `is valid`, and green under
  the guard.
- Wiring targets exist as described: `.husky/pre-commit` is `set -e` with `npm run check:openspec` at
  line 7; `scripts/check-spec-structure.mjs` and `openspec/specs/openspec-spec-hygiene/` do not exist
  yet. `openspec validate repair-malformed-canonical-specs --type change` → valid, `EXIT=0`. No
  `TODO`/`TBD`/`FIXME` in any change artifact. Every ticket AC traces to a task; no scope drift found.

---

### Verdict: CONFIRM

The design's substance survived three rounds of adversarial testing, and this round I could not
refute it by execution either: applying the plan literally produces a corpus that validates
`317 passed, 0 failed`, preserves every requirement name and ordering, changes exactly one requirement
block (the human-approved one), archives cleanly under both `MODIFIED` and `REMOVED`, and ships a
guard I proved fails red on every fixture the plan names. Every remaining objection below is wording
that a mechanical verification step in the plan itself would catch; none can mislead an executor into
a defect that ships. It is ready to implement.

### Non-blocking notes

1. **CR4's fix is applied where it matters but not everywhere.** The assertion that was unsatisfiable
   is fixed (6.3 uses `N`, "317 at 8432f280"), as are 10.3 and 10.4. Stale `316` literals remain at
   `tasks.md:28-29` — which contradicts itself inside one sentence ("across all 316 specs (25 files
   have visible != total today across N=317)") — and at `tasks.md:92`, `tasks.md:120`, `tasks.md:160`,
   `design.md:160`, `design.md:202-203`, `proposal.md:45`. Only `tasks.md:92` (task 6.1, "MUST be
   identical for all 316 files") is an assertion, and it directly contravenes 1.2's own "use `N`
   everywhere below — do not hardcode it". Change that one to `N`; the rest are narrative.
2. **`tasks.md:58` is still 0-indexed** (`## Purpose @0, ## Requirements @4, ## ADDED Requirements
   @109, ## Requirements @139`) inside a task whose other references are 1-indexed ("the single one at
   line 5", "spec.md:138"). Round 2 asked for unification; it was not applied. I tested the hazard:
   deleting **1-indexed** 109 and 139 deletes a blank line and the `InferredSchemaResponse` SHALL
   sentence — landing in the one block whose hash difference 10.3 licenses, i.e. the one place 6.1's
   net is deliberately down. It is caught twice by task 3.4 (visible 4 != total 8 → stop; and two
   block hashes shift, `displayName auto-generation` + `InferredSchemaResponse`), so it cannot ship
   silently. Still, changing `@109/@139` to `@110/@140` costs nothing and removes the only place in
   the plan where a plausible literal misread points at requirement prose.
3. **Task 3.3's blank-line rule is unsatisfiable for the second heading.** `schema-inference:140`
   (`## Requirements`) has no adjacent blank line — line 139 is the SHALL sentence and 141 is a
   `### Requirement:`. Same for `shared-inline-error:39` under 3.2. I verified deleting the heading
   alone is correct and hash-preserving there. Add "…where one exists" so the rule reads as
   satisfiable rather than as licence to delete a non-blank neighbour.
4. **Task 7.1's code snippet will make the guard red on every spec if pasted verbatim.**
   `findSection(sections,'Requirements').children.map(c => c.title)` returns titles *including* the
   `Requirement: ` prefix, while the delta parser's names do not carry it. Measured: with the literal
   snippet, set-equality fails on **317 of 317** specs of the repaired tree, so task 7.5 fails
   immediately. One `.replace(/^Requirement:\s*/, '')` fixes it. Tasks 7.2/7.5 surface it on first
   run, so it costs a cycle rather than a defect — but naming it is exactly what round 2's note
   intended to save.
5. **Task 6.1 references an inventory item task 1.2 no longer records.** 6.1 says "the ordered
   requirement *and scenario* names, and their sha256"; 1.2 records requirement names + full-block
   hashes (scenarios are *inside* the hash, by design). Harmless — the hash strictly dominates — but
   align the wording so an executor doesn't build a second, redundant inventory.
6. **6.1 lacks the carve-out 6.2 was given.** 6.1 still says "Any difference is a defect — stop"
   with no mention of the approved exception. It resolves in practice — 10.3 names task 6.1
   explicitly, and section ordering means 6.1 runs on the heading-collapse-only state where I measured
   *zero* differences corpus-wide — but the asymmetry with 6.2 will make a careful executor stop and
   re-read. One clause.
7. **Two miscounts.** `design.md:135` says "Two narrower checks are kept" and then lists three;
   `tasks.md` 7.4 says "build four malformed fixtures" and then lists five ("…and a **fifth**").
   Both enumerations are unambiguous, so neither can cause a wrong outcome.
8. **Editing residue in task 1.2.** "Per file: per file," is duplicated (`tasks.md:13`), and the
   heading-only-hash rationale is stated twice (lines 18-21 then 21-23).
9. **The new capability will archive with openspec's skeleton Purpose.** `buildSpecSkeleton` writes
   `## Purpose\nTBD - created by archiving change <name>. Update Purpose after archive.` — I confirmed
   the archived `openspec-spec-hygiene` spec carries it, validates, and passes the guard, and that
   30+ existing specs already carry the same string, so this is pre-existing repo behavior and not a
   regression this change introduces. But on a *spec-hygiene* ticket specifically, hand-writing that
   Purpose at archive time would be a fitting last touch.
