## Evaluation Report — Cycle 4 (evaluation-4.md)

I reviewed HEAD `4c2b360756b9b1a45a3b2f1a3a8c9bd1bf9a8504`. The base, resolved live, is `538a867d718204775f7c0844450f683889e145e3`. The scope is the delta `8a2d5ec15..4c2b36075`, a single commit, which answers the skeptic-final-2 REFUTE.

### Fresh gate runs (my own, `nice -n 19`)

- **lint, `format:check`, typecheck:** each exited 0.
- **Frontend jest** (`HELIO_JEST_MAX_WORKERS=2`): exited 0. 747 suites and 9283 tests, 2 more tests than cycle 3.
- **`e2e/hel1631-draft-mode.spec.ts`**, run under the e2e.lock flock with `--trace retain-on-failure`: 11 passed, exit 0. This includes the new external-PATCH stale-restore test.
- **Evidence** is under `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/`:
  - `eval4-e2e-hel1631.txt`
  - `eval4-jest.txt`

### Phase 1: Spec Review — PASS

- **Owner ruling verified.** `events.jsonl` has `escalation.answered` for `escalation_id` HEL-1631-1792472668290-cfc8ae, with answer `extend-final-gate` and `answer_source` `human`.
- **Spec and design updated.** The draft-mode spec and design.md now say a kept draft stores its base. A draft restored over a changed pipeline takes the stale-base path, which only allows reload.

### Phase 2: Code Review — PASS

**1. Kept draft carries its base, and the stale path applies.**
- `state/keptDraft.ts` stores `{overlay, base}`, where `base` is `baseSignature(saved steps)`.
- On restore, `usePipelineDraft.ts` compares the kept base with the current saved steps. On a mismatch it sets `staleRestored`, its ref, and `keptBaseRef`.
- While stale:
  - `usePipelineDraftSave.post()` returns before any request and shows the stale notice.
  - The `notice` getter keeps that notice visible.
- Reload (`rebase`) and Discard both clear the flag and `keptBaseRef`.
- **Red-first evidence:**
  - `final2-stale-restore-red.txt`: the e2e fails at the stale-notice assertion.
  - `final2-jest-red.txt`: the stale-restore mutation fails 1 Jest test.

**2. Logout clears kept drafts.**
- The logout thunk calls `clearKeptDrafts()`.
- It collects only keys starting with `helio.pipelineDraft.` and removes them.
- `authSlice.test.ts` checks that two `helio.pipelineDraft.*` keys are removed and an `unrelated` key is kept.
- Red-first: the logout mutation fails 1 Jest test.

**Bypass checks.** I ran these live with two pipelines, A and B, adjacent in SPA history. Pipeline B got a real external PATCH to its sort step.
- **Back, PATCH, Forward:** B shows the draft and the stale notice. Clicking Save & run sent no `/draft/save` request; I watched resource timing. The notice stayed.
- **Leave again (Back to A), then Forward:** B is still stale, and Save & run again sends no `/draft/save`. The kept entry keeps the old base, because the write effect writes `keptBaseRef` and not the current signature. The flag does not leak to A: A shows no notice, and a draft made on A is stored with A's own base.
- **Discard, then re-edit:** the flag clears and the kept entry is removed. The new draft is stored with the current base (it contains the PATCHed `desc` sort). That is correct, not a bypass: the new edits are made against the current saved pipeline, and the normal save-time base check still applies.

**Outputs-only residual: no silent loss, so not a FAIL item.** The signature covers only steps, but an Outputs-only change made while away cannot be overwritten silently:
- **The draft carries no Output state.** The overlay is `{configs, enabled, deleted}` (`pipelineDraft.ts:10-17`). Output create, edit and delete are disabled during a draft (`SpineOutputs.tsx` `blockedReason`, and the "Add output" and "Add Outputs from a shape" menu items).
- **Save sends the current Outputs, not a snapshot.** `post()` reads the saved definition fresh (`getPipelineWithDefinition`, `usePipelineDraftSave.ts`). It then builds `outputs: toDraftOutputs(definition.outputs, finalSteps, …)` (`pipelineDraft.ts:223-240`) from that fresh definition.
  - An Output created or edited externally is therefore sent back exactly as it is now stored.
  - An Output deleted externally is absent, so it stays deleted.
- **The only Output the save can remove is one whose node step the draft deletes.** Removing it cannot be silent:
  - The backend `cascadeGate` (`DraftSaveTransaction.scala:115-135`) requires every removed step, Output, panel and alert rule to be listed in `confirmCascade`, computed under the save locks.
  - The first save sends no confirmation, so the server returns 422. The confirmation dialog then lists the Output by name.
  - An Output added externally on a step the draft deletes is therefore shown to the user before anything is removed.
- **The save-time `definitionMatchesBase`** also compares the fresh Outputs with the page's loaded Outputs. Those were loaded on open, after the change, so they match. This adds nothing, but it does no harm.

**Other notes:**
- `keptDraft.ts` is a small pure module.
- The only `try/catch` blocks are around storage access, with a documented "not kept" fallback.
- No escape hatches.

### Phase 3: UI Review — PASS

- Live checks are described above, at desktop 1280.
- Console: the only errors are the pre-existing schedule 404s.
- My throwaway data was deleted by exact id. Pipelines `2c07a09f…` and `8e7b719f…` and source `60c57042…` each returned 204, and a DB check found 0 rows. The probe's sessionStorage keys were cleared. The ids are recorded in `.concertino/scratch/HEL-1631/eval4-created-ids.txt`.

### Overall: PASS

### Non-blocking Suggestions

- The step-only signature is safe for the reasons above. Add one line to design.md saying why Outputs need not be part of it: save re-reads them, and any removal is gated by the cascade confirmation. That stops a later reader from "fixing" it.
- The earlier non-blocking items still stand. The main one is the race in `hel1582Phone.ts:251-252`, where the Output count is read once with no retry.
