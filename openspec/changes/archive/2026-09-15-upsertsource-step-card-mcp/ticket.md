# HEL-1102: Step card UI and MCP surface for `upsertsource`

## Description

Step card in the pipeline editor with target picker and mode toggle, plus the MCP tool wiring. Follow the op-wiring checklist: apply/infer parity, `allowedOps`, StepCard.

**AC:** an agent can add an `upsertsource` step without the UI, and the UI renders a step the agent created.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Context (parent epic HEL-1098, siblings)

- HEL-1098 (epic): `upsertsource` — a terminal pipeline step that writes its input to a `dataset`
  source, `append` or `replace`. Targets datasets only.
- HEL-1099 (Done, #657): config model — `target: {kind:"newSource",name} | {kind:"existingSource",dataSourceId}`,
  `mode: "append"|"replace"`. Write-path validation rejects malformed config. Read-path decoding
  tolerates absent `target`/`mode` (incomplete draft). Ownership check on an existing-source target
  resolves "not found" identically for nonexistent vs. other-tenant-owned (no cross-tenant oracle).
- HEL-1101 (Done, #658): validation-time cycle detection (direct + transitive across pipelines,
  scoped to the caller's visible graph, serialized against concurrent edge-adding writes). Rejection
  names the cycle.
- HEL-1100 (Done, #659): engine implementation (append preserves rows, replace swaps atomically,
  failed write fails the run) AND registers `upsertsource` in `PipelineStep.Registry` /
  `PipelineStepKind.All` (registry-derived allow-list — no separate allow-list edit needed anywhere).
  Also introduced the frontend's interim "Unsupported step" read-only notice
  (`unsupportedOpType`/`isUnsupportedOpType` in `stepNarrowing.ts`, dispatched from
  `StepOpEditor.tsx`) for any step kind the frontend doesn't yet recognize — **this ticket removes
  that interim notice for `upsertsource` specifically only**, leaving it in place as the general
  fallback mechanism for any future not-yet-supported kind.

## Scope (this ticket)

1. **Frontend StepCard editor** for `upsertsource`:
   - Add an `OP_TYPES` entry (op-wiring checklist: picker/add-step menu).
   - New `UpsertSourceConfig.tsx` editor: target picker (existing dataset the caller can write to,
     OR "create new source" with a name field) + mode toggle (`append`/`replace`).
   - Wire into `StepOpEditor.tsx`'s dispatch ladder, ahead of the `isUnsupportedOpType` fallback for
     this kind specifically.
   - Default/seed config in `stepNarrowing.ts`'s seed map (`handleAddStep` flow) and
     `pipelineStepToStep` narrowing (so a freshly-created `upsertsource` step round-trips like every
     other kind, no longer falling into `unsupportedOpType`).
   - Dataset target picker: list only datasets the caller can write to (via `list_data_sources`
     equivalent / existing data-sources fetch already used elsewhere in the editor) — default to NO
     selection; never silently default to the first option (HEL-386/620 precedent).
   - Replace-mode is destructive: the UI must make this explicit per DESIGN.md's existing
     confirmation/warning patterns (reuse an existing pattern — do not invent a new visual dialect).
   - Cycle-rejection (a named 400 from the backend) must surface as a specific, readable error in the
     card, not a generic toast/swallowed failure.
2. **helio-mcp surface**:
   - `add_pipeline_step`'s tool description gains an `upsertsource` config-shape entry (matching the
     openspec spec's exact contract), documenting both target forms, the two modes, the ownership-check
     "not found" behavior, and how a cycle rejection surfaces (a named 400 citing the cycle).
   - `update_pipeline_step`'s description gets the same treatment if it separately enumerates step
     kinds/config shapes.
   - Prove end-to-end against a freshly started (not session-attached) helio-mcp process talking to a
     real backend: create a new-source target step, create an existing-source target step, and the
     cycle-rejected case.
3. **Any contract-touching schema/openspec updates** land in this same change.

## Explicitly out of scope

- Backend config model, write-path validation, cycle detection, engine execution — all already
  shipped (HEL-1099/1100/1101). No backend behavior change expected; if a backend gap is found, it is
  a spinoff ticket, not silently absorbed here.
- Any DB migration — none expected for this ticket. Escalate if one turns out to be needed.
- Write-back to `sql`/`rest_api` sources — explicitly out of scope for `upsertsource` overall.
