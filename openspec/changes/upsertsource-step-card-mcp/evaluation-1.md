## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:
1. **Target picker silently pre-selects "existing dataset" for every freshly-added `upsertsource`
   step, once the step round-trips through the real backend — directly violating the spec's
   "Target picker never defaults to a selection" requirement and its "A freshly added upsertsource
   step shows no pre-selected target" scenario.** See Phase 3 for the live reproduction; root
   cause and fix location below. This is not a hypothetical — it reproduces on every single
   UI-added step, since the pipeline editor refetches steps immediately after adding one.
2. All other ACs (op-wiring checklist entry, editor round-trip, mode toggle + `ConfirmInline`,
   `saveError` channel + `requestTokenRef` staleness guard, MCP tool documentation, backend
   `classifyDbError` fix + route-level regression tests) verified correctly implemented — see
   Phase 2/3 detail. Task list matches implementation; no scope creep found; `files-modified.md`
   is accurate; `workflow-state.md` constraints honored; the backend fix is correctly scoped
   in-change per design.md's own justification and is verified independently below (not just
   trusted from the narrative).

### Phase 2: Code Review — FAIL (see CR1); otherwise PASS

- `classifyDbError` fix (backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:2360):
  minimal, additive — single new `case` arm inserted before the generic `case other` catch-all,
  the two pre-existing local arms at `:374`/`:818` are untouched, no other arm's ordering changed.
  Confirmed behavior-preserving for every non-cycle error path by inspection (no other case
  touched).
- `PipelineCycleRouteStatusSpec.scala`: confirmed **real** `ScalatestRouteTest` route-level
  coverage — `routesFor()` builds `concat(new PipelineRoutes(...).routes, new
  PipelineStepRoutes(...).routes)` and every test posts/patches through it, asserting
  `status shouldBe StatusCodes.BadRequest` plus `responseAs[ErrorResponse].message should
  include(<cycle name>)`. One test per write path: `create`, `addStep` (transitive, two-pipeline
  cycle), `updateStep` (direct retarget), `duplicateStep` (seeded via repository test-seam).
  This is exactly what design.md claims — not service-level calls dressed up as route tests.
- Investigation-finding verification (task 3a.2): read
  `PipelineCycleDetectionServiceSpec.scala` directly (not trusted from narrative). Confirmed:
  (a) the class has zero `ScalatestRouteTest` usage — genuinely service-level, contradicting its
  own "(API-level)" section-comment label; (b) every `addStep`/`updateStep`/`duplicateStep`
  cycle-rejection assertion in that file is the untyped `result shouldBe a[Left[_, _]]` (grepped
  15 occurrences, the 6 relevant to these three methods all untyped) — a pre-fix
  `Left(ServiceError.InternalError(...))` (500) satisfies this identically to a
  `Left(ServiceError.BadRequest(...))` (400). The design.md finding is accurate, not a guess.
- `sbt test` re-run **fresh, myself** (not the executor's paste): `4353` tests, `0` failed, exit
  code 0, including the new `PipelineCycleRouteStatusSpec` and Flyway migrating cleanly through
  `V107`.
- Frontend `isOwner` threading: traced end-to-end from `usePipelineDetailPage.ts:540-543`
  (`isOwner = currentPipeline?.ownerId === currentUser?.id`, a real computed equality — not a
  constant `true`) → `PipelineDetailPage.tsx` → `PipelineRiverView.tsx` →
  `LaneColumn.tsx`/`RootColumn.tsx` → `StepCard.tsx` → `StepOpEditor.tsx` →
  `UpsertSourceConfig.tsx`. Every intermediate prop defaults to `true` only as a
  backward-compat default for pre-existing call sites that don't thread it (test fixtures,
  other lanes) — the live/production path always carries the real value. Confirmed non-owner
  path disables the "existing dataset" radio (`disabled={!isOwner}`) with the required inline
  explanation.
- `saveError`/`requestTokenRef` staleness guard: confirmed in `useStepCardState.ts` — the
  `.catch` handler re-checks `requestTokenRef.current === token` (the exact same guard the
  success path already uses) before calling `setSaveError`, so a stale/superseded rejection
  cannot clobber a newer result. `saveError` is cleared at the start of each `persist` attempt
  (`captureErrors` gate) and other op kinds' pre-existing silent-swallow behavior is preserved
  (the `.catch` still no-ops when `captureErrors` is false).
- `ConfirmInline` reuse for the destructive replace transition confirmed (no new modal/visual
  dialect introduced) — `DESIGN.md`'s documented pattern, matching the design.md citation.
- Lint (`npm run lint`), format (`npm run format:check`), full Jest suite (`npm test`, 317
  suites / 3376 tests), and `npm run build` all re-run fresh by me — all pass.

**CR1** (blocks PASS): see Phase 1 issue 1 / Phase 3 reproduction and fix guidance below.

### Phase 3: UI Review — FAIL

