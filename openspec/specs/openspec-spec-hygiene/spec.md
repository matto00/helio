# openspec-spec-hygiene Specification

## Purpose
Structural guarantees for canonical specs under `openspec/specs/`: every spec parses, validates, and
exposes all of its requirements to the archive delta parser, so no malformed spec can abort
`openspec archive` mid-delivery after a change's code has already merged.
## Requirements
### Requirement: Canonical specs expose every requirement to both the parser and the validator
Every `spec.md` under `openspec/specs/` SHALL satisfy a set-equality invariant: the set of requirement
names seen by the archive **delta parser**, the set seen by the **validator's spec model**, and the set
of `### Requirement:` lines present in the file SHALL all be identical, and the validator SHALL report
zero ERRORs over that set.

Parser visibility alone is insufficient. The two components scope sections differently: the delta parser
closes the requirements section only on a line matching `/^##\s/`, while the validator closes a `##`
section on any heading of level 2 or lower, including a level-1 `#`. A requirement is therefore able to
be visible to one and invisible to the other, which passes a parser-only check and still aborts
`openspec archive`.

#### Scenario: Requirement under a stray delta heading is rejected
- **WHEN** a canonical spec places requirements under `## ADDED Requirements` instead of `## Requirements`
- **THEN** the spec-structure guard fails, naming the file and the hidden requirements

#### Scenario: Requirement after a closing level-2 heading is rejected
- **WHEN** a canonical spec contains a `### Requirement:` block that falls outside the `## Requirements`
  section because a later `##` heading has closed it
- **THEN** the spec-structure guard fails, naming the file

#### Scenario: Requirement hidden from the validator by a level-1 heading is rejected
- **WHEN** a canonical spec contains a `### Requirement:` block after a level-1 `#` heading inside the
  requirements body, so the delta parser sees it but the validator does not
- **THEN** the spec-structure guard fails, naming the file and the disagreeing sets

#### Scenario: Well-formed spec passes
- **WHEN** all three requirement-name sets for a canonical spec are identical with no validator errors
- **THEN** the spec-structure guard reports no error for that file

### Requirement: Canonical specs carry no duplicate requirement names
Every `spec.md` under `openspec/specs/` SHALL NOT contain two `### Requirement:` blocks with the same
name. Duplicate names pass validation, but the archive rebuild writes a delta's replacement block once
per original block of that name, silently destroying the second requirement's distinct content.

#### Scenario: Duplicate requirement name is rejected
- **WHEN** a canonical spec contains two requirements with the same name
- **THEN** the spec-structure guard fails, naming the file and the duplicated name

### Requirement: Canonical specs carry no delta-only headings
Every `spec.md` under `openspec/specs/` SHALL be free of the delta-only headings
`## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements` and
`## RENAMED Requirements`. These are valid only inside a change's delta file under
`openspec/changes/<change>/specs/`, never in a canonical spec.

#### Scenario: Stray ADDED heading is rejected
- **WHEN** a canonical spec contains a `## ADDED Requirements` heading
- **THEN** the spec-structure guard fails, naming the file and the offending heading

#### Scenario: Stray MODIFIED heading is rejected
- **WHEN** a canonical spec contains a `## MODIFIED Requirements` heading
- **THEN** the spec-structure guard fails, naming the file and the offending heading

### Requirement: Canonical specs pass openspec validation
Every `spec.md` under `openspec/specs/` SHALL pass `openspec validate --specs`, which requires at
minimum a `## Purpose` section and a `## Requirements` section.

`openspec archive` validates the spec it rebuilds and aborts when that rebuild is invalid, so an
invalid canonical spec blocks every delta against its capability — including `ADDED`-only deltas, not
only `MODIFIED` and `REMOVED`.

#### Scenario: Spec missing a Purpose is rejected
- **WHEN** a canonical spec has no `## Purpose` section
- **THEN** the spec-structure guard fails, surfacing the validator's own message for that file

#### Scenario: All canonical specs valid
- **WHEN** every canonical spec has a Purpose and a Requirements section
- **THEN** `openspec validate --specs` exits zero and the guard reports success

### Requirement: The structure guard runs pre-commit and is independently attributable
The spec-structure guard SHALL be a standalone script, exposed as its own npm script and invoked from
the pre-commit hook independently of `check-openspec-hygiene.mjs`, so that a structural failure is
attributable on its own and is not conflated with that script's known false-positive
(a complete-but-unarchived change reported on implementation commits).

#### Scenario: Guard runs on commit
- **WHEN** a commit is made
- **THEN** the spec-structure guard runs and blocks the commit if any canonical spec is malformed

#### Scenario: Guard exits non-zero on a malformed fixture
- **WHEN** the guard is pointed at a deliberately malformed spec
- **THEN** it exits non-zero, proving it is capable of failing rather than assumed to be green

