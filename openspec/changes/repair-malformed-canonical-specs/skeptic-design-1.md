## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold review of the HEL-775 planning artifacts. Every claim below is derived from the real
openspec 1.2.0 parser/validator at `/usr/lib/node_modules/@fission-ai/openspec/dist/core/`
and from real `openspec archive` / `openspec validate` runs in sandboxed tree copies under
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad`.
Nothing in `WORKTREE_PATH/openspec/changes/` was written or archived.

### What I verified (with evidence)

**Base pin.** `git rev-parse HEAD` = `git rev-parse origin/main` = `git merge-base HEAD origin/main`
= `785e0af9ca3cb2b7228d5f5714f6598bf28c997c`; `git diff --stat main...HEAD -- openspec/specs` is
empty. The stated measurement base is real and the tree is not stale. 316 canonical specs.

**Enumeration re-derived independently.** I wrote my own enumerator that imports the real
`extractRequirementsSection` and the real `Validator`, and ran it over all 316 specs:

```
total specs: 316
invalid (validator ERROR): 24
hidden-requirement files (visible != total): 25
files with a delta-only heading: 22        (21 x '## ADDED' + 1 x '## MODIFIED')
UNION malformed: 26
specs lacking a '# Title': 41
```

The per-file breakdown matches design.md's four classes **exactly** — same 19 Class A names as
tasks.md section 2, same Class B pair with the same hidden counts (`schema-inference` 4/8,
`shared-inline-error` 3/6), same Class C triple (`nHeadings == 0`), same Class D pair. The
reconciliation to 26 in 4 classes is correct, and the 5 files neither prior run reported are real.
`openspec validate --specs` on the unrepaired tree: `Totals: 292 passed, 24 failed (316 items)`,
`EXIT=1` — task 1.3's baseline and decision 3's "flags exactly the 24" are both confirmed, and the
exit code is trustworthy (unlike `archive`, see notes).

**All four probes reproduced against the real CLI.**

| Probe | My result |
| --- | --- |
| 1 — `MODIFIED` vs unrepaired `dashboard-delete` | `dashboard-delete MODIFIED failed for header "### Requirement: Dashboard can be deleted via DELETE endpoint" - not found` / `Aborted. No files were changed.` |
| 2 — same, after **heading rename only** | **still aborts**: `✗ Spec must have a Purpose section` / `Aborted. No files were changed.` |
| 3 — same, after rename **+ Purpose** | `~ 1 modified` / `Specs updated successfully.`; both requirements intact |
| 4 — **`ADDED`-only** vs unrepaired `panel-ordering` | **aborts**: `✗ Spec must have a Purpose section` / `Aborted.` |

Probe 2 and probe 4 are the load-bearing ones and both hold. The ticket's framing really is wrong
in the three ways the proposal states. Additionally I confirmed by exhaustive simulation
(`buildUpdatedSpec` + `validateSpecContent` over all 316 specs x ADDED/MODIFIED/REMOVED) that
exactly **24** specs abort on an `ADDED` or `MODIFIED` delta today, and those 24 are precisely the
validator-invalid set. (39 "REMOVED failures" also appear, but 15 of those are single-requirement
specs where removing the only requirement legitimately empties the spec — not malformations. I
checked all 15: `reqs=1, valid=true`.)

**In-flight repairs verified, not assumed.** `openspec validate shared-status-message --type spec`
→ `is valid`; `openspec validate frontend-panel-empty-state --type spec` → `is valid`. Headings
confirm `## Purpose` + `## Requirements` on both, with a `# Title` on the latter only — matching
design.md's description. Neither is in the problem set.

**Decision 2's premises are factually grounded, not rationalised.** `scripts/check-openspec-hygiene.mjs`
does police `openspec/changes/` only (unarchived changes, stray files) — different directory,
different subject. The "complete but not archived" false-positive it names is real and present at
line 34 of that script. `.husky/pre-commit` runs `npm run check:openspec` under `set -e`, so a
separate line is straightforward. I accept decision 2.

