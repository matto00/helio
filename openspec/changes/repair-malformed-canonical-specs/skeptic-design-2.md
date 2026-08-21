## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold re-review of the HEL-775 planning artifacts against round 1's five blocking change
requests. Every claim below is derived from the real openspec 1.2.0 parser/validator at
`/usr/lib/node_modules/@fission-ai/openspec/dist/core/` and from real `openspec validate` /
`openspec archive` runs in sandboxed tree copies under
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/r2`.
Nothing in `WORKTREE_PATH/openspec/changes/` was written or archived.

**No round-1 change request survived unfixed.** All five were genuinely addressed, not merely
acknowledged. Two of the four issues below are *consequences* of those fixes (CR5's full-block
hashing interacting with CR2's merge order, and the approved exception colliding with an
unamended verification step), not fresh defects.

---

### What I verified (with evidence)

#### CR1 — the `schema-inference` scenario exception. VERIFIED FIXED on both human constraints.

**(a) The scenario asserts nothing absent from the requirement's own SHALL sentence.**

Ground truth, `openspec/specs/schema-inference/spec.md:139`:

```
`POST /api/sources/infer` and `POST /api/data-sources/infer` SHALL both return the same response
envelope: `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`.
```

tasks.md 10.1's scenario, extracted programmatically and dedented:

```
'#### Scenario: Both infer endpoints return the same envelope'
'- **WHEN** `POST /api/sources/infer` and `POST /api/data-sources/infer` are each called'
'- **THEN** both return the same response envelope'
'  `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`'
```

Word by word:
- The **WHEN** subject list is the two endpoint identifiers, character-for-character as they appear
  in the SHALL sentence. Its predicate "are each called" is the trigger a Gherkin form requires, not
  an assertion — it adds no expectation (no status code, no auth, no payload, no ordering, no error
  shape).
- The **THEN** is the SHALL predicate with `SHALL` removed: "both return the same response envelope".
- The envelope literal is **byte-identical** to the one in the SHALL sentence; verified by substring
  test, not by eye: `env in shall: True`.

Nothing in the scenario is absent from the SHALL sentence. The declined option — inventing spec
content — has **not** arrived by the back door.

**(b) tasks.md 10.2 mandates a real red-before-green proof, and I ran it myself.** I applied task
3.3's repair in a sandbox and drove the full cycle on the real validator:

```
=== RED (repaired, no scenario) ===
✗ [ERROR] requirements.6.scenarios: Requirement must have at least one scenario     EXIT=1
=== GREEN (tasks.md 10.1 scenario inserted verbatim) ===
Specification 'schema-inference' is valid                                           EXIT=0
=== RED again (scenario removed) ===
✗ [ERROR] requirements.6.scenarios: Requirement must have at least one scenario     EXIT=1
=== GREEN again (restored) ===
Specification 'schema-inference' is valid                                           EXIT=0
```

The error string returning is **identical** to the one 10.2(b) names. This is proof, not assumption:
the scenario's presence is demonstrably what makes the file pass, and the exact text in 10.1 is
sufficient (including its two-line `**THEN**` continuation, which the validator accepts).

**Is the exception genuinely bounded?** Yes. It is named with file, line and requirement in four
places (design.md 3a, design.md Non-Goals, proposal.md Non-goals, tasks.md 10.3), and 3a states the
governing principle rather than just the carve-out ("the verbatim constraint exists to prevent
requirements being lost or altered"). It explicitly disclaims generality. I re-derived the "only one
such requirement" claim independently and it holds — see the staleness note below: scanning **all
317** specs at current `origin/main` finds exactly one scenario-less requirement and zero
SHALL/MUST-less requirement bodies:

```
specs scanned: 317
scenario-less requirements: 1
    ('schema-inference', 'InferredSchemaResponse wire format')
SHALL/MUST-less requirement bodies: 0
```

No leak into a general relaxation.

#### CR2 — merge order. FIXED for `shared-inline-error`; the hash claim is now false for `schema-inference` (see Change Request 1).

I re-ran round 1's 6.1 check, upgraded to the *new* full-requirement-block hash, applying tasks
3.2 and 3.3 literally:

```
shared-inline-error   BEFORE AGG=776c1704b7b85379   AFTER AGG=776c1704b7b85379   IDENTICAL
schema-inference      BEFORE AGG=09826a0bc4bc72c9   AFTER AGG=cb9becae7d1474d8   DIFFERENT
```

Document order is now correct in both files — the six `shared-inline-error` requirements come out in
file order and every per-block hash matches. Round 1's CR2 is genuinely closed. The residual
`schema-inference` difference is a *different* problem introduced by CR5's fix; it is Change Request
1 below.

#### CR3 — the guard invariant. VERIFIED FIXED. I could not refute it.

The parser/validator scoping divergence is real and exactly as design.md decision 3 describes:
`extractRequirementsSection` closes the section only on `/^##\s+/`
(`parsers/requirement-blocks.js:26`), while `getContentUntilNextHeader` breaks on any
`headerMatch[1].length <= currentLevel` (`parsers/markdown-parser.js:90`), which includes a level-1 `#`.

