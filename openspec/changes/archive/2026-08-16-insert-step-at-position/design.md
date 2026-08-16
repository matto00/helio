# Design: insert-step-at-position

## Context

Backend ground truth (base `6612e291`): `CreatePipelineStepRequest(type, config)` with
`jsonFormat2` (`PipelineStepProtocol.scala:143`); `PipelineService.addStep` (line ~437) validates
kind → decodes config → per-kind ACL pre-flights (join/union/lookup) → owner-or-editor check →
`pipelineStepRepo.insertInternal(pipelineId, kind, typedConfig)`, which appends at
`MAX(position)+1 | 0` (`PipelineStepRepository.scala:156-159`). `deleteStep` never renumbers, so
positions can be non-contiguous today (HEL-407 finding); HEL-407's `reorderInternal`
(`PipelineStepRepository.scala:~193`) established the safe idiom: one transaction, full renumber
0..n from scratch. Route shell is thin (`PipelineStepRoutes`); `schemas/` has no
create-pipeline-step schema (only the HEL-407 reorder request).
Frontend ground truth: `PipelineDetailPage` owns steps as local state (`useState<Step[]>`, seeded
once, mutated via `setSteps` + plain service calls); `handleAddStep` appends a temp step
optimistically, calls `createPipelineStep(id, type, config)`, reconciles the temp on success,
keeps it + toasts on failure. `PipelineRiverView` renders cards with `RibbonSegment`s between
them and owns the `OpDropdown` anchor pattern (add-step buttons). Analyze refresh is the
order-sensitive 300ms `stepsFingerprint`; open previews key on `${stepIndex}:config` (HEL-407).

## Goals / Non-Goals

Goals: insert at any index (start/middle/end) with contiguous persisted positions; gap affordance
in the editor; append unchanged; additive wire only.
Non-goals: separate endpoint; delete-time renumbering; touching reorder/drag; DAG.

## Decisions

1. **Optional `position` field, list-index semantics.** `CreatePipelineStepRequest(type, config,
   position: Option[Int])`, `jsonFormat3`. `position` is an index into the current sorted step
   list: `0` = before the first step, `count` = append (equivalent to absent). Validation in the
   service: `position < 0 || position > count` → 422 (`ServiceError`'s unprocessable variant —
   match `reorderSteps`' non-permutation handling), where `count` is read fresh inside the same
   flow. *Why index, not raw position value?* Positions have gaps today; an index is the only
   client-meaningful contract (the frontend knows list indexes, not raw DB values), and it
   composes with the renumber-from-scratch write below.
2. **Repository: `insertAtInternal(pipelineId, kind, config, index)` — one transaction, full
   renumber.** Read the pipeline's steps sorted by position; build the new sequence with the new
   row at `index`; write `position = i` for every row (existing rows via update, new row inserted
   with its index) in a single transactional DBIO — the exact `reorderInternal` idiom. This keeps
   positions contiguous after every insert AND incidentally heals pre-existing gaps. The absent-
   `position` path continues to call the untouched `insertInternal` (append, MAX+1) — zero
   behavioral risk to existing append.
3. **Service wiring**: `addStep` keeps its entire existing pipeline (kind check → config decode →
   join/union/lookup ACL pre-flights → owner/editor check) verbatim; only the final persist
   branches on `req.position` (None → `insertInternal`; Some(i) → validate count then
   `insertAtInternal`). No route change (same entity unmarshal picks up the new optional field).
4. **Schema**: add `schemas/create-pipeline-step-request.schema.json` — the AC requires schemas/
   updated when the request gains a field, and no schema exists for this request today; model it
   on `reorder-pipeline-steps-request.schema.json`'s conventions (`position` optional integer,
   minimum 0). Keep `npm run check:schemas` green (it validates schema↔protocol sync; follow its
   error output if the new file needs registration).
5. **Frontend affordance: an insert button in each gap, rendered by `PipelineRiverView`.** One
   compact "+" button per gap (before the first card and between each pair — after-last is the
   existing add row, unchanged), styled on/beside the existing `RibbonSegment` (token-only CSS).
   Clicking sets `insertDropdownAt: number | null` local state and opens the existing
   `OpDropdown` anchored at that gap's button (same anchorRef pattern as the add-step buttons;
   one dropdown at a time — opening a gap dropdown closes the add-row one and vice versa).
   Selecting an op calls the new `onInsertStep(opType, index)` prop.
6. **Page handler: `handleInsertStep(opType, index)` in `PipelineDetailPage`**, and
   `handleAddStep` becomes `handleInsertStep(opType, steps.length)` (behavior-preserving
   consolidation — same optimistic-temp + reconcile-or-keep-with-toast semantics, now
   splice-at-index instead of push): temp step spliced at `index`; `createPipelineStep(id, type,
   config, index)` (service fn gains an optional `position` param, omitted for append so the
   wire stays byte-identical for the existing path); on success replace the temp in place with
   `pipelineStepToStep(persisted)`; on failure keep the temp + toast (the existing convention —
   the temp's PATCHes no-op until persisted, exactly like today's append failure).
7. **Refresh — no new code**: the optimistic splice changes `stepsFingerprint` (order-sensitive)
   → debounced analyze; steps after the insert point change `stepIndex` → their open previews
   re-fetch via HEL-407's fingerprint. Assert both in tests; implement nothing.

## Planner Notes (self-approved)

- 422 (not clamp) for out-of-range `position`: consistent with `reorderSteps`' strict staleness
  handling; the frontend only sends in-range indexes, so a 422 means concurrent edit — surfaced
  via the existing failure toast.
- `handleAddStep` → `handleInsertStep(op, steps.length)` consolidation is deliberately included
  (two near-identical optimistic-create paths would drift); it is behavior-preserving and small,
  not a refactor bundle.
- Sizing: `PipelineDetailPage.tsx` 626 → ~+15 net (consolidation offsets the new handler);
  `PipelineRiverView.tsx` 219 → ~+35; `StepCard.tsx` untouched. Record actuals in
  `files-modified.md`; HEL-682 still owns the splits.
- Backend tests live in `PipelineStepRoutesSpec.scala` beside the HEL-407 reorder tests.

## Risks

- Concurrent inserts from two editors can interleave renumbering; last write wins inside its own
  transaction and every outcome is a valid contiguous order (no corruption; same posture as
  reorder). Accepted.
- The gap affordance must not interfere with HEL-407's drag drop-indicator (both live in the
  gaps): keep the insert button visually small and ensure the drop-indicator line's absolute
  positioning is unaffected — verify in the live pass at all breakpoints.
