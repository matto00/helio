## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

All commands run in the worktree root.

**CR1 — spec-file inventory (11 files). RESOLVED, accurate.**
- `rg -l 'schemas/[a-zA-Z0-9_-]+\.schema\.json' openspec/specs/ | wc -l` → **10**
  (chart-type-display-config, mcp-panel-composition-tools, panel-creation-type-config,
  panel-viz-aggregation, patch-set-contract, pipeline-analyze-api,
  pipeline-proposal-contract, table-panel-display-config, timeline-panel-type,
  workspace-context-assembly).
- `rg -l '[a-z0-9-]+\.schema\.json' openspec/specs/` → **11**, the extra being
  `collection-panel-type/spec.md`. `rg -n 'schema\.json' openspec/specs/collection-panel-type/spec.md`
  → lines **81–82** only, citing exactly `create-panel-request`, `panel`,
  `update-panels-batch-request`, `dashboard-proposal` — i.e. D6's claim (11 files, the 11th
  being collection-panel-type at 81-82 with D3's 4-file set) is **independently confirmed
  correct**. It is cited in *bare* filename form (no `schemas/` prefix), which is why the
  prefixed grep finds 10 — see CR2 below.

**CR1 — source-file inventory. NOT resolved: the stated totals contradict D6's own list.**
Per-file occurrence counts (`rg -o` per file, globs `!node_modules !openspec/** !schemas/**`):
```
4 scripts/check-schema-drift.mjs           <- D2/D3's own file, counted separately
4 frontend/src/features/pipelines/types/pipelineSchedule.ts
4 frontend/src/features/panels/types/panel.ts
4 backend/.../assistant/AssistantProposalToolSchemas.scala
2 backend/.../workspace/WorkspaceContextServiceSpec.scala
2 backend/.../workspace/WorkspaceContextProtocol.scala
2 backend/.../patchsets/PatchSetProtocol.scala
1 x 16 further files
```
Totals excluding `check-schema-drift.mjs`: **22 files, 34 occurrences**
(`rg -l ... | wc -l` → 23 and `rg -o ... | wc -l` → 38, minus that one file's 4).
D6 states "**21 source files, 32 literal-path occurrences**" — but D6's *own enumeration*
lists 6 files with explicit counts (4+4+4+2+2+2 = 18) plus a group labelled "15 files with 1
each" that actually contains **16** entries → 22 files / 34 occurrences. The enumerated set
itself is **complete and exactly matches the live tree** (no file missing, no phantom); only
the two headline numbers are off by one file / two occurrences, and that wrong pair is
propagated verbatim into `tasks.md` 1.6 and the ticket's AC bullet. This is the same
count-inconsistency defect class round 2's CR1 was raised to close.

**CR2 — rg scope. Explicit and consistent, with one uncovered item.**
`tasks.md` 1.7 and 3.3 and the ticket AC now all carry the identical pattern
`schemas/[a-zA-Z0-9_-]+\.schema\.json` with `!node_modules` / `!openspec/changes/archive/**`
and an explicit "sweep all, including source comments" decision — the ambiguity from round 2
is gone. Verified the pattern behaves as intended post-move: `[a-zA-Z0-9_-]+` cannot match
`/`, so `schemas/panels/panel.schema.json` correctly yields no match. **However**, that
pattern cannot ever match `openspec/specs/collection-panel-type/spec.md:81-82` (bare
filenames, no `schemas/` prefix), so the "zero matches" gate does not verify the 11th spec
file D6 puts in scope — and D6 does not say what "update" means for a bare-filename prose
citation.

**Non-blocking fix 1 — `$id` forms. Accurate.**
`grep -L '"\$id": "https://helio.local/schemas/' schemas/*.schema.json` → exactly 4:
`panel-query`, `update-dashboard-request`, `update-panels-batch-response`,
`paginated-query-result`. 76 − 4 = 72 absolute-form. Matches design.md Context + D4 exactly.
Also confirmed via a structure-aware walk that none of those 4 is the target of any absolute
`$ref` (`abs ref targets` = auto-layout-item, dashboard-appearance, dashboard-layout-item,
dashboard-layout, dashboard-proposal, panel-appearance, resource-meta; overlap = ∅), so
"leave those 4 untouched" is safe.

**Non-blocking fix 2 — proposal.md Impact wording.** Impact now reads "(The script does not
itself perform `$ref` resolution.)", matching the What-Changes bullet and design Context.
Consistent.

**Round 1 / round 2 confirmed findings — all still intact:**
- D1: parsed the D1 section and set-diffed against `ls schemas/` → 76 files listed, `MISSING
  from D1: []`. Arithmetic 5+8+8+14+9+2+3+2+4+6+7+4+3+1 = 76 checks out.
- D2: `sed -n '106,110p' scripts/check-schema-drift.mjs` → `for (const file of
  readdirSync(schemasDir).sort())` at line 108 with `.endsWith(".schema.json")` filter and
  `join(schemasDir, file)` — D2's recursive-option plan is correct against the real code.
