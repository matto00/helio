## Context

`AssistantProposalToolSchemas.scala` hand-authors `JsObject` tool schemas for the Assistant's
in-conversation Claude tools (`propose_pipeline`, `propose_combined`, `propose_patch_set`). These
are meant to mirror `schemas/**/*.schema.json`, which are the actual wire contracts already enforced
by `PipelineProposalService`/`PatchSetService`. `scripts/check-schema-drift.mjs` (invoked from
`.husky/pre-commit` via `npm run check:schemas`) now checks parity between the two and carries a
narrow, ticket-referenced `KNOWN_PRE_EXISTING_DRIFT` allowance for exactly the two gaps this ticket
fixes. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Bring `PipelineProposalStepSchema` and `EditTargetSchema` back into exact parity with their JSON
  Schema counterparts.
- Remove the now-satisfied `KNOWN_PRE_EXISTING_DRIFT` entries so the check returns to zero
  exceptions.

**Non-Goals:**
- No change to how `check-schema-drift.mjs` computes parity, or to any other parity surface it
  checks.
- No change to backend validation/apply behavior for pipeline steps or patch-set edits — both
  already accept `enabled` and `kind: "output"` at the service layer.

## Decisions

- **Match the JSON Schema's exact shape for `enabled`**: `JsObject("type" -> JsArray(Vector(JsString("boolean"), JsString("null"))))`,
  mirroring `create-pipeline-transactional-step-request.schema.json` line 13 exactly, rather than a
  plain `{"type": "boolean"}` — the drift checker compares property presence, not type shape, but a
  looser type here would silently reintroduce a shape mismatch a human reviewer would have to
  re-discover later. Not adding `required` for it, matching the JSON Schema (optional).
- **Append `"output"` to the existing `enumSchema(...)` call** rather than restructuring
  `EditTargetSchema`, since this is the minimal edit that reaches parity — no other `kind` values
  are affected.
- **Remove both `KNOWN_PRE_EXISTING_DRIFT` entries in the same change**, not as a follow-up — an
  unfixed drift with a stale allowance still referencing a closed ticket is worse than either
  fixing both together or leaving the allowance comment accurate.

## Gate-Chain Implications Checklist

`scripts/check-schema-drift.mjs` is invoked by `.husky/pre-commit` via `npm run check:schemas`; this
change edits it (removing two `KNOWN_PRE_EXISTING_DRIFT` map entries and their justifying comment),
so this checklist applies.

- **What does it execute?** A pure static analysis: reads `AssistantProposalToolSchemas.scala` and
  `schemas/**/*.schema.json` off disk via Node's `fs`, diffs property/enum sets, and prints
  errors/exits non-zero on mismatch. No subprocess execution, no network calls.
- **What environment does it inherit, and from where?** Whatever `node` and `npm run check:schemas`
  inherit from the calling shell (husky's pre-commit environment) — no new env vars are read or
  required by this change; the two removed map entries are hardcoded literals, not env-driven.
- **Does it write anything outside its own sandbox?** No — read-only against the repo tree, writes
  only to stdout/stderr and its own exit code.
- **Does it behave differently from a linked worktree than from a main checkout?** No — it resolves
  paths relative to the repo root it's run from (via `git rev-parse` or equivalent), which is
  identical in a linked worktree and a main checkout; nothing here is worktree-topology-sensitive.
- **What happens on its first run?** Immediately stricter: the two previously-allowed drift entries
  are gone, so if `AssistantProposalToolSchemas.scala`'s fixes in this same change aren't both
  correct and complete, the very next `check:schemas` run (this change's own pre-commit) fails
  closed — which is the intended outcome, not a regression to guard against.

## Risks / Trade-offs

- [Risk] Removing the allowance before the Scala fix lands (e.g. partial revert) would fail every
  subsequent commit touching these files → Mitigation: both edits land in the same commit/PR,
  verified by re-running `npm run check:schemas` locally before commit (task list below).

## Planner Notes

Self-approved: no design ambiguity here — the fix is fully specified by the two JSON Schema files
already in the repo (this ticket doesn't need to invent a shape, only copy one that already exists).
No specs are added or modified (see proposal.md's Capabilities section) since both `enabled` and
`output` are already-established, spec-documented wire behavior this change makes the Assistant's
tool schema consistent with, not new behavior.
