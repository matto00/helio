# HEL-636: Group schemas/ by domain and tidy loose repo-root files

## Description

Two small, independent cleanups.

**Part 1 — schemas/ regrouping (RESTATED SCOPE, per material-drift escalation
answered `proceed-with-restated-scope`):** The ticket's literal 42-file / 8-domain
mapping is stale. Live tree has 76 files under `schemas/`, all named `*.schema.json`,
flat (no subdirectories). Use the ticket's 8 domain names (alerts, auth, dashboards,
panels, pipelines, hooks, workspace, shared) as starting vocabulary, but re-enumerate
every file from the live tree and extend with new domains for schemas the ticket
never listed: metrics, assistant (conversations), authoring/refinement, patch-sets,
auth/mfa expansion, agent-memory, workspace-teardown, data-types. Do not implement
the literal 42-file list.

Before moving anything, `scripts/check-schema-drift.mjs` must be updated: it likely
globs `schemas/*.json` at one level and resolves `$ref` by relative path — both must
be made subdirectory-aware (recursive glob, $ref path fixed to new relative location).
Also check `backend/src/test/.../testsupport/JsonSchemaValidation.scala` (classpath
loading, may hardcode flat names) and any `openspec/` references.

**Part 2 — repo root tidy (revised, design-gate skeptic round 1 CR4):**
`development-plan.md` is not a tracked file in this repo — locally git-ignored via
`.git/info/exclude:7` and absent from this worktree entirely — so it cannot be moved by
this change; that half of the ask is unachievable as stated. Move `orchestration-flow.html`
out of repo root into `notes/`, alongside `notes/orchestration-iron-laws-handoff.md`. Leave
`notes/` itself in place. Do not touch root config files or standard top-level docs
(README/CONTRIBUTING/DESIGN/LICENSE/SECURITY/CODE_OF_CONDUCT).

## Acceptance Criteria

- `schemas/` is reorganized into domain subdirectories covering all 76 current
  `*.schema.json` files (not the stale 42-file list); domain names drawn from the
  ticket's 8 plus necessary extensions for unlisted domains.
- `node scripts/check-schema-drift.mjs` passes AND is confirmed to actually traverse
  the new subdirectories — assert and report the file count it sees before and after
  (a zero-file silent pass is the explicit failure mode to guard against).
- All cross-file `$ref`s in schemas are updated to correct new relative paths
  (structure-aware rewrite, not regex/line-oriented).
- `backend/src/test/.../testsupport/JsonSchemaValidation.scala` and any other
  classpath/hardcoded schema loaders are updated for the new paths; `sbt test` green.
- `rg -n 'schemas/[a-zA-Z0-9_-]+\.schema\.json' --glob '!node_modules' --glob
  '!openspec/changes/archive/**'` returns zero matches — scope decision (design-gate
  skeptic rounds 2-3): this sweeps EVERY stale flat-filename reference repo-wide, including
  source-code comments in `.scala`/`.ts`/`.tsx`/`.sbt` files (22 files, 34 occurrences as
  of round 3), not just scripts/docs/CI. `openspec/specs/collection-panel-type/spec.md`
  cites its 4 schemas in bare-filename form (no `schemas/` prefix, so this grep can't see
  it) — verified separately; see design.md D6 round-3 CR2 / tasks.md 1.7(b).
- `orchestration-flow.html` moved to `notes/`, alongside
  `notes/orchestration-iron-laws-handoff.md`; inbound links (grep old filename across
  `*.md` and `.claude/`) updated. (`development-plan.md` is untracked/absent — not moved;
  see revised Part 2 above.)
- Root config files and standard top-level docs untouched.
- Out of scope: HEL-637 (package README convention), HEL-802/803/804/811 (repackage
  follow-ups).

## Premise Validation

See `.concertino/runs/HEL-636/evidence/premise-validation.md` in the main checkout —
verdict `material-drift`, escalation raised and answered
`proceed-with-restated-scope`.