- D3: lines 231/240/249/258 confirmed as the 4 `readFileSync(join(schemasDir, "<file>"))`
  panel-type-parity calls, filenames exactly as D3 names them.
- D4 relative-path logic: 24 bare-relative cross-file `$ref`s measured structure-aware,
  matching design's "24 bare-relative"; the `../<domain>/` vs same-domain-bare rule is sound.
- D5: `compile("workspace-context.schema.json")` at WorkspaceContextServiceSpec.scala:153;
  `compile("pipeline-analyze-response.schema.json")` at PipelineAnalyzeRoutesSpec.scala:345
  and :365; `compile("pipeline-analyze-proposal-response.schema.json")` at
  PipelineAnalyzeProposalRoutesSpec.scala:447 — all 4 line numbers exact.
- D7: `ls development-plan.md` → No such file; `git ls-files development-plan.md` → empty;
  `git ls-files orchestration-flow.html` → tracked. D7/tasks 2.1–2.3 remain correct.
- openspec-validate precedent (`--skip-specs`, HEL-633 sibling) unchanged in proposal.md
  and Planner Notes.

### Verdict: REFUTE

Narrow. The substance of the design is sound and the round-2 enumerations are, as lists,
correct and complete. But the headline counts still disagree with the enumeration they
summarize, in all three artifacts — precisely what CR1 asked to fix.

### Change Requests

1. **Fix the source-inventory totals (design.md D6, tasks.md 1.6, ticket.md AC bullet).**
   The true figures, re-derived from the live tree, are **22 files / 34 occurrences**, not
   21 / 32. D6's own bullet list already contains 22 paths — the group introduced as "15
   files with 1 each" holds 16 entries (helio-mcp/src/types.ts, helio-mcp/src/tools/proposal.ts,
   docs/agent-native.md, preferences.ts, agentMemory.ts, patchSet.ts,
   dashboards/types/proposal.ts, PanelBindingSpecSpec.scala, PipelineAnalyzeRoutesSpec.scala,
   PipelineAnalyzeProposalRoutesSpec.scala, DashboardAuthoringPrompt.scala,
   PipelineService.scala, PanelBindingSpec.scala, DashboardProposalProtocol.scala,
   PipelineProposalProtocol.scala, backend/build.sbt). Change "21 source files, 32
   literal-path occurrences" → "22 source files, 34 literal-path occurrences" and relabel
   "15 files with 1 each" → "16 files with 1 each" in design.md D6; the same "21 / 32" pair
   appears in tasks.md 1.6 and in ticket.md's `rg` AC bullet ("21 files, 32 occurrences as
   of round 2") and must be updated in lockstep so an executor working from the number
   rather than the list cannot stop one file short. (Optionally note that
   `scripts/check-schema-drift.mjs` carries 4 further occurrences of its own, handled by
   D2/D3 rather than by the D6 sweep — that is the source of the 23-file/38-occurrence raw
   `rg` figure an executor will actually see.)

2. **State explicitly how the bare-filename spec citations are handled, and how they are
   verified (design.md D6 + tasks.md 1.7/3.3).** `openspec/specs/collection-panel-type/spec.md:81-82`
   cites `create-panel-request.schema.json` / `panel.schema.json` /
   `update-panels-batch-request.schema.json` / `dashboard-proposal.schema.json` **without**
   a `schemas/` prefix, so the sweep's own verification pattern
   `schemas/[a-zA-Z0-9_-]+\.schema\.json` provably cannot match it — "zero matches" would be
   reported while D6's 11th in-scope file was never touched. Decide and record one of:
   (a) these are prose *names*, not paths, and are out of scope (then drop
   collection-panel-type from D6's 11 and say the live-spec count for the sweep is 10, with
   the 11th called out as deliberately excluded); or (b) they are in scope and get a
   `<domain>/` prefix (then add a second, explicit verification command to tasks 1.7/3.3 that
   actually covers bare-filename citations in `openspec/specs/**`, e.g. an `rg` for
   `[a-z0-9-]+\.schema\.json` there with the expected residue enumerated). Either is fine;
   the current text asserts scope the gate cannot check.

### Non-blocking notes

- design.md D4/Context says "the **8** distinct files that are targets of the 11 absolute
  refs (… , panel)". A structure-aware walk of every schema's `$ref` values gives **7**
  distinct absolute-ref targets: auto-layout-item, dashboard-appearance, dashboard-layout-item,
  dashboard-layout, dashboard-proposal, panel-appearance, resource-meta. `panel.schema.json`
  is not among them. Harmless (its `$id` is absolute-form and is rewritten regardless under
  the 72-file rule), but the "8" is one too many.
- design.md D6 labels `WorkspaceContextServiceSpec.scala` as "(2, D5's call site)". The 2
  `schemas/`-prefixed occurrences are actually comments at lines 157 and 675; the D5 call
  site at :153 is a *bare* filename argument and is not one of the 2. Same shape for
  `PipelineAnalyzeRoutesSpec.scala` (1 comment hit at :329; the D5 calls at :345/:365 are
  bare). Both files are correctly in scope and both D5 and D6 cover the right lines — only
  the parenthetical attribution is loose.
