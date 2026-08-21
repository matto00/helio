## Context

**Measurement base: `8432f280` (current `origin/main`).** Originally measured at `785e0af9`. `main`
advanced TWICE during planning — HEL-773, then HEL-554/#413 — and both times the branch was re-merged
and the enumeration re-run *before* any spec file was edited. This matters more here than on a typical
ticket: two earlier counts exist (22 from HEL-528's run, 21/19 from HEL-548's run), each taken on a
different tree, and that discrepancy is the ticket's central confusion. This enumeration is the third
and is pinned to a stated SHA. Because this ticket rewrites spec files wholesale, a stale-base overwrite
would be indistinguishable from intended repair work under review — so the merge happens first, always.

Each merge was re-verified against the class conditions rather than assumed benign: HEL-773 modified
`mobile-dashboard-sheet` (7 requirements, rewritten Purpose, byte-identical to `origin/main`);
HEL-554 added `first-run-onboarding` and modified `frontend-panel-empty-state` — the very file AC5
requires verifying clean. All three are **well-formed** and none is in the repair set. The corpus grew
316 -> 317 and the repair set stayed 26, but the corpus size is treated as a derived value `N`
throughout `tasks.md`, never a literal, precisely because it moves. Enumerating before that merge would have risked reverting a merged
capability change in a ticket whose whole job is rewriting spec files — indistinguishable from intended
work under review.

### Ground truth: how archive actually reads a canonical spec

`extractRequirementsSection` (`parsers/requirement-blocks.js`) locates requirements with
`/^##\s+Requirements\s*$/i` and ends the section at the next `^##\s`. Requirements outside that section
are invisible. `openspec archive` then runs `Validator.validateSpecContent` on the **rebuilt** spec and
aborts if it is invalid. So there are two independent abort paths, and a file can fail either.

**`openspec archive` exits 0 even when it aborts.** Every abort observed printed `Aborted. No files were
changed.` and returned exit status 0. This explains why the bug class stayed latent through many
deliveries, and it means any end-to-end proof must assert on **stdout** (`Specs updated successfully`,
and the absence of `Aborted`), never on the exit code.

### What was measured, not assumed

Four probes were run against the real parser and a real `openspec archive` in a sandboxed copy of the
tree:

| Probe | Input | Result |
| --- | --- | --- |
| 1 | `MODIFIED` delta vs unrepaired `dashboard-delete` | `MODIFIED failed ... - not found` / `Aborted.` — reproduces the ticket |
| 2 | same, after **heading rename only** | **still aborts**: `Spec must have a Purpose section` |
| 3 | same, after rename **+ Purpose** | archives cleanly, both requirements preserved |
| 4 | **`ADDED`-only** delta vs unrepaired `panel-ordering` | **aborts** — contradicts the ticket |

Probe 2 settles the ticket's load-bearing open question, which HEL-548's run explicitly flagged as an
untested inference: **the bare rename is insufficient.** The ticket's proposed "~30-second heading
repair, a diff touching nothing but `## ` lines" would have left 19 files still aborting archive, with
a new error message. Probe 4 shows the blast radius is wider than stated: any delta of any kind against
the 24 no-Purpose capabilities aborts today, so this is not "nothing is broken today".

The `# <name> Specification` title is **not** load-bearing: 41 specs lack it, including healthy ones
like `backend-persistence`, which validates and parses cleanly. Adding titles is therefore out of scope.

### The repair set: 26 files in four classes

| Class | N | Condition | Repair |
| --- | --- | --- | --- |
| A | 19 | raw delta file: `## ADDED Requirements`, no Purpose, 0 requirements visible | rename heading → `## Requirements`, prepend `## Purpose` |
| B | 2 | valid today only because requirements are hidden. `schema-inference` (4/8 visible) carries a stray `## ADDED Requirements` **and a duplicate `## Requirements`** — the only spec in the repo with two `## Requirements` headings. `shared-inline-error` (3/6 visible) carries a stray `## ADDED Requirements` **first** in the file, before its `## Requirements`. | collapse **all** requirements-bearing `##` sections into one `## Requirements`, preserving **document** order |
| C | 3 | `dashboard-create-route-validation`, `dashboard-duplication`, `overlay-management`: **no `##` heading at all**, bare `### Requirement:` blocks | prepend `## Purpose` + `## Requirements` |
| D | 2 | `resource-metadata` (stray `## MODIFIED Requirements`), `user-preference-update` (has Requirements, no Purpose) | rename heading and/or prepend Purpose |

