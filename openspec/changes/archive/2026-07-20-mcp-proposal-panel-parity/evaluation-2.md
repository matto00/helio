## Evaluation Report — Cycle 2

Re-evaluation after the executor's round-2 fix (commit `6411aa55` on top of the unchanged `b3d66d4c`)
addressing the cycle-1 final-gate skeptic's REFUTE (`skeptic-final-1.md`): a live-proven V41 bypass
where a `text`/`markdown` panel's `config.dataTypeId` could bind a source-companion DataType with no
validation.

### Phase 1: Spec Review — PASS
Issues: none.

- All four skeptic change requests addressed: (CR1) the gap closed at the shared root
  (`PanelServiceHelpers.dataTypeIdFromCreateConfig` now covers `TextCreate`/`MarkdownCreate`) plus a
  proposal-layer pre-flight (`DashboardProposalService.preValidateBindings` / new `bindingCandidate`);
  (CR2) new regression tests at both layers; (CR3) the previously-unconditional "config can never
  bypass V41" claims corrected in `design.md`, backend doc comments, the JSON-schema `config`
  description, and the MCP tool descriptions/types; (CR4, the pre-existing direct-path hole) resolved
  as a side effect of the shared-root fix rather than deferred to a spinoff, and the executor's
  reasoning for not spinning off a separate ticket (the fix already covers it) is sound.
- `tasks.md` section 6 (6.1–6.5) accurately describes and marks done exactly what was implemented;
  5.2/5.3 remain correctly unchecked for the evaluator.
- No scope creep beyond what round-2 needed to close the V41 gap.
- `design.md` D3a and the updated Risks/Trade-offs section reflect the final implemented behavior and
  correctly scope the guarantee: `DataPanelKinds` via flat-field re-apply, text/markdown via
  independent pre-flight + create-time validation — both equally strict, no unconditional overclaim
  remains anywhere in the diff.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **V41 fix confirmed complete and correct — the primary scrutiny item.**
  - `PanelServiceHelpers.scala:147-156` (`dataTypeIdFromCreateConfig`): `TextCreate`/`MarkdownCreate`
    now extract `dataTypeId` alongside the bound trio + collection, feeding `PanelService.create`'s
    `rejectCompanionBinding` (`PanelService.scala:126`) — which runs for **every** create caller
    (direct `POST /api/panels`, `create_panel`, `apply_proposal`), so this is the shared-root fix, not
    a proposal-layer patch.
  - `DashboardProposalService.scala:87-138` (`preValidateBindings` / `bindingCandidate` /
    `nonFlatConfigDataTypeId`): the proposal's up-front atomicity guarantee ("nothing created on a bad
    binding") now also inspects a non-`DataPanelKinds` panel's `config.dataTypeId`, not just the flat
    field — matching the same pipeline-output-ownership check already used for the bound trio.
  - Read `mergeConfig`'s updated doc comment (`DashboardProposalService.scala:206-220`): now correctly
    states it makes **no** binding-safety guarantee for text/markdown by itself — that guarantee comes
    from the two independent validation points above. Accurate, not overclaiming.
  - Fresh full backend suite: `sbt -batch test` → **1412/1412 pass** (up from 1405 in cycle 1, +7 new:
    2 in `PanelServiceCompanionBindingGuardSpec`, 5 in `DashboardApplyProposalSpec`).
  - **Live re-probe of the exact skeptic repro**, against the worktree's running backend
    (`localhost:8396`), reusing the identical companion DataType (`skeptic-src`,
    `97513324-0475-4e65-8f5e-3166f520fa7b`) the skeptic used:
    ```
    POST /api/dashboards/apply-proposal
    {"panels":[{"title":"Rogue Text","type":"text","config":{"dataTypeId":"97513324-...skeptic-src"}}]}
    → 400 {"message":"panel 'Rogue Text': panels can only bind to pipeline-output data types"}
    ```
    (was 201 in cycle 1 — confirmed fixed, not just test-covered.)
  - **No regression to the intended v1.5 surface**: the identical shape against a valid
    pipeline-output DataType (`skeptic-output`) → **201**, panel persisted with `config.dataTypeId`
    set correctly — text/markdown DataType binding still works.
  - **No regression to `DataPanelKinds`**: re-ran the cycle-1 "config attempts to override dataTypeId"
    scenario for a metric panel live — flat `dataTypeId` still wins, companion `config.dataTypeId`
    still silently ignored, still 201.
  - **Confirmed the fix reaches the direct `POST /api/panels` path too** (closing CR4 live, not just
    by code inspection): a direct panel-create call with `type=text` and a companion
    `config.dataTypeId` → **400** `"Panels can only bind to pipeline-output data types"`.
