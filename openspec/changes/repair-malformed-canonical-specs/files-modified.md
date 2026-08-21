# Files Modified — HEL-775 (repair-malformed-canonical-specs)

## Canonical spec repairs (26 files, structure-only — no requirement text, scenario, or ordering
changed except the one human-approved exception noted below)

Class A — stray `## ADDED Requirements` heading, no `## Purpose` (19 files): renamed heading to
`## Requirements`, prepended a derived `## Purpose`.

- `openspec/specs/csv-upload-connector/spec.md` — Class A repair
- `openspec/specs/dashboard-appearance-settings/spec.md` — Class A repair
- `openspec/specs/dashboard-delete/spec.md` — Class A repair
- `openspec/specs/dashboard-ordering/spec.md` — Class A repair
- `openspec/specs/dashboard-panel-layouts/spec.md` — Class A repair
- `openspec/specs/dashboard-partial-update/spec.md` — Class A repair
- `openspec/specs/dashboard-rename/spec.md` — Class A repair
- `openspec/specs/frontend-dashboard-creation/spec.md` — Class A repair
- `openspec/specs/frontend-dashboard-selection-flow/spec.md` — Class A repair
- `openspec/specs/frontend-protected-routes/spec.md` — Class A repair
- `openspec/specs/layout-undo-redo/spec.md` — Class A repair
- `openspec/specs/oauth-error-display/spec.md` — Class A repair
- `openspec/specs/panel-delete/spec.md` — Class A repair
- `openspec/specs/panel-duplication/spec.md` — Class A repair
- `openspec/specs/panel-ordering/spec.md` — Class A repair
- `openspec/specs/panel-polling/spec.md` — Class A repair
- `openspec/specs/panel-title-edit/spec.md` — Class A repair
- `openspec/specs/rest-api-connector/spec.md` — Class A repair
- `openspec/specs/smart-panel-placement/spec.md` — Class A repair

Class B — requirements hidden by a duplicate requirements-bearing section (2 files): collapsed all
requirements-bearing headings into the single existing `## Requirements`, preserving document order
and a byte-identical per-block hash for every existing requirement.

- `openspec/specs/shared-inline-error/spec.md` — Class B repair (renamed leading `## ADDED
  Requirements` to `## Requirements`; deleted the later duplicate `## Requirements` heading line)
- `openspec/specs/schema-inference/spec.md` — Class B repair (collapsed `## ADDED Requirements` and a
  second `## Requirements` into the first `## Requirements`, with the documented blank-line-preserving
  deletion so `displayName auto-generation`'s hash stays byte-identical) **+ the one human-approved,
  one-requirement-wide verbatim exception (design.md decision 3a / tasks.md section 10)**: appended one
  `#### Scenario:` restating the existing SHALL sentence on `### Requirement: InferredSchemaResponse
  wire format`, the only scenario-less requirement in all 317 specs, proven red-before-green on the real
  validator (see report).

Class C — no `##` heading at all, bare `### Requirement:` blocks (3 files): prepended a derived
`## Purpose` + `## Requirements`.

- `openspec/specs/dashboard-create-route-validation/spec.md` — Class C repair
- `openspec/specs/dashboard-duplication/spec.md` — Class C repair
- `openspec/specs/overlay-management/spec.md` — Class C repair

Class D — remaining malformations (2 files):

- `openspec/specs/resource-metadata/spec.md` — Class D repair (renamed stray `## MODIFIED
  Requirements` to `## Requirements`, prepended a derived `## Purpose`)
- `openspec/specs/user-preference-update/spec.md` — Class D repair (already had `## Requirements`;
  prepended a derived `## Purpose` only)

## New guard

- `scripts/check-spec-structure.mjs` — new. Enforces the `openspec-spec-hygiene` set-equality
  invariant (delta-parser-visible / validator-visible / in-file requirement-name sets identical, zero
  validator ERRORs) by importing openspec's real `extractRequirementsSection`, `MarkdownParser`, and
  `Validator` from wherever `openspec` resolves on `PATH` (no reimplementation of their scoping rules).
  Also checks for delta-only headings and duplicate requirement names. Accepts an optional directory
  argument (defaults to `openspec/specs`) so the same script can self-test against a fixtures directory
  outside the repo. Exits `2` if the `openspec` CLI can't be resolved, mirroring
  `check-openspec-hygiene.mjs`'s convention.

## Wiring

- `package.json` — added `"check:spec-structure": "node scripts/check-spec-structure.mjs"`.
- `.husky/pre-commit` — added `npm run check:spec-structure` as its own line, before `npm run
  check:openspec` (ordering is load-bearing under `set -e` — see design.md decision 2/tasks.md 7.3).

## Change-tracking files (not source, listed for completeness)

- `openspec/changes/repair-malformed-canonical-specs/tasks.md` — checkboxes marked complete (32/33;
  9.4 "hand-write the Purpose at archive time" intentionally left for Phase 3/archive).