**Decision 1 (authored Purpose) is sound.** `MIN_PURPOSE_LENGTH = 50` and the brevity issue is a
`WARNING`, exactly as task 2.2 states; the missing-Purpose failure is a hard `ERROR` thrown by
`MarkdownParser.parseSpec`. I read the Class C/D files: they carry well-specified requirements
(e.g. `overlay-management`'s three requirements, `resource-metadata`'s five scenarios), so a Purpose
that restates existing scope without inventing behavior is clearly derivable. No objection.

**Guard hole-hunt.** I implemented decision 3's checks 2 and 3 faithfully and ran them plus
`openspec validate --specs` against purpose-built fixtures, then ran a **real `openspec archive`**
against each. Check 3 is genuinely load-bearing and not subsumed (a requirement trailing a later
`## Notes` heading passes `validate --specs` but is caught by check 3). But I found a case that
passes all three checks and still aborts archive — see Change Request 3.

### Verdict: REFUTE

Four of the six things I was asked to scrutinise hold up well; the enumeration and the probe
evidence are solid work. But the Class B repair as specified does not achieve the ticket's primary
acceptance criterion for one capability, tasks 3.1 and 6.1 contradict each other on another, and the
guard has a reproduced blind spot. These are cheap to fix in the artifacts and expensive to discover
during execution.

### Change Requests

**1. The Class B repair of `schema-inference` leaves `openspec archive` still aborting. (blocking)**

`openspec/specs/schema-inference/spec.md:138` — `### Requirement: InferredSchemaResponse wire format`
has a SHALL body but **zero `#### Scenario:` blocks**. Today that requirement is hidden from the
validator (it sits in the stray `## ADDED Requirements` section, which `MarkdownParser.findSection`
never matches), which is the only reason the file currently validates. `RequirementSchema.scenarios`
is `z.array(...).min(1, 'Requirement must have at least one scenario')` — an **ERROR**, not a warning
(`dist/core/schemas/base.schema.js:10-11`).

