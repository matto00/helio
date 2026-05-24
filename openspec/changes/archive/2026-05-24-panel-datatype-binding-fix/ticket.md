# Ticket Context — HEL-242

**Linear**: https://linear.app/helioapp/issue/HEL-242
**Title**: [P0] Solidify Panel ↔ DataType binding
**Priority**: Urgent (P0)
**Project**: Helio v1.5 — Panel System v2 (parent epic HEL-239)

## The bug

A properly configured and populated DataType **sometimes** does not render on a panel that is bound to it. Word "sometimes" matters — intermittent, not deterministic.

Breaks the product's core promise: `DataSource → Pipeline → DataType → Panel`.

## Investigation surface (verified current paths, post-HEL-236)

### Backend
- `backend/src/main/scala/com/helio/services/PanelService.scala:69-77` — `resolveSingleBinding` clears `panel.dataTypeId` (and thus `fieldMapping`) when the bound DataType isn't owned by the requesting user. Uses owner-scoped `dataTypeRepo.findById(typeId, user.id)`.
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala:33-39` — `GET /api/types/:id/rows` calls `dataTypeService.listRows(id)` **without** a user param. Asymmetric with the binding resolve above.
- `backend/src/main/scala/com/helio/services/DataTypeService.scala:31-39` — `listRows` uses unscoped `dataTypeRepo.findById(id)` then reads all rows.
- `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala` — row persistence (need to check `listRows` implementation)
- `backend/src/main/scala/com/helio/api/routes/PipelineRunSubmitRoutes.scala` — pipeline-run upsert path that populates rows (per the ticket; HEL-236 split PipelineRunRoutes)

### Frontend
- `frontend/src/features/panels/hooks/usePanelData.ts:24-26` — already has a `// HEL-242 root-cause hypothesis points here; preserve current behavior` comment (CS2c-3c). Cache key: `panelId|typeId|fieldMappingKey`.
- `frontend/src/features/panels/state/panelThunks.ts` — `fetchPanelPage` thunk reads panel from Redux, calls `getDataTypeId(panel)`, fetches `/api/types/:id/rows`. **Returns `rejectWithValue("Panel is not bound to a data type.")` if `dataTypeId` is null** — this is the symptom path.
- `frontend/src/features/panels/state/panelNarrowing.ts` — `getDataTypeId` accessor collapses backend `""` sentinel to `null`.

## Root-cause hypothesis (carried from CS2c-3b cycle 1 exploration, recorded in memory)

> `PanelService.resolveSingleBinding` clears `typeId` / `fieldMapping` if the bound DataType doesn't belong to the requesting user. This cross-user clear path likely confuses the frontend cache — `usePanelData.ts` keys on `panel.id + "|" + panel.typeId + "|" + (fieldMappingKey ?? "")`, so a clear-then-populate sequence (e.g. after a permission change or fresh login) yields different keys and a stale entry.

**Cycle 1 must verify this hypothesis empirically or refute it.** Memory note: "Verify hypothesis before fixing." Hypothesis may be wrong or partial.

## Acceptance criteria (from Linear)

1. Given a DataType bound to a pipeline that has successfully run and populated `dataTypeRowRepo`, any panel bound to that DataType SHALL render the rows on mount.
2. Re-running the pipeline SHALL update the panel's view automatically (or after a refresh trigger we define) without manual remount.
3. A regression test asserts the binding path end-to-end (pipeline run → upsert rows → panel fetch → rows present).
4. The failure mode that's currently surfacing is reproduced in a test and fixed.

## Definition of done

- Bug reproduced (deterministic test or Playwright trace)
- Root cause identified
- Fix implemented
- End-to-end regression test added
- Manual verification across each panel type (metric, chart, text, markdown, table)

## Cycle plan

- **Cycle 1 — Investigation only** (NO code changes to production):
  - Read the full panel data path (request flow) end-to-end
  - Read the pipeline-run upsert path end-to-end
  - Read `DataTypeRowRepository` (need to map out how rows persist)
  - Attempt to reproduce the bug via Playwright (browser; matt@helio.dev / heliodev123 dev login)
  - Verify or refute the recorded hypothesis
  - Write `executor-report-1.md` with: reproduction recipe (or "cannot reproduce" with what was tried), root cause if known, proposed fix design with surface estimate
- **Cycle 2 — Fix + regression test** (only after cycle-1 design is approved by the orchestrator-relay):
  - Implement fix per cycle-1 design
  - Add the regression test
  - Manual Playwright verification across all panel types
  - All gates green

## Patterns inherited

- Behavior-preserving fix discipline ([[feedback-refactor-discipline]]) — fix the bug, don't refactor adjacent code
- File-size budgets unchanged from HEL-236
- No-inline-FQN pre-commit hook
- Atomic commits

## Out of scope

- Refactoring `PanelService.resolveBindingsForRead` or the asymmetric ownership-check pattern beyond what the fix requires
- Any HEL-256 (DataSource schema disappearance after restart) work — different ticket
- Frontend feature additions (this is a bug fix)
- Backend ADT/protocol changes (HEL-236 chain just landed; let it settle)

## Process

- Worktree: `/home/matt/Development/helio/.worktrees/HEL-242`
- Branch: `bug/panel-datatype-binding/HEL-242`
- Dev ports: 5412 (frontend), 8319 (backend)
- linear-executor + linear-evaluator at opus model
- Commits prefixed `HEL-242 [cycle N]: <summary>`
- STOP after evaluation passes; present PR and ask human before merging

## Escalation policy

If cycle 1 cannot reproduce the bug deterministically:
- Document what was tried (steps, browser state, accounts, pipeline configurations)
- Surface as BLOCKER with reproduction-attempt findings
- The orchestrator-relay decides: more investigation, request user's repro steps, ship a defensive fix based on hypothesis with extra logging, or close as not-reproducible
