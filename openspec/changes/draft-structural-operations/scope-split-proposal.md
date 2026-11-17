# HEL-1684 scope split proposal (Planning escalation)

## Why one PR is too big

Eight action families, each needing client draft-model support, desktop + phone UI wiring, and an e2e that fails first
in light and dark. Grounding on main 46ab3251e:

- The draft model (`state/pipelineDraft.ts`) is an overlay of `{configs, enabled, deleted}` keyed by saved step ids. Every
  new action needs it to carry NEW steps (clientId), positions/parents and Outputs. That is a model rewrite plus a
  kept-draft (sessionStorage) format change with a compatibility path for drafts kept under the old shape.
- Server: `POST /api/pipelines/:id/draft/save` (DraftDiff.scala) ALREADY accepts step creates by `clientId`,
  re-parenting, trunk order and Output create/edit/delete. It does NOT accept root add/remove: HEL-1629 listed root edits
  as a non-goal. Draftable roots therefore need a backend extension of the atomic save: roots in the body, the
  fingerprint, the verified lock protocol (G1-G3) for the roots table, and the undo journal re-applying roots.
- Draft preview for an unsaved root needs that source's sample; `GET /api/data-sources/:id/sample?pipelineId=P`
  authorizes an editor only for a source that is ALREADY a root of P, so an editor's draft root has no frames.
- Shapes create several steps plus Outputs in one action, so they depend on draft Outputs.

## Proposed split

1. **HEL-1684 (this PR): steps-only actions.** Generalize the draft model to carry new steps and order: add step
   (append), insert, duplicate, "+ lane" (branch step) and reorder (Move up/down + drag). Kept-draft format with old-shape
   restore, stale-base path, draft preview and client evaluator over new steps. Client-only: the save already accepts all
   of it. E2e per action, desktop + phone, light + dark.
2. **Follow-up A: Outputs and shapes in a draft.** Create, edit and delete Outputs inside a draft (save already accepts
   them), draft Outputs in the Live Output column, then shapes (steps + Outputs) on top.
3. **Follow-up B: roots in a draft.** Backend: extend the atomic save with root add/remove under the lock protocol,
   fingerprint and undo journal; source-sample authorization for a draft root; then the client.

Each part keeps HEL-1631's block (with "Save or discard your draft first") on the actions it does not yet cover, so no
action is ever half-draftable.

## Recommendation

`split-as-proposed`. Part 1 is the foundation the other two build on; Part B is the only one with backend lock-protocol
risk and deserves its own design and skeptic gate.