I rebuilt round 1's `cap-x` fixture and ran the old checks and the new invariant side by side:

```
check 1  openspec validate --specs   ->  Totals: 1 passed, 0 failed (1 items)   EXIT=0
check 3  parser visibility           ->  A(parser)=['One','Two'] == C(in-file)  GREEN
NEW      set-equality invariant      ->  B(validator)=['One']
                                         SET MISMATCH validator(1) != in-file(2)   GUARD EXIT=1
REAL     openspec archive (MODIFIED) ->  ✗ Requirement must have at least one scenario
                                         Aborted. No files were changed.           EXIT=0
```

So the new invariant fires exactly where the three old checks were all green and a real archive
aborts. (Note the abort needs a `MODIFIED`/`REMOVED` delta; an `ADDED`-only delta against this
fixture archives "successfully" while leaving the spec still malformed — which is arguably worse and
which the invariant also catches.)

I then attacked the invariant three ways:

1. **Enumeration.** Implemented on the real parser + real `Validator.validateSpecContent`, it flags
   **exactly 26** specs on the unrepaired tree — the same 26 design.md enumerates, no more, no fewer.
   That independently re-confirms the enumeration and shows the invariant is not vacuous on task
   1.4's discriminating baseline.
2. **Abort-path audit.** I read every `throw` in `specs-apply.js` / `archive.js`. Every abort path
   that depends on the *canonical spec's* state (`MODIFIED/REMOVED/RENAMED ... not found`,
   `ADDED ... already exists`, `Validation errors in rebuilt spec`) requires either a set
   disagreement or a validator ERROR — both inside the invariant.
3. **Exhaustive simulation.** I built the fully repaired tree (all four classes + the approved
   scenario), confirmed it green, then drove real `buildUpdatedSpec` + `validateSpecContent` for
   `ADDED` × `MODIFIED` × `REMOVED` against all 316 specs:

```
repaired tree:  openspec validate --specs  ->  Totals: 316 passed, 0 failed (316 items)
repaired tree:  set-equality invariant     ->  FAILING: 0
unrepaired: 41 abort cases   ->   repaired: 21 abort cases
```

All 21 residuals are `REMOVED | Spec must have at least one requirement`, and I verified every one of
those 21 is a **single-requirement spec** — removing its only requirement legitimately empties the
spec. That is correct behavior, not a malformation. **Zero `ADDED` or `MODIFIED` aborts remain.** I
found no spec that passes the invariant and still aborts a real archive for a structural reason.

The delta spec's first requirement (`specs/openspec-spec-hygiene/spec.md:3-31`) now encodes the full
three-set invariant plus the zero-ERROR clause, and carries the level-1-`#` scenario matching task
7.4's fifth fixture. Consistent with decision 3.

#### CR4 — Class B's condition. VERIFIED FIXED against ground truth.

`grep -n '^#' openspec/specs/schema-inference/spec.md` (1-indexed):

```
1:## Purpose   5:## Requirements   110:## ADDED Requirements   140:## Requirements
```

Stray `## ADDED Requirements` **and** a duplicate `## Requirements`, exactly as the corrected Class B
row and tasks 3.3 now state. I scanned all 316 specs for two-or-more `^## Requirements$`:

```
schema-inference = 2
(done)
```

It is the only one — the claim is true. `shared-inline-error`: `## Purpose`@1,
`## ADDED Requirements`@5, `## Requirements`@39 — the stray heading is first, as tasks 3.2 states.

#### CR5 — full-block hashing. VERIFIED FIXED (but see Change Request 2 for an ambiguity that can silently reopen it).

Re-ran round 1's demonstration on a copy of `dashboard-delete`, deleting one `- **THEN**` bullet:

```
strict boundary:  before=a9b4f612cd384739  after=98a8dd7c59633309   -> CAUGHT
```

Body-text loss is now visible to 6.1, which it was not in round 1.

#### Round-1 non-blocking notes — all applied, each verified

- **Archive exits 0 on abort.** design.md Context:20-23 states it; task 8.1 requires asserting on
  stdout. Confirmed independently: the aborting fixture returned `archive-on-abort EXIT=0`, printed
  `Aborted. No files were changed.`, and left the spec unmodified.
- **Hook ordering.** Task 7.3 specifies "**before** `npm run check:openspec`". Ground truth:
  `.husky/pre-commit` is `set -e` (line 2) with `npm run check:openspec` at line 7. Implementable.