- Confirmed live in the running dev app (`localhost:6534`/`localhost:9441`, real login session)
  that "Write to source" appears correctly in the add-step menu (OP_TYPES wiring) and dispatches
  to the real `UpsertSourceConfig` editor, not the "unsupported step" fallback.
- No console errors attributable to this change (one pre-existing, unrelated 404 on
  `GET /api/pipelines/:id/schedule` for a pipeline with no schedule set, present before this
  ticket's changes).
- **Live reproduction of CR1**: on a real pipeline (`HEL-1081 e2e pipeline`,
  `e3eca0bd-2683-41e4-937e-099c8741be3c`), added a fresh `upsertsource` step via a single real
  click on the "Write to source" menu item (Playwright `browser_click`, not a synthetic double
  dispatch). Immediately queried `GET /api/pipelines/.../steps` (no further interaction with the
  card) and got back:
  ```
  {"config":{"mode":"append","target":{"dataSourceId":"","kind":"existingSource"}}, ...}
  ```
  i.e. the persisted config's `target` is **not absent** — it is the backend's own tolerant-read
  sentinel `UpsertTarget.Default = ExistingSource("")`
  (`backend/src/main/scala/com/helio/domain/steps/UpsertSourceConfig.scala:135`,
  `UpsertSourceConfig.write` at `:172-174` always serializes a concrete `target` object, there is
  no code path that omits the key on the wire). Reloading the step card at this point showed
  `input[aria-label="Use existing dataset"].checked === true` (confirmed via
  `browser_evaluate` reading the live DOM `checked` property, not just visual styling) with no
  dataset actually selected in the `Select` below it — exactly the "silently default to a
  selection" defect design.md Decision 3 and the openspec spec's "Target picker never defaults to
  a selection" requirement explicitly forbid (HEL-386/620 precedent, cited by name in both
  documents).

  **Root cause**: `upsertSourceConfigOf` (`stepNarrowing.ts`) and `UpsertSourceConfig.tsx`'s
  `choice` state only treat `cfg.target === undefined` as "nothing chosen yet." But the backend
  never actually omits `target` on the wire for an incomplete draft — its own decode/write
  round-trip (`UpsertSourceConfig.decode` substitutes `UpsertTarget.Default` for an absent
  `target`, then `format.write` always serializes *some* concrete target object) means every
  fetch of a freshly-added, not-yet-configured step returns
  `target: {kind:"existingSource", dataSourceId:""}` — never an absent key. The frontend's
  "no pre-selected target" logic was written against an assumption (`{}` round-trips with
  `target` truly absent) that does not match the real, already-shipped (HEL-1099) backend
  contract. The unit tests never catch this because `UpsertSourceConfig.test.tsx`/
  `stepNarrowing.test.ts` construct the config prop directly as the literal `{ mode: "append" }`
  (no `target` key) — a shape that never actually occurs after a real round trip through the
  live backend.

  **Fix guidance** (for the executor): `upsertSourceConfigOf`/`UpsertSourceConfig.tsx`'s
  "no target chosen" check must also treat the backend's own sentinel value
  (`target.kind === "existingSource" && target.dataSourceId === ""`) as "no target chosen yet,"
  not as a real existing-source selection — mirroring how the backend itself documents this
  exact value as its "unconfigured, incomplete draft" contract
  (`UpsertSourceConfig.scala:131-135`). This needs a corresponding unit test that constructs the
  config prop as the REAL round-tripped shape the backend returns
  (`{ mode: "append", target: { kind: "existingSource", dataSourceId: "" } }`), not only the
  literal `{ mode: "append" }` currently used, so this exact regression can't reappear silently.
- Breakpoint/light-dark/keyboard checks were not completed given the above blocking defect —
  re-run once CR1 is fixed.

### Overall: FAIL

### Change Requests

1. **Fix the "no pre-selected target" defect for a freshly-added `upsertsource` step once it
   round-trips through the real backend.** Files: `frontend/src/features/pipelines/state/
   stepNarrowing.ts` (`upsertSourceConfigOf`) and/or `frontend/src/features/pipelines/ui/
   stepConfigs/UpsertSourceConfig.tsx` (the `choice` state derivation). Treat the backend's own
   `ExistingSource("")` sentinel (`target.kind === "existingSource" && target.dataSourceId ===
   ""`) as "no target chosen yet," identically to how an actually-absent `target` is already
   treated, rather than as a real "existing dataset" selection. Add a unit test constructing the
   config prop with this exact round-tripped shape (not only the literal `{ mode: "append" }`
   with `target` omitted) to prevent regression. Re-verify live via the running dev app (add a
   fresh `upsertsource` step, confirm neither radio is checked after the immediate refetch) as
   part of the fix.

### Non-blocking Suggestions

- None beyond CR1 — everything else (backend fix, MCP docs, `saveError`/token-guard wiring,
  `isOwner` threading, `ConfirmInline` reuse) is solid and correctly verified against live/fresh
  evidence.