A+B = 21 files carrying the stray `## ADDED` heading, which reconciles exactly with HEL-548's refined
figure of 21 and its "19 of those are raw delta files" claim; the 22nd was
`frontend-panel-empty-state`, already repaired. Classes C and D are **5 files neither prior run
reported** — found only because this enumeration keyed on validator/parser outcome rather than on
grepping one heading string.

Both in-flight repairs were verified, not assumed: `shared-status-message` (Purpose + Requirements,
clean) and `frontend-panel-empty-state` (title + Purpose + Requirements, clean). Neither appears in the
problem set.

## Goals / Non-Goals

**Goals:**
- All 26 files archive cleanly under `MODIFIED`, `REMOVED` and `ADDED` deltas.
- Every requirement, scenario and ordering preserved byte-for-byte, save the single bounded exception
  in decision 3a (`schema-inference`, one requirement).
- A guard that fails red on a deliberately malformed spec, proven before being trusted.

**Non-Goals:**
- Altering, merging, splitting or re-scoping any requirement — with exactly one bounded exception,
  named in decision 3a: a single scenario added to `schema-inference`'s `InferredSchemaResponse wire
  format`, restating that requirement's existing SHALL sentence. One requirement wide, no new behavior.
- Adding `# Title` headings (proven not load-bearing).
- Fixing the upstream archive step that wrote these files (outside this repo).
- Touching `openspec/changes/` beyond this change's own directory.

## Decisions

### 1. Repair = restore structure, and author a Purpose where one is missing

The Purpose is not optional decoration — `validateSpecContent` hard-errors without it, so 24 files
cannot archive until one exists. Each Purpose is **derived from the requirements already in that file**,
describing the capability's existing scope. No new behavior is asserted. This is the one place the
change adds prose, and it is required for correctness rather than cosmetic.

### 2. The guard goes in a NEW script, not `check-openspec-hygiene.mjs`

The ticket suggests extending `check-openspec-hygiene.mjs`. Rejected, for three reasons:

- **Different subject.** That script polices `openspec/changes/` drift (unarchived changes, stray
  files, leftover handoffs). This guard polices `openspec/specs/` structural validity. Different
  directory, different failure semantics.
- **Contamination by a known false-positive.** HEL-657: its "complete but not archived" check
  false-positives on implementation commits, which routinely pushes runs to `git commit -n`. Folding a
  reliable structural guard into a script that is already routinely bypassed means the reliable signal
  gets bypassed with the noise. A separate script keeps a red result attributable and meaningful.
- **CI/manual reuse.** A standalone check can be run on its own without inheriting the flaky check's
  exit code.

It is wired into the same pre-commit hook and an npm script, so coverage is unchanged; only
attribution improves. Note this does not defend against `commit -n`, which skips every hook — the
separation is about signal quality, not bypass resistance.

### 3. The guard enforces one invariant, not three narrow checks

Grepping for `## ADDED Requirements` would have missed 5 of the 26 files in this very ticket. But
checking only "are requirements visible to the delta parser" is also insufficient — proven by fixture
during the design gate.

**The validator and the delta parser scope sections differently.** `extractRequirementsSection` closes
the requirements section only on `/^##\s+/`, while the validator's `getContentUntilNextHeader` closes a
`##` section on any heading of level **<= 2**, including a level-1 `#`. So a requirement following a `#`
heading inside the requirements body is visible to the delta parser but invisible to the validator — it
passes a parser-visibility check and a `validate --specs` run, and real `openspec archive` still aborts.

The guard therefore enforces a single **set-equality invariant** per canonical spec:

> the requirement-name set seen by the **delta parser**, the requirement-name set seen by the
> **validator's spec model**, and the set of `### Requirement:` lines **present in the file** must all be
> identical — and the validator must report zero ERRORs over that set.

This one invariant was verified during the design gate to catch every case in this ticket: all four
repair classes, a requirement hidden behind a trailing `## Notes`, a requirement hidden behind a `#`
heading, and the post-merge `schema-inference` state. Three narrower checks are kept **only** because they
produce clearer diagnostics, not because they add coverage:

1. **Validity** — shell out to `openspec validate --specs` (exit 1 on failure; flags exactly the 24).
   The guard mirrors `check-openspec-hygiene.mjs`'s convention of hard-failing with `process.exit(2)` if
   the `openspec` CLI is absent, rather than passing silently or throwing ENOENT.
2. **No delta-only headings** — `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` is only ever valid in a
   change's delta file.
3. **Duplicate requirement names** — two identically-named requirements pass validation, but
   `buildUpdatedSpec`'s recomposition writes the replacement once per original block, silently
   destroying the second's content. No spec has this today; one line prevents it.

Because the invariant compares the parser's and validator's own outputs, its fidelity is not a
reimplementation risk. It is additionally cross-checked against the **unrepaired** baseline, where 25
files have visible != total — a corpus that actually discriminates, unlike the post-repair tree where a
naive implementation would agree vacuously.

### 3a. One bounded, one-requirement-wide exception to "no requirement text changed"

`openspec/specs/schema-inference/spec.md:138`, `### Requirement: InferredSchemaResponse wire format`,
has zero `#### Scenario:` blocks. The validator requires at least one (hard ERROR,
`RequirementSchema.scenarios` is `.min(1)`). It passes today **only** because the stray heading hides it
from the validator; any repair that makes the file's 8 requirements visible exposes it and
`openspec archive` aborts against the repaired file. It was authored scenario-less in
`2026-03-22-hel-47-data-sources-page`, so nothing was lost and there is no original to restore. It is
the only scenario-less requirement across all 316 specs.

**Decision (escalated, human-approved): add one scenario that restates the SHALL sentence already
present in the file, asserting no new behavior.**

The principle, so future readers get the rule and not just the exception: **the verbatim constraint
exists to prevent requirements being lost or altered.** Restating text already in the file to satisfy a
structural validator does neither. This is therefore a bounded, explicit, one-requirement-wide
exception — *not* a general relaxation of the verbatim rule, which stands unchanged for all other specs
including the other 7 requirements in this same file.

The alternatives were declined because they fail the ticket's actual purpose: leaving the file
unrepaired keeps the capability aborting archives, and — worse — **ships the new guard already red on
it.** A guard that starts out failing is a guard nobody trusts by the end of the week.

Two constraints bind the scenario, and the skeptic verifies both rather than taking the executor's word:

1. It asserts **nothing** absent from the requirement's own SHALL sentence. If writing it requires
   inventing an expectation, stop and escalate — that is the declined option arriving by the back door.
2. Its presence is what makes the file pass, proven red-before-green on the real validator: validate
   with it, remove it, confirm the identical `requirements.6.scenarios` ERROR returns, restore it.

### 4. The guard must be proven to fail

A guard that cannot fail is worse than no guard. Before it is trusted green, it is run against
deliberately malformed fixtures — raw delta; hidden-requirement; missing Purpose; stray `MODIFIED`;
and a requirement hidden behind a level-1 `#` heading (the parser/validator scoping divergence) — and
must exit non-zero on each with a message naming the file. Fixtures live under
a temp dir, never committed to `openspec/specs/`.

## Risks / Trade-offs

- **Silently dropping a requirement is the worst outcome here** — specs are what future runs plan
  against. Mitigation: a mechanical before/after comparison hashing the **full requirement block** — every line
  from a `### Requirement:` header to the next `###`/`##` boundary — not just heading lines. Hashing
  headings alone was proven blind during the design gate: deleting a `- **THEN**` bullet and an entire
  SHALL statement left the heading-only hash byte-identical. Expected exceptions are stated narrowly and
  by name; everything else must be byte-identical.
- **Authored Purposes could misdescribe a capability.** Mitigation: each is derived only from
  requirements present in that file. The final skeptic gate must read **all 24** authored Purposes
  against their own requirements — stated as a count, because a spot check would otherwise pass for a
  full review of 24 blocks of new prose.
- **`openspec validate --specs` validates all 316 specs**, so an unrelated pre-existing failure would
  block commits. Mitigation: after repair, all 316 pass — verified — so the guard starts green.
- **A repaired file could be modified on `main` mid-run.** This ticket rewrites spec files, so a
  stale-base overwrite would be indistinguishable from intended work. Mitigation: `origin/main` was
  merged at the top of Planning (not before the gates), and must be re-merged and re-verified before
  Delivery if `main` advances again.