- **CLI availability.** Task 7.1 and decision 3 cite the `process.exit(2)` convention. Ground truth:
  `scripts/check-openspec-hygiene.mjs` does exactly `process.exit(2)` in its `openspec list --json`
  catch block. Accurate.
- **Proposal wording conflict.** proposal.md Impact now reads "a new standalone guard, invoked from
  `.husky/pre-commit` as its own line **before** `npm run check:openspec`, deliberately not folded
  into that script". Resolved.
- **Fidelity against the unrepaired baseline.** Moved to task 1.4 and referenced from 7.2. My own run
  confirms the baseline discriminates (26 flagged unrepaired, 0 repaired).
- **Duplicate requirement names.** Now decision 3 check 3, tasks 7.1, and its own requirement in the
  delta spec. Confirmed still needed: set-equality alone does not catch it, because a duplicate name
  appears in all three sets.

#### Other ground truth checked

- Change artifacts validate: `openspec validate repair-malformed-canonical-specs --type change` →
  `Change 'repair-malformed-canonical-specs' is valid`, `EXIT=0`.
- `openspec/specs/openspec-spec-hygiene` does not exist — genuinely a new capability.
- Every ticket AC traces to a task. No scope drift: the duplicate-name and level-1-`#` coverage are
  required by AC4 ("a guard prevents the malformation from returning") and by round-1 CR3.

---

### Verdict: REFUTE

The five round-1 change requests are all genuinely fixed, and CR1's two human-set constraints hold
under direct test — that is the important result of this round. But two of the fixes interact badly
with verification steps that were not updated alongside them, and the plan now contains an assertion
that is provably false and a "stop" instruction that will fire on the plan's own approved change.
Separately, `main` advanced during the gate and the plan's hardcoded corpus size is already stale.
All four are wording fixes in `tasks.md` (plus one line in `design.md`); none touches the design's
substance, which I could not refute.

### Change Requests

**1. Task 3.4's hash claim is false for `schema-inference`, and task 10.3 will halt execution on it. (blocking)**

Applying task 3.3 literally — delete the `## ADDED Requirements` line at 110 and the duplicate
`## Requirements` line at 140 — changes the `displayName auto-generation` block hash, because that
block previously terminated on the `##` heading at 110 and now runs to the next `### Requirement:`,
absorbing the second of the two now-adjacent blank lines (old 109 and old 111):

```
BEFORE  480a83208dc4347f  displayName auto-generation
AFTER   aa3682672fd4e467  displayName auto-generation

--- unified diff of the block ---
@@ -15 +15,2 @@
 
+
```

Purely whitespace, no content lost — but task 3.4 asserts "6.1's hash is unchanged for both files"
(false), and task 10.3 says the `InferredSchemaResponse` block must be "the single expected
difference across all 316 specs... Any second difference is a defect — stop." The executor following
the plan hits a mandated stop on a benign blank line. `shared-inline-error` is unaffected
(`776c1704b7b85379` before and after) — this is `schema-inference` only.

Two fixes, both of which I verified restore a byte-identical hash. Pick one and state it:
- (a) In task 3.3, specify the deletion as *heading line plus exactly one immediately-adjacent blank
  line*, so block boundaries stay byte-stable. Verified: `AGG=09826a0bc4bc72c9`, matching the
  baseline exactly, all 8 per-block hashes identical.
- (b) In task 1.2, specify that the block hash is taken over the block with leading/trailing
  whitespace normalized. Verified: `strip=True before==after: True`.

Do not fix it by relaxing 10.3's "any second difference" rule — that rule is the ticket's main
protection for its own stated worst outcome.

**2. Task 1.2's block-boundary wording is readable two ways, and one reading silently reopens the hole CR5 closed. (blocking)**

Task 1.2 defines the block as "every line from a `### Requirement:` header to the next `###`/`##`
boundary". A `#### Scenario:` line satisfies `line.startswith('###')`. If the executor implements the
boundary that way, every block truncates at its first scenario and all `- **WHEN**` / `- **THEN**`
bodies fall back outside the hash — exactly the blindness round 1 demonstrated. Reproduced on a copy
of `dashboard-delete` with one `- **THEN**` bullet deleted:

```
strict boundary (### followed by whitespace):  before=a9b4f612cd384739  after=98a8dd7c59633309  CAUGHT
naive  boundary (line.startswith('###')):      before=3083c9e79b1ea67e  after=3083c9e79b1ea67e  BLIND
```

Required: state the boundary unambiguously as a line matching `/^(##|###)\s/` — i.e. a level-2 or
level-3 heading — and say explicitly that `#### Scenario:` blocks are **inside** the hashed block.
One clause; without it a coin-flip reading voids the ticket's primary safety net.

