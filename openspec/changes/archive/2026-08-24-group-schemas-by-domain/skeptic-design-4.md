## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

All counts below were re-derived from the live tree in this worktree, not read from any artifact.

**Round-3 CR1 — source-inventory counts (RESOLVED).**
`rg -l/-o 'schemas/[a-zA-Z0-9_-]+\.schema\.json'` (hidden on; excluding `node_modules`,
`schemas/**`, `openspec/**`, `.git/**`) returns **23 files / 38 occurrences** raw. Subtracting
`scripts/check-schema-drift.mjs` (1 file, 4 occurrences, handled by D2/D3) gives exactly
**22 files / 34 occurrences** — matching D6's corrected headline, tasks.md 1.6, and the
ticket AC. The per-file breakdown also matches item-for-item: the three 4-occurrence files
(`pipelineSchedule.ts`, `panel.ts`, `AssistantProposalToolSchemas.scala`), the three
2-occurrence files (`WorkspaceContextServiceSpec.scala`, `WorkspaceContextProtocol.scala`,
`PatchSetProtocol.scala`), and **16** 1-occurrence files — I counted the 1-each group
independently and got 16, identical to D6's enumerated 16. CR1 is genuinely fixed.

**Round-3 CR2 — collection-panel-type bare citations (RESOLVED).**
`rg -n '\.schema\.json' openspec/specs/collection-panel-type/spec.md` returns exactly two
lines (81, 82) carrying the four bare names `create-panel-request`, `panel`,
`update-panels-batch-request`, `dashboard-proposal`. That is a real, narrow, deterministic
verification command: today it shows four un-prefixed names; after the edit it must show
`panels/…` ×3 and `dashboards/dashboard-proposal…`. tasks.md 1.7(b) and 3.3 both invoke it,
and D6 states the scope decision (in scope, gets a domain prefix) explicitly. Verifiable as
written.

**Spec-file count (11) still holds.** `rg -l 'schemas/[a-z…]\.schema\.json' openspec/specs`
returns **10** files, exactly D6's prefixed list; plus `collection-panel-type` (bare) = 11.
The embedded OpenAPI ref is confirmed at `openspec/specs/pipeline-analyze-api/spec.md:31`:
`$ref: "../../schemas/pipeline-analyze-response.schema.json"`.

**D1 (76-file mapping) — re-checked as a set bijection.** Parsed all names out of D1 and
diffed against `ls schemas/`: 76 mapped, 76 unique, 76 on disk, **zero** in-map-not-on-disk
and zero on-disk-not-in-map. Domain subtotals sum to 76.

**D2/D3 line numbers.** `scripts/check-schema-drift.mjs:108` is
`for (const file of readdirSync(schemasDir).sort()) {`; the four hardcoded
`join(schemasDir, "<file>.schema.json")` reads sit at 231/240/249/258 for
create-panel-request / panel / update-panels-batch-request / dashboard-proposal. Unchanged.

**D4 ref/$id facts.** Structure-aware walk of all 76 schemas (recursing objects/arrays,
classifying each `$ref`): **17 files, 35 cross-file refs — 24 bare-relative, 11 absolute**.
`$id`s: **72 absolute** `https://helio.local/schemas/…`, **4 relative** — exactly
`paginated-query-result`, `panel-query`, `update-dashboard-request`,
`update-panels-batch-response`, as Context names. The walk printed **no** unclassified
`$ref` form, so D4's two-class rewrite is exhaustive over today's tree. Absolute-`$ref`
**targets are exactly 7**: auto-layout-item, dashboard-layout-item, dashboard-layout,
resource-meta, dashboard-appearance, panel-appearance, dashboard-proposal — confirming
round 3's non-blocking note was correctly applied (`panel.schema.json` rightly dropped).

**D5 call sites.** Confirmed at `PipelineAnalyzeProposalRoutesSpec.scala:447`,
`PipelineAnalyzeRoutesSpec.scala:345` and `:365`, `WorkspaceContextServiceSpec.scala:153`.

**D7.** `git ls-files development-plan.md` → empty; `ls development-plan.md` → no such file.
`orchestration-flow.html` is tracked at repo root. Grep for inbound `orchestration-flow.html`
links across `*.md`/`.claude/` finds hits only inside this change's own artifacts — nothing
real to fix, consistent with task 2.3 being a defensive grep.

**openspec-validate precedent.** Planner Notes' `--skip-specs` / "no delta is expected"
carry-over from the HEL-633 archive precedent is unchanged from rounds 1–3.

### Verdict: CONFIRM

Both round-3 change requests are genuinely resolved against ground truth, and every
previously-confirmed finding (D1 bijection, D2/D3 line numbers, D4 ref/$id classification
and the corrected 7-target list, D5 call sites, D7, the 11-spec inventory) still reproduces
exactly. The plan is sound enough to implement. Nothing blocking remains — the substance is
correct and I am not manufacturing a further nit to extend this gate.

### Non-blocking notes

- D6's closing parenthetical ("D5's 4 `.compile(...)` call sites are executable path
  arguments and overlap this list") is loose: those `compile("…schema.json")` arguments are
  *bare* filenames, so they are not among the 34 `schemas/`-prefixed occurrences — the
  *files* overlap, the *lines* do not. No coverage gap results (task 1.5 handles those four
  lines independently of the 1.6 sweep), so this is wording only.
- D6 describes its `rg` scope as `*.scala`/`*.ts`/`*.tsx`/`*.sbt`, yet correctly includes
  `docs/agent-native.md` and `helio-mcp/src/*.ts` in the list. The enumerated list is right;
  the scope sentence understates it.