The moment tasks 3.1/3.2 make all 8 requirements visible in one `## Requirements` section, the
validator sees it and the file goes red. Reproduced twice, by two independent constructions
(a mechanical merge script, and a second pass hand-built in task 3.1's literal order):

```
$ openspec validate --specs          # after the plan's Class B repair
Totals: 315 passed, 1 failed (316 items)     EXIT=1
✗ spec/schema-inference

$ openspec validate schema-inference --type spec
✗ [ERROR] requirements.6.scenarios: Requirement must have at least one scenario

$ openspec archive probeB --yes      # ADDED-only delta vs the *repaired* schema-inference
Validation errors in rebuilt spec for schema-inference (will not write changes):
  ✗ Requirement must have at least one scenario
Aborted. No files were changed.
```

This is the same shape of miss that probe 2 caught in the ticket's own proposal — repairing the
visible layer surfaces a second validation error underneath — one level deeper, and the plan walked
into it. There is no escape by partial merge: the defective requirement is inside the `## ADDED`
section, so *any* repair that satisfies task 3.2 (8/8) exposes it. As specified, the plan fails
task 6.3 (`316 passed, 0 failed`), fails task 7.5 (guard green on the repaired tree), and leaves
`schema-inference` aborting every future archive — the exact bug the ticket exists to fix.

I traced the requirement to its origin: `openspec/changes/archive/2026-03-22-hel-47-data-sources-page/specs/schema-inference/spec.md`
authored it scenario-less. Nothing was lost in archiving, so "restore the dropped scenario" is not
available.

Required: design.md and tasks.md must name this file and requirement explicitly and state the chosen
resolution, with its justification, rather than discovering it mid-execution. Adding one scenario
that restates the already-stated envelope contract (asserting no behavior beyond the SHALL sentence
already in the file) is the least-bad option and should be called out in the proposal as the single
deliberate exception to "no requirement text altered" — the Non-goals and the "preserved byte-for-byte"
goal both currently forbid it, so they need amending too. Also add a task step that re-scans for this
condition after every class is repaired; I confirmed this is the **only** scenario-less or SHALL-less
requirement across all 316 specs, so the exception is exactly one requirement wide.

**2. Task 3.1 contradicts task 6.1 for `shared-inline-error`. (blocking)**

Task 3.1 prescribes the merge order as "existing section's blocks first, then the previously-hidden
blocks in their original relative order". In `shared-inline-error` the stray `## ADDED Requirements`
section comes **first** in the file (line 5) and `## Requirements` second (line 39). So 3.1's order
*reverses* document order:

```
document order                    task 3.1 literal order
1 InlineError renders an error string          1 InlineError banner variant supports a kind and retry action
2 InlineError renders nothing when absent      2 InlineError banner supports suppressing its own alert role
3 All four components use InlineError          3 InlineError banner supports an icon-only retry action
4 InlineError banner variant ... retry action  4 InlineError renders an error string
5 InlineError banner ... alert role            5 InlineError renders nothing when absent
6 InlineError banner ... icon-only retry       6 All four components use InlineError
```

Task 6.1 requires the **ordered** requirement/scenario name list and its sha256 to be identical, and
says "Any difference is a defect — stop." I ran 6.1's own check across that transformation:

```
shared-inline-error: before=43cca83080869def after=865d91ee188652d6   *** DIFFERENT -> 6.1 FAILS ***
schema-inference:    before=4b738283d47ee97e after=4b738283d47ee97e   SAME
```

The ticket AC also demands ordering preserved. Required: restate task 3.1 as "preserve **document**
order — the merged `## Requirements` section contains the blocks in the order they already appear in
the file", which for `shared-inline-error` means renaming the leading `## ADDED Requirements` to
`## Requirements` and deleting the later `## Requirements` heading line. That satisfies 6.1 for both
Class B files (verified: schema-inference already coincides).

**3. The guard's three checks do not cover the whole failure class. (blocking)**

Decision 3 claims check 3 "is the general form of the bug" and the proposal claims the guard catches
"the whole failure class". Refuted. The validator and the delta parser use **different section-scoping
rules**: `extractRequirementsSection` closes the section only on `/^##\s+/`, while
`MarkdownParser.getContentUntilNextHeader` closes a `##` section on any heading of level `<= 2`,
including a level-1 `#`. So a requirement that follows a `#` heading inside the requirements body is
**visible to the delta parser but invisible to the validator** — and therefore invisible to every one
of the three checks.

Fixture (`cap-x`), built in a fresh single-spec tree, second independent reproduction:

```
## Purpose
...
## Requirements
### Requirement: One
The system SHALL one.
#### Scenario: s
- **WHEN** a
- **THEN** b

# Appendix

### Requirement: Two
The system SHALL two.          <- no scenario
```

```
check 1  openspec validate --specs   ->  Totals: 1 passed, 0 failed   EXIT=0
check 2  delta-only headings         ->  none
check 3  parser visibility           ->  GUARD GREEN (2 of 2 visible)
REAL     openspec archive ch --yes   ->  ✗ Requirement must have at least one scenario
                                         Aborted. No files were changed.
```

This is not academic: it is the *generalised* form of Change Request 1, and level-1 headings are
normal in this repo (41 specs lack one, and openspec's own `buildSpecSkeleton` writes
`# <name> Specification`). I confirmed no current spec has a `#` heading after its `## Requirements`
line, so the hole is latent today — but a preventive guard's entire value is future coverage.

Required: replace or supplement check 3 with the stronger invariant that actually closes the class —
**the requirement-name set seen by the delta parser, the requirement-name set seen by the validator's
spec model, and the set of `### Requirement:` lines in the file must all be identical**, and the
validator must report zero ERRORs over that set. I verified this single invariant catches every case
in this ticket: all four repair classes, the `## Notes` fixture, the `#`-heading fixture, and
post-merge `schema-inference`. Update `specs/openspec-spec-hygiene/spec.md` accordingly — its first
requirement currently encodes only the delta-parser half of the invariant. Add a fifth fixture to
task 7.4 for this case.

**4. Class B's stated condition is wrong for `schema-inference`, and task 3.1 under-specifies the fix. (blocking)**

design.md's Class B row says the condition is "a **second** `## ADDED Requirements`". Ground truth
for `schema-inference` is different — its four `##` headings are:

```
(0) ## Purpose   (4) ## Requirements   (109) ## ADDED Requirements   (139) ## Requirements
```

It carries a stray `## ADDED Requirements` **and a duplicate `## Requirements`** — it is the only
spec in the repo with two `## Requirements` headings (I scanned all 316). Task 3.1 instructs only
"merge the stray `## ADDED Requirements` section", which read literally leaves the duplicate
`## Requirements` in place and 7 of 8 requirements visible. Task 3.2 would catch that, but the
enumeration table is the artifact future runs plan against and it is currently inaccurate. Required:
correct the Class B condition to name both malformations per file, and reword 3.1 to "collapse **all**
requirements-bearing `##` sections into a single `## Requirements`".

**5. Tasks 6.1/6.2 cannot mechanically detect altered or dropped requirement *body* text. (blocking)**

Task 1.2/6.1 hashes only `### Requirement:` and `#### Scenario:` **heading lines**. Requirement
prose, SHALL statements and `- **WHEN**/**THEN**` bullets are outside the hash. Demonstrated on a
copy of `dashboard-delete`, deleting one `- **THEN**` bullet and one entire SHALL statement:

```
task 1.2/6.1 sha256  before=4033bc865196ccc7  after=4033bc865196ccc7
-> IDENTICAL: requirement text loss is INVISIBLE to 6.1
```

The only remaining backstop is task 6.2, a by-eye `git diff` review over a 26-file diff. The plan
holds itself to "compare mechanically, not by eye" for the guard (7.2) but not for the ticket's own
stated worst outcome ("a silently dropped requirement is worse than the bug"). Required: extend
1.2/6.1 to hash the **full requirement block** (every line from a `### Requirement:` header to the
next `###`/`##` boundary), not just the heading lines. Given CR 1 and CR 2, state the expected
exceptions explicitly and narrowly: `schema-inference` (one added scenario) and nothing else.

### Non-blocking notes

- **`openspec archive` exits 0 even when it aborts.** Every abort above printed
  `Aborted. No files were changed.` and returned `EXIT=0`. This is worth one line in design.md's
  Context: it explains why this bug class stayed latent through many deliveries, and it means task
  8.1's end-to-end proof must assert on **stdout** ("Specs updated successfully" / absence of
  "Aborted"), not on the exit code. As written, 8.1 could be reported green by a shell check.
