# HEL-1506: Applying a shape at the bottom of a pipeline whose last primary-lane step has a lane silently reparents that lane; the editor shows stale structure

## Description

origin_kind: followup / origin_ticket: HEL-1484. Labels: Follow-up, Bug. Priority: Medium.

`usePipelineShapeInstantiation` creates the shape's first step with a plain splice (no `attachAsTail`) anchored on the
last step of root 0's primary lane. The backend splice reparents EVERY existing child of the anchor under the new step.
If the anchor has a lane child (a `position >= 1` child, e.g. created with "+ lane" on the last step), that lane is moved
under the shape's LAST step on the server. The create responses report it (`reparentedStepIds: [<lane step>]`) but the
handler ignores them, so the editor keeps the old structure until reload. The old `anchorHasTail` refusal was removed in
HEL-912 and nothing replaced it.

### Repro (dev stack, throwaway data)

1. Pipeline: root source -> A -> B, then "+ lane" on B (`parentStepId: B, attachAsTail: true`) -> L. Server: A<-root,
   B<-A, L<-B. UI: primary lane [A, B], one lane [L].
2. Click "Add Outputs from a shape" at the bottom (anchor = B), pick Top N, Add steps.
3. POST /steps (sort, parentStepId=B, no attachAsTail) -> 201, `reparentedStepIds: [L]`; POST /steps (limit,
   parent=sort) -> 201, `reparentedStepIds: [L]`.
4. Server after: A<-root, B<-A, sort<-B, limit<-sort, **L<-limit**.
5. UI right after apply: shape cards render inside the lane beside/under L. After reload: shape steps are in the primary
   lane and L is a lane after them.

### Root cause

- `frontend/src/features/pipelines/hooks/usePipelineShapeInstantiation.ts`: first create is a splice;
  `persisted.reparentedStepIds` is never applied (compare `usePipelineStepCreation.ts` / `applyCreatedStep.ts`).
- `backend/.../PipelineStepCreate.scala`: splice reparents all anchor children; `rejectIfReparents` (HEL-1069) is opt-in.

Evidence: `.concertino/runs/HEL-1484/evidence/probe/` in the main checkout.

## Owner decision (2026-10-12, escalation answered "b")

Option (b): keep the server splice (the shape extends the primary lane; a lane hanging off the anchor moves under the
shape's last step, exactly like the ordinary bottom "+ add step" already does) and apply the create responses'
`reparentedStepIds` to local editor state so the editor matches the server with no reload.

## Acceptance Criteria

- Applying a shape at the bottom of a pipeline whose primary-lane last step has a lane leaves the editor showing exactly
  the server's structure immediately after apply, with no reload: shape steps continue the primary lane and the lane
  hangs off the shape's last step.
- Every shape step create applies its response's `reparentedStepIds` to local state (the same delta application the
  ordinary step create uses), including on a partial (mid-loop failure) apply.
- Local-only drafts and open-card state survive the apply (no wholesale replace).
- No backend behavior change; the shape still creates via plain splice. The stale KNOWN HAZARD comments are updated.
- Red-first tests: a hook/page test that fails on main and passes after; a running-app check that the editor matches the
  server with no reload.