**3. Task 6.2 contradicts task 10.1 (and the Class B repair). (blocking)**

Task 6.2 requires: "every changed line is either a `## `-level heading or part of a prepended
`## Purpose` block. No `### Requirement:`, `#### Scenario:`, `- **WHEN**` or `- **THEN**` line may
appear as changed."

The human-approved exception in task 10.1 adds precisely a `#### Scenario:` line, a `- **WHEN**` line
and a `- **THEN**` line to `schema-inference`. Under 6.2 as written, the executor must flag its own
approved change as a violation — the same contradiction shape round 1 blocked on for 3.1-vs-6.1.
(Whichever fix is chosen for Change Request 1 will also produce a blank-line change in that file that
6.2's enumeration does not admit.)

Required: carve the same narrow exception into 6.2 that 10.3 carves into 6.1 — name `schema-inference`
and the one requirement, and state that in every other file the rule is absolute.

**4. `main` has advanced to 317 specs; the plan's hardcoded 316 and its re-merge step are now stale. (blocking)**

Ground truth right now: `HEAD` = `785e0af9`, `origin/main` = `8432f280`, so task 1.1's own condition
(`git merge-base HEAD origin/main` equals `git rev-parse origin/main`) is **already false** and the
mandated re-merge will happen. HEL-554 (#413) added a new canonical spec and modified another:

```
openspec/specs/first-run-onboarding/spec.md        | 229 ++++++
openspec/specs/frontend-panel-empty-state/spec.md  |  28 ++
git ls-tree -d --name-only origin/main openspec/specs/ | wc -l   ->  317
```

After the re-merge, task 6.3's literal assertion ("`316 passed, 0 failed`") is unsatisfiable, and the
"all 316" figures in tasks 1.2 / 6.1 / 7.2 / 10.4 and design.md 3a are wrong.

I already checked the substance so the fix is cheap and low-risk: both changed specs are well-formed
(`A=5 B=5 C=5` and `A=3 B=3 C=3`, zero issues), so the repair set stays **26**, and the scenario-less
scan over all 317 still returns exactly one requirement — the exception stays one requirement wide.

Required: (i) express the corpus size and pass count as *derived from task 1.2* rather than as
literals (e.g. "N passed, 0 failed where N is the spec count recorded in 1.2"); (ii) make task 1.1's
re-merge branch re-run the **enumeration**, not just the inventory, and re-check any spec added or
modified by the merge against the four class conditions; (iii) note that AC5's verification of
`frontend-panel-empty-state` must be re-taken post-merge, since HEL-554 changed that exact file after
design.md recorded it clean.

### Non-blocking notes

- **The validator's spec model does not carry requirement names.** `RequirementSchema` is
  `{ text, scenarios }` only (`schemas/base.schema.js:6-12`), and `parseSpec` discards
  `child.title`. Decision 3's "compares the parser's and validator's own outputs" is therefore a
  little loose: the guard must reach one level in and use
  `new MarkdownParser(c).parseSections()` → `findSection(secs,'Requirements').children.map(c => c.title)`.
  That *is* the validator's own traversal (same `getContentUntilNextHeader` scoping, so the divergence
  is faithfully reproduced) — worth naming in task 7.1 so the executor doesn't burn a cycle
  discovering it.
- **Task 8.1's choice of a Class B capability for the `REMOVED` probe is load-bearing.** A `REMOVED`
  against any single-requirement spec legitimately aborts with `Spec must have at least one
  requirement` — 21 of the repaired specs are in that category, including Class A/C/D members
  `oauth-error-display`, `panel-ordering`, `dashboard-ordering`, `resource-metadata`,
  `user-preference-update`, `dashboard-create-route-validation`. Both Class B files are
  multi-requirement (8 and 6), so 8.1 is correct as written — but record *why*, so a later run doesn't
  "simplify" it into a false failure.
- **design.md's Goals bullet was not amended alongside the Non-Goals.** Line 69 still reads "Every
  requirement, scenario and ordering preserved byte-for-byte" with no reference to the 3a exception,
  while proposal.md's equivalent line does carry "save the one bounded exception in Non-goals". Round 1
  asked for both. The exception is unmistakable from three other places so nobody will be misled —
  one clause for consistency.
- **Line-number convention is mixed.** design.md's Class B row and tasks 3.3 give the `schema-inference`
  headings 0-indexed (`@0 / @4 / @109 / @139`) while tasks 3.5 and design 3a use 1-indexed
  (`spec.md:138`). `grep -n` reports `1 / 5 / 110 / 140`. Cosmetic, but pick one.
- **Purpose-fidelity review scope.** design.md defers authored-Purpose review to the skeptic gate but
  does not say how many. It is 24 files. The final-gate reviewer should be told explicitly to read all
  24 against their requirements, or a spot check will pass for a full review.
