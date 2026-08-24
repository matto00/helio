## 1. schemas/ regrouping

- [x] 1.1 Create domain subdirectories under `schemas/` per design.md D1 and `git mv`
      each of the 76 `*.schema.json` files into its domain dir (preserve git history).
      Assert `ls schemas/*/*.schema.json | wc -l` == 76 after.
- [x] 1.2 Run the structure-aware `$ref` rewrite (design.md D4) across every moved
      schema file — bare relative refs and `https://helio.local/schemas/...` absolute
      refs both updated to the new nested path. Re-`JSON.parse` every file afterward to
      confirm well-formed output (never regex/line-edit the JSON).
- [x] 1.3 Update `scripts/check-schema-drift.mjs`: line 108 recursive `readdirSync`
      (D2) + the 4 hardcoded panel-type-enum-parity paths (D3). Add the raw
      pre-filter file-count log line.
- [x] 1.4 Capture and record (in the eventual PR/evaluation evidence) the actual
      `node scripts/check-schema-drift.mjs` output showing the real file count seen,
      both to prove it isn't silently finding zero files and as the acceptance-criteria
      assertion the ticket calls for explicitly.
- [x] 1.5 Update the 4 `JsonSchemaValidation.compile(...)` call sites (design.md D5):
      `PipelineAnalyzeProposalRoutesSpec.scala:447`, `PipelineAnalyzeRoutesSpec.scala:345,365`,
      `WorkspaceContextServiceSpec.scala:153`.
- [x] 1.6 Update every specific-filename reference enumerated in design.md D6 (revised,
      round 3): all 11 live `openspec/specs/**/spec.md` files (including
      `collection-panel-type/spec.md:81-82`, which cites its 4 schemas in BARE filename
      form — add a domain prefix there too, per D6's round-3 CR2 resolution — and the
      embedded OpenAPI `$ref` in `pipeline-analyze-api/spec.md`) AND all 22 source files /
      34 occurrences (`.scala`/`.ts`/`.tsx`/`.sbt` comments — sweep decision, not just
      docs/specs/CI; see D6's full file list; `check-schema-drift.mjs`'s own 4 occurrences
      are handled by task 1.3, not here). Do not touch `openspec/changes/archive/**`.
- [x] 1.7 Two verification commands (design.md D6 round-3 CR2 — the prefixed pattern
      cannot see bare-filename citations, so a second command is required):
      (a) `rg -n 'schemas/[a-zA-Z0-9_-]+\.schema\.json' --glob '!node_modules' --glob
      '!openspec/changes/archive/**'` — confirm zero remaining flat-path occurrences
      anywhere (scripts, docs, specs, AND source comments — the explicit sweep-all
      decision from D6/task 1.6, not scoped down to "scripts, docs, CI" only);
      (b) `rg -n '\.schema\.json' openspec/specs/collection-panel-type/spec.md` — confirm
      each of the 4 cited names now carries its domain prefix (`panels/create-panel-request...`
      etc.), since (a)'s pattern cannot match this file's bare-filename citations.

## 2. Repo-root tidy

- [x] 2.1 `git mv orchestration-flow.html notes/orchestration-flow.html`
- [x] 2.2 `development-plan.md` is NOT a tracked file (locally git-ignored via
      `.git/info/exclude`, absent from this worktree) — do not attempt to move it; this
      half of the original ticket's ask is unachievable as stated (design.md D7). Skip.
- [x] 2.3 Grep `*.md` and `.claude/` for `orchestration-flow.html`; update any inbound
      links. (No `development-plan.md` grep needed — nothing moved.)

## 3. Verification

- [x] 3.1 `node scripts/check-schema-drift.mjs` passes, file count asserted (task 1.4).
- [x] 3.2 `sbt test` green (schema-validation specs included).
- [x] 3.3 Both task-1.7 verification commands re-run clean: the prefixed-pattern sweep
      returns zero matches, AND `collection-panel-type/spec.md`'s 4 bare citations now carry
      their domain prefix.
- [x] 3.4 Confirm root config files and standard top-level docs untouched
      (`git status` shows only the two moved files + `schemas/` restructuring).
- [x] 3.5 `npm run check:schemas` (the exact pre-commit invocation) passes standalone,
      not just via full `sbt test`/`npm test` — this is the literal gate-chain script.
