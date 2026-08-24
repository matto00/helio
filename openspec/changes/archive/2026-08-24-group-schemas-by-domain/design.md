## Context

`schemas/` has 76 flat `*.schema.json` files (confirmed via `ls schemas/*.json | wc -l`
during Setup's premise-validation — the ticket's own "42 files" / bare-`.json`-filename
claims are stale; see `.concertino/runs/HEL-636/evidence/premise-validation.md`).
`scripts/check-schema-drift.mjs` is the real tripwire: it does a flat `readdirSync(schemasDir)`
at line 108 AND hardcodes 4 direct `join(schemasDir, "<file>.schema.json")` calls (lines
231/240/249/258, the panel-type-enum-parity guard) — both break silently under
subdirectories (a flat `readdirSync` on a dir of only subdirectories finds zero `.schema.json`
files and the loop simply never runs — "a checker that silently finds zero files also
passes", exactly the failure mode called out in the ticket).

The script does **not** do generic `$ref` resolution — it only JSON-parses each schema file
standalone. But schema files themselves *do* contain both bare relative `$ref`s
(`"panel-appearance.schema.json"`, some with `#/$defs/...` fragments) and `$id`-namespaced
absolute ones (`"https://helio.local/schemas/panel.schema.json"`) to each other — both
classes exist today across **17 files with 35 total cross-file `$ref` occurrences** (24
bare-relative, 11 absolute; measured by walking every schema's JSON tree and classifying
each `$ref` value, not by a flat grep, which conflates same-file `#/$defs/...` fragment
refs with genuine cross-file references), and both must be updated to the new nested
layout. Additionally, **all 76 files carry a `$id`** (verified: `grep -l '"\$id"' schemas/*.json | wc -l` → 76), but only **72 of the 76** use the absolute
`"https://helio.local/schemas/<file>.schema.json"` form — 4 files (`paginated-query-result`,
`panel-query`, `update-dashboard-request`, `update-panels-batch-response`) carry a bare
*relative* `$id` (e.g. `"$id": "panel-query.schema.json"`) instead. None of those 4 is the
target of any absolute `$ref`, and a relative `$id` remains self-consistent after the move
(it is not a path, just an opaque local identifier), so D4 rewrites all 72 absolute-form
`$id`s to their new nested path, regardless of whether that file happens to be an
absolute-`$ref` target — this is broader than strictly required (only 7 of the 72 are
actually dereferenced by an absolute `$ref` today: auto-layout-item, dashboard-layout-item,
dashboard-layout, resource-meta, dashboard-appearance, panel-appearance,
dashboard-proposal), but keeping every `$id` mirroring its file's real location is simpler
and safer than tracking which subset is currently referenced. `$id`-based resolution
(networknt in `JsonSchemaValidation`, any ajv-style loader) needs the target's `$id` to
match wherever the referrer's `$ref` points, so this lockstep rewrite is what keeps that
correct. D4's rewrite script must pattern-match on the absolute `https://helio.local/...`
form specifically and leave the 4 relative `$id`s untouched — do not assert a flat
`rewrittenIdCount === 76`.

## Goals / Non-Goals

**Goals:**
- Move all 76 `schemas/*.schema.json` files into domain subdirectories.
- Keep `check-schema-drift.mjs` passing, genuinely traversing the new tree (assert a
  non-zero, correct file count before and after).
- Keep every cross-file `$ref` (bare-relative and `$id`-absolute) resolvable.
- Keep `sbt test` green, including the 4 `JsonSchemaValidation.compile(...)` call sites
  that reference a bare filename today.
- Relocate the 2 stray root files into `notes/`.

**Non-Goals:**
- No change to schema *content* (properties, types, titles) — pure relocation.
- No change to `PanelType`/`DataPanelKinds` canonical-set parity logic in the drift
  checker — only its file-discovery and 4 hardcoded paths move.
- HEL-637 (package README convention) and HEL-802/803/804/811 — untouched.

## Decisions

**D1 — Domain mapping (re-enumerated from the live tree, not the stale ticket list).**
Ticket's 8 domains kept as vocabulary; 6 new domains added for previously-unlisted
schemas. Full 76-file mapping (moved via `git mv` to preserve history):

- `alerts/` (5): alert-event, alert-rule, create-alert-rule-request,
  update-alert-rule-request, snooze-alert-event-request
- `auth/` (8): api-token, create-api-token-request, create-api-token-response,
  mfa-enroll-response, mfa-required-response, mfa-status-response, mfa-verify-request,
  redeem-invite-code-request
- `dashboards/` (8): dashboard, dashboard-appearance, dashboard-layout,
  dashboard-layout-item, dashboard-proposal, create-dashboard-request,
  update-dashboard-request, replace-dashboard-contents-request
- `panels/` (14): panel, panel-appearance, panel-appearance-patch, panel-query,
  panel-capabilities-response, bound-panel-request, bound-panel-response,
  auto-layout-item, auto-layout-request, create-panel-request,
  create-panels-batch-request, create-panels-batch-response,
  update-panels-batch-request, update-panels-batch-response
- `pipelines/` (9): pipeline-analyze-response, pipeline-analyze-proposal-response,
  pipeline-proposal, pipeline-run-record, pipeline-schedule, pipeline-shape-catalog,
  put-pipeline-schedule-request, create-pipeline-step-request,
  reorder-pipeline-steps-request
- `hooks/` (2): hook-run-request, hook-run-response
- `workspace/` (3): workspace-context, workspace-teardown-request,
  workspace-teardown-response
- `shared/` (2): resource-meta, paginated-query-result
- `metrics/` (4, NEW): metric, create-metric-request, update-metric-request,
  metric-usage-response
- `assistant/` (6, NEW): assistant-conversation, assistant-conversation-summary,
  create-assistant-conversation-request, update-assistant-conversation-request,
  append-assistant-conversation-turn-request, converse-request
- `authoring/` (7, NEW): dashboard-authoring-request, dashboard-authoring-response,
  authoring-conversation, authoring-outcome-request, refinement-request,
  refinement-response, combined-proposal
- `patch-sets/` (4, NEW): patch-set, patch-set-apply-response,
  patch-set-preview-response, patch-set-undo-response
- `agent-memory/` (3, NEW): agent-memory, agent-preferences, put-memory-enabled-request
- `data-types/` (1, NEW): data-type-assertion-status

Total 5+8+8+14+9+2+3+2+4+6+7+4+3+1 = 76.

**D2 — check-schema-drift.mjs recursion.** Change line 108's
`readdirSync(schemasDir).sort()` to `readdirSync(schemasDir, { recursive: true }).sort()`
(Node's `recursive` option returns paths already relative to `schemasDir`, so the existing
`join(schemasDir, file)` calls keep working unchanged) and filter unchanged
(`.endsWith(".schema.json")`). Add an explicit `console.log` of the raw file count found
by the recursive walk (before the SKIP-set filtering) so a future silent zero-file pass is
visually obvious in CI output, not just implied by `checked.length`.

**D3 — 4 hardcoded panel-type-enum-parity paths.** Lines 231/240/249/258 currently
`join(schemasDir, "create-panel-request.schema.json")` etc. Update to their new relative
subpaths: `panels/create-panel-request.schema.json`, `panels/panel.schema.json`,
`panels/update-panels-batch-request.schema.json`,
`dashboards/dashboard-proposal.schema.json`.

**D4 — $ref/$id rewrite, structure-aware.** A small Node script (run once, not committed)
that: for each schema file (at its **new** post-move path), `JSON.parse`s it, walks the
tree recursing into objects/arrays, and:
- For every bare-relative `$ref` (matches `/^[\w-]+\.schema\.json(#.*)?$/`, optionally with
  a `#/$defs/...` fragment): looks up the *target* file's new domain from D1, computes
  `path.posix.relative(dirname(referrerNewPath), dirname(targetNewPath))` and prefixes the
  filename with it (empty string for a same-domain ref, which must stay bare — e.g.
  `update-dashboard-request` → `dashboard-appearance.schema.json` unchanged — and `../<domain>/`
  for a cross-domain ref — e.g. `authoring-conversation` → `dashboard-proposal.schema.json`
  becomes `../dashboards/dashboard-proposal.schema.json`). Never a flat `<domain>/<file>`
  prefix — that only happens to be correct for refs originating in `schemas/` root, which no
  longer exists once every file has moved into a domain dir.
- For every `$id` value matching the absolute `https://helio.local/schemas/<file>.schema.json`
  form (72 of the 76 files — see Context; the remaining 4 carry a bare relative `$id` and
  must be left untouched) and every absolute `$ref` of that same form: rewrite to
  `https://helio.local/schemas/<domain>/<file>.schema.json` per D1 — both the referrer's
  `$ref` *and* the target file's own `$id` move together, so `$id`-based resolution
  (networknt, ajv-style) still finds a document that declares the identifier being
  dereferenced. Do not assert a flat `rewrittenIdCount === 76`.
- `JSON.stringify`s with the same 2-space indent and writes back. This never touches file
  content via regex/line-editing (CONTRIBUTING's HEL-633 lesson) — every edit is a
  parsed-tree mutation.

**D5 — JsonSchemaValidation call sites (4 total).** `schemaFile`/`compile` themselves
take a caller-supplied relative path — no change needed inside
`testsupport/JsonSchemaValidation.scala`. Update the 4 call sites to their new paths:
`PipelineAnalyzeProposalRoutesSpec.scala:447` → `pipelines/pipeline-analyze-proposal-response.schema.json`;
`PipelineAnalyzeRoutesSpec.scala:345,365` → `pipelines/pipeline-analyze-response.schema.json`;
`WorkspaceContextServiceSpec.scala:153` → `workspace/workspace-context.schema.json`.

**D6 — live doc/spec/source references to specific filenames (revised, round 2 CR1 — full
inventory, explicit scope decision).** Files referencing the generic `schemas/` directory
(README.md, CONTRIBUTING.md, CLAUDE.md, openspec/config.yaml, notes/mobile-pwa-handoff.md)
need no change. Every file citing a *specific* flat `schemas/<file>.schema.json` path is in
scope for this sweep — decision: **sweep all of them**, including source-code comments, not
just docs/specs/CI (they are mechanical, zero-risk edits, and leaving them stale
re-creates the exact "find the contract for a given domain" problem this ticket exists to
fix). Full inventory, independently re-measured (structure-aware `rg` over
`*.scala`/`*.ts`/`*.tsx`/`*.sbt`, excluding `node_modules` and `schemas/` itself):

- **11 live `openspec/specs/**/spec.md` files** (not 10 — round 1 missed
  `openspec/specs/collection-panel-type/spec.md:81-82`, which cites
  `create-panel-request.schema.json`, `panel.schema.json`,
  `update-panels-batch-request.schema.json`, `dashboard-proposal.schema.json` — exactly
  D3's 4-file panel-type-enum-parity set): `chart-type-display-config`,
  `mcp-panel-composition-tools`, `panel-creation-type-config`, `patch-set-contract`,
  `panel-viz-aggregation`, `pipeline-analyze-api` (including its embedded OpenAPI YAML
  `$ref: "../../schemas/pipeline-analyze-response.schema.json"` at line 31 — a real
  relative-path `$ref` outside `schemas/` itself, must become
  `"../../schemas/pipelines/pipeline-analyze-response.schema.json"`),
  `pipeline-proposal-contract`, `timeline-panel-type`, `table-panel-display-config`,
  `workspace-context-assembly`, `collection-panel-type`. `openspec/changes/archive/**`
  files are historical records of already-shipped changes — explicitly not touched.
  **`collection-panel-type/spec.md:81-82` is a special case (round 3 CR2):** it cites the 4
  panel-type-parity schemas in *bare* filename form (`create-panel-request.schema.json`,
  not `schemas/create-panel-request.schema.json`) — the sweep's own verification pattern
  `schemas/[a-zA-Z0-9_-]+\.schema\.json` cannot match a bare citation. Decision: **in scope,
  get a domain prefix** (`panels/create-panel-request.schema.json`, etc. — consistent with
  every other reference in this sweep, not left as a dangling bare name). Verified with a
  second, separate command scoped to this one known file/line range rather than a broad
  `openspec/specs/**` bare-filename grep (which would over-match ordinary prose like
  "the `Dashboard` type"): `rg -n '\.schema\.json' openspec/specs/collection-panel-type/spec.md`
  must, after the edit, show each of the 4 names already carrying its `panels/`/`dashboards/`
  prefix — see tasks.md 1.7/3.3.
- **22 source files, 34 literal-path occurrences** (comments/doc-strings only — no
  runtime behavior reads these paths; `scripts/check-schema-drift.mjs` itself carries 4
  further occurrences, handled by D2/D3 rather than this sweep — that's the source of the
  raw `rg -l ... | wc -l` = 23 / `rg -o ... | wc -l` = 38 an executor will actually see):
  `frontend/src/features/pipelines/types/pipelineSchedule.ts` (4),
  `frontend/src/features/panels/types/panel.ts` (4),
  `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` (4),
  `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` (2, D5's call site),
  `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` (2),
  `backend/src/main/scala/com/helio/api/protocols/patchsets/PatchSetProtocol.scala` (2),
  and 16 files with 1 each: `helio-mcp/src/types.ts`, `helio-mcp/src/tools/proposal.ts`,
  `docs/agent-native.md`, `frontend/src/features/settings/types/preferences.ts`,
  `frontend/src/features/settings/types/agentMemory.ts`,
  `frontend/src/features/patchSets/types/patchSet.ts`,
  `frontend/src/features/dashboards/types/proposal.ts`,
  `backend/src/test/scala/com/helio/domain/panels/PanelBindingSpecSpec.scala`,
  `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` (D5),
  `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` (D5),
  `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringPrompt.scala`,
  `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`,
  `backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala`,
  `backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala`,
  `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala`,
  `backend/build.sbt`. (D5's 4 `.compile(...)` call sites are executable path arguments and
  overlap this list — updating them satisfies both D5 and D6 for those lines.)

**D7 — root file moves (revised — `development-plan.md` is not a trackable file).**
`development-plan.md` is **not present in this worktree and not tracked by git**
(`git ls-files development-plan.md` returns nothing); in the main checkout it resolves via
`git check-ignore -v development-plan.md` → `.git/info/exclude:7:development-plan.md` — a
deliberately, locally git-ignored file (not `.gitignore`, so not even repo-visible as an
ignore rule). `git mv` cannot move an untracked file that additionally doesn't exist on
disk in this worktree; no commit in this change can deliver that half of the requester's
ask. Part 2 is therefore reduced to: `git mv orchestration-flow.html
notes/orchestration-flow.html` (co-locating with `notes/orchestration-iron-laws-handoff.md`,
per the requester's own stated preference), plus grepping `*.md` and `.claude/` for both
old filenames and fixing any inbound links to `orchestration-flow.html` found. The
`development-plan.md` AC is recorded as unachievable-as-stated here rather than silently
dropped — the same treatment Setup's premise-validation gave the schemas/ file-count drift.

## Risks / Trade-offs

- [Risk] A `$ref` variant not covered by D4's rewrite (e.g. a `$ref` nested inside a
  `$defs` block under an unexpected key name) silently stays stale or resolves to the wrong
  path. → Mitigation: a leftover-single-segment-filename grep is **not sufficient** — a
  cross-domain ref rewritten to the wrong relative prefix (e.g. `dashboards/...` instead of
  `../dashboards/...`) still contains a `/` and would pass such a grep undetected. Instead,
  after rewrite, walk every schema file's `$ref` values again and, for each bare-relative
  one, resolve it with `path.resolve(dirname(referrerPath), refPath.split("#")[0])` and
  assert the resolved file exists on disk — a real filesystem-existence check, not a string
  pattern. Also re-run `check-schema-drift.mjs` (round-trips every schema through
  `JSON.parse`, catching malformed JSON structurally).
- [Risk] Executor mutates the wrong artifact when proving the drift-checker's before/after
  file-count assertion (evidence-shaped non-evidence per the requester's own warning).
  → Mitigation: the before/after count must be captured by literally running
  `node scripts/check-schema-drift.mjs` (or a one-line count probe against the same
  `readdirSync` call) against the real `schemas/` tree at each point, output pasted into
  the evaluation report — never inferred from `git mv`'s own output.
- [Risk] CI-timing false-positive on the auditor's merge-readiness check (documented
  constraint — CI here runs ~7+ minutes). → Mitigation: known, already flagged to the
  orchestrator's human; not re-litigated here.

## Gate-Chain Implications Checklist

`scripts/check-schema-drift.mjs` is invoked directly by `.husky/pre-commit` via
`npm run check:schemas` — this change touches the gate chain (CON-132).

- **What does it execute?** A pure Node script: reads `schemas/**/*.schema.json` and
  `backend/src/main/scala/com/helio/**` source files (read-only), computes set
  differences, exits non-zero with a diagnostic on drift, exits 0 with a summary line on
  success. No subprocess spawning, no network access.
- **What environment does it inherit, and from where?** Whatever `node` invokes it with
  under `npm run check:schemas`, itself invoked by `.husky/pre-commit` in the committer's
  own shell — same as today; this change does not alter its invocation, only its internal
  file-discovery logic (D2/D3).
- **Does it write anything outside its own sandbox?** No — it is read-only against the
  repo tree; it only writes to stdout/stderr and sets its own exit code. Unchanged by
  this ticket.
- **Does it behave differently from a linked worktree than from a main checkout?** No —
  it resolves all paths via `import.meta.url`-relative joins against the repo root it's
  running inside, which is correct in either a worktree or the main checkout (a worktree
  has its own full working tree, not a symlink). Unchanged by this ticket.
- **What happens on its first run?** It must find and check all 76
  relocated schema files (via D2's recursive `readdirSync`) — this is exactly what the
  ticket's own acceptance criteria requires being asserted (non-zero, correct count)
  rather than assumed.

## Planner Notes

- No new/modified openspec capability: this is a pure relocation, no system-behavior
  change, so `proposal.md`'s Capabilities section is empty and no spec deltas are needed.
  This is the same situation as the epic-sibling precedent
  `openspec/changes/archive/2026-08-22-repackage-backend-domain-subpackages` (HEL-633):
  `openspec validate` will report `Change must have at least one delta` for this change —
  **expected, not a defect**, per that precedent's own `proposal.md:49`. Archive this
  change with `--skip-specs`; do not treat the validate error as a gate failure to fix.
- Domain mapping (D1) is a self-approved decision, not escalated — it is direct,
  mechanical extension of the ticket's own stated vocabulary onto the measured tree, not
  a new architectural choice.