- New regression tests are meaningful and correctly mirror the existing metric-panel pattern:
  `PanelServiceCompanionBindingGuardSpec` (unit-level, direct `PanelService.create`) and
  `DashboardApplyProposalSpec` (route-level, real RLS-enforced route tree) both cover reject-companion
  and succeed-valid-binding for text AND markdown, plus an unknown-DataType-id case.
- Doc corrections read as intended: `design.md` D2/D3 now scope the "flat wins" claim to
  `DataPanelKinds` only, and new D3a documents the round-2 fix per `systematic-debugging` (fix the
  cause, not the symptom). `schemas/dashboard-proposal.schema.json`'s `config` description,
  `helio-mcp/src/types.ts`, and `helio-mcp/src/tools/proposal.ts` tool descriptions were all updated
  in lockstep — no stale "unconditional" claim remains anywhere I checked.
- Fresh gates re-run (not trusting the executor's report): `sbt -batch test` → 1412/1412;
  `npx openspec validate mcp-proposal-panel-parity` → valid; `node scripts/check-schema-drift.mjs` →
  clean, 7 surfaces (unaffected by round 2, no panel-type-enum edits this round); `cd helio-mcp && npm
  run build` → exit 0; `npm run lint` → 0 warnings; `npm run check:scala-quality` → clean (44
  pre-existing soft warnings, same count as cycle 1, no new failures).
- File-size note (non-blocking): `DashboardApplyProposalSpec.scala` grew to 647 lines, past
  CONTRIBUTING.md's ~400-line "propose a split" threshold (soft, informational —
  `check:scala-quality` still exits 0). The executor flagged this explicitly in `files-modified.md`
  with a reasoned justification (tight before/after pairing with the skeptic's exact repro; codebase
  precedent for much larger test files, e.g. `ApiRoutesSpec.scala` at 4094 lines) rather than silently
  growing the file. Acceptable for this cycle; see Non-blocking Suggestions.

### Phase 3: UI Review — PASS
Issues: none.

Servers re-confirmed healthy via the canonical script (`assert-phase.sh servers` → `PASS servers`,
DEV_PORT=5489 / BACKEND_PORT=8396 — the executor's round-2 backend restart was still live).

- Re-verified the shared-write-path in-app Proposal Review UI round-trip with fresh evidence (the
  backend changed since cycle 1's check): navigated to `/proposals/review`, the flat-field-only demo
  proposal (3 panels: metric/chart/table) loaded correctly, clicked "Accept & create" — navigated to
  `/`, dashboard created successfully, zero console errors. No regression to the shared write path
  from the round-2 backend changes.
- No console errors in any flow tested (live MCP-style curl probes + browser UI check).
- Test dashboards/panels created during this evaluation (cycle-1 leftovers were already cleaned;
  cycle-2 probe dashboards "Eval Reprobe V41 Text Bypass" — rejected, nothing created — "Eval Reprobe
  Valid Text Binding" and "Eval Direct Path Probe") were deleted after verification.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider a follow-up ticket to split `DashboardApplyProposalSpec.scala` (647 lines) once this
  ticket lands, per CONTRIBUTING.md's ~400-line soft threshold — not blocking given the codebase's
  existing precedent for large, cohesive test files and the value of keeping the round-1/round-2 V41
  regression tests colocated for now.