- **Hook ordering.** `.husky/pre-commit` uses `set -e`, so if `npm run check:spec-structure` is
  appended after `npm run check:openspec`, the known-flaky check gates the reliable one and
  decision 2's attribution benefit is lost on exactly the commits it was meant to serve. Task 7.3
  should specify placing the new line **before** `npm run check:openspec`.
- **CLI availability.** The guard shells out to `openspec`, which is not a declared dependency
  (`grep openspec package.json` finds only the script name). This is already the repo's established
  pattern — `check-openspec-hygiene.mjs:20-29` does the same and hard-fails with `process.exit(2)` —
  so it is not a new risk, but task 7.1 should say the guard mirrors that convention rather than
  leaving a missing CLI to spawn an unhandled ENOENT or silently pass.
- **Proposal/design wording conflict.** proposal.md's Impact bullet says the guard is "wired into the
  existing `check:openspec` pre-commit gate", which reads as extending `check:openspec` and
  contradicts decision 2 and task 7.3. One-word fix.
- **Duplicate requirement names cause silent corruption, not an abort.** A fixture with two
  `### Requirement: Dup` blocks passes all three guard checks and passes `validate --specs`; a
  `MODIFIED` delta then archives "successfully" and writes the revised block **twice**, destroying
  the second requirement's distinct content (`buildUpdatedSpec`'s `keptOrder` loop pushes the same
  replacement once per original block). I verified no spec has duplicate names today and that the
  Class B merges create none, so this is out of scope for this ticket — but it is a one-line addition
  to the guard and directly serves the "silently dropped requirement" risk the design already names.
- **Purpose fidelity has no mechanical check** — by design, it falls to the final skeptic gate. That
  is acceptable, but the final-gate reviewer should be told explicitly that it must read all 24
  authored Purposes against their requirements; otherwise 24 blocks of new prose ship on a spot check.
- Task 7.2's fidelity comparison runs after repair, against a corpus that is uniformly well-formed by
  then, so a naive check-3 implementation would agree on all 316 vacuously. Running it against the
  **unrepaired** baseline (where 25 files have visible != total) is a far stronger test and costs
  nothing — worth moving to section 1.
