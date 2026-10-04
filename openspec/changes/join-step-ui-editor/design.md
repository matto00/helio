## Context

The palette (`ui/StepPalette.tsx`) renders `GET /api/pipeline-step-catalog` entries with `authorable = true`
(HEL-1136). `JoinStep.companion` (`backend/.../domain/steps/JoinStep.scala:124`) declares
`authorable = false`, and `GroupByStep` does too. Frontend `stepNarrowing.ts` omits join from `OP_TYPES`,
and resolves loaded join steps through a private `JOIN_OP_TYPE` special case in `pipelineStepToStep`.
`StepOpEditor` has no join branch, so a join card falls through to the generic "Configure this … step."
text. The wire config is `JoinConfig(secondaryInput, joinKey, joinType)`. The backend runs `inner`/`left`
only (`JoinStep.SupportedJoinTypes`), auto-prefixes collisions as `right_<name>` (HEL-1236), and skips the
ACL pre-flight for an empty seed id (HEL-950). The closest precedents are `LookupConfig.tsx` and
`UnionConfig.tsx`, with their narrowers `lookupConfigOf`/`unionConfigOf` and persist handlers
`onLookupChange`/`onUnionChange` in `hooks/useStepCardState.ts`.

## Goals / Non-Goals

**Goals:** make join authorable from the UI with an editor matching union/lookup conventions, with a
proven client/server/MCP seam on the config shape.
**Non-Goals:** see proposal.md: groupby (HEL-1142), new join types, multi-key, right-schema fetch, HEL-1251.

## Decisions

**D1 — Flip authorability in the backend; the frontend follows.** Delete the
`override def authorable = false` line from `JoinStep.companion`, keeping the `Companion` default `true`.
Do not add a frontend-only override: the catalog is the single source of truth for what the palette
offers (HEL-1136 Decision 5). Update the three tests that pin `{join, groupby}` to pin `{groupby}`:
- `PipelineStepRegistryCatalogSpec:23-27`
- `PipelineStepCatalogServiceSpec:35-37`
- `stepNarrowing.test.ts:647`

**D2 — `join` joins `OP_TYPES`; `JOIN_OP_TYPE` is deleted.** Add
`{ id: "join", label: "Join tables", icon: Link2 }`, using lucide `Link2` (the ticket's `faLink` is stale).
Position it next to `union`/`lookup`. `pipelineStepToStep` then resolves join via the ordinary
`OP_TYPES.find`, and `STEP_ICONS` picks up join automatically. Rewrite the `OP_TYPES` header comment so it
no longer claims join is excluded, and fix the sibling comments that say union/lookup/upsertsource "do NOT
mirror join's exclusion". Keep `defaultConfigFor("join")` unchanged; it already seeds the correct shape.

**D3 — `JoinConfig.tsx` composition.** `JoinConfigValue = { secondary: SecondaryInput; joinKey: string;
joinType: string }`. `joinType` is a `string`, not a union, so an unsupported stored value survives
narrowing. It renders three controls inside the shared `pipeline-detail-page__union-config` wrapper:
1. `SecondaryInputPicker`, label "Right source", with the same props as `LookupConfig`.
2. A "Join key" `Select` over `analyzeSchema`. The key must exist on both sides, but the right schema
   isn't fetchable by id (lookup Decision 11). If `config.joinKey` is non-empty and not in
   `analyzeSchema`, append it as an option labelled `<key> (not in input)`. The shared `Select` otherwise
   renders the placeholder for an unmatched value, silently hiding a stored key.
3. A join-type toggle, "INNER" / "LEFT", reusing the filter-combinator button recipe and `aria-pressed`
   (as `UnionConfig`'s mode toggle does), plus a description line:
   - inner: "Only rows whose key matches on both sides are kept."
   - left: "Every input row is kept; unmatched rows get no right-side columns."

   This left wording matches `JoinStep.evaluate`, which emits the bare left row with no null-filled right
   columns. That differs from lookup, so do not copy lookup's "get null" text. A short note also states
   that colliding right columns arrive as `right_<name>`.
   When `joinType` is neither `inner` nor `left` (case-insensitive, mirroring `normalizedType`), no button
   is pressed and an inline notice reads: `Join type "<value>" is not supported and will fail at run time
   — choose Inner or Left.` Use the existing inline-notice/warning class used by sibling editors (find it
   by grep; do not invent a token).

**D4 — Narrowing and persistence.** Add `joinConfigOf(step)` in `stepNarrowing.ts`, mirroring
`lookupConfigOf`:
- pass `secondaryInput` straight through
- default to `DEFAULT_SECONDARY_INPUT`, `""`, and `"inner"` only when a field is absent

In `useStepCardState`, add `joinConfig` state, reset in the same effect as `unionConfig`/`lookupConfig`,
and add `onJoinChange`, which persists exactly `{ secondaryInput: c.secondary, joinKey: c.joinKey,
joinType: c.joinType }`. Never persist on mount. `StepOpEditor` gets a `step.opType.id === "join"` branch
beside union/lookup, passing `allSteps`/`currentStepId`/`analyzeSchema` as `LookupConfig` does.

**D5 — Seam test via a shared fixture.** Add `shared-test-fixtures/join-step-config.json`, following the
precedent of `layout-validity.json`/`form-proposal.json`. It holds two cases (source-kind and lane-kind),
each the exact config object the editor persists. Three suites read it:
- Frontend Jest (`stepConfigs/JoinConfig.seam.test.tsx`): drive `JoinConfig` through a controlled
  harness and the real `onJoinChange` path (or `StepCard` with `updatePipelineStep` mocked, as
  `PipelineDetailPage.test.tsx` does). Assert the persisted body `toEqual` each fixture case, with an
  exact key set.
- Backend ScalaTest (`JoinStepConfigSeamSpec`): for each case, assert that
  - `validateRawConfig` is `None`
  - `readFromWire` and then `writeToWire` round-trip to the identical `JsValue`
  - a route-level `POST` step followed by `GET` on the pipeline returns the identical config (precedent:
    `PipelineStepRoutesSpec`)
- helio-mcp test: assert that the `add_pipeline_step` description's join clause names exactly the
  fixture's top-level keys. This is a string-level check, like `formProposalSeam.test.ts`.

**Required red:** rename `joinKey` in the frontend persist payload and record the frontend seam red. Then
rename the backend field and record the backend seam red. Revert both. A test that cannot go red under
these mutations does not satisfy AC5.

**D6 — MCP description.** In `helio-mcp/src/tools/write.ts` `add_pipeline_step`, add a join clause next
to union:
`join → {secondaryInput: {kind:'source',dataSourceId} | {kind:'lane',stepId}, joinKey, joinType: 'inner'|'left'}`.
State key-on-both-sides, `right_<name>` collisions, and left-join unmatched-row semantics. Text only; no
tool behaviour change. Rebuilding helio-mcp's dist is not part of this ticket.

**D7 — E2E.** Add `e2e/hel958-join-step-editor.spec.ts`, modelled on `hel912-lanes-rejoin.spec.ts`. It
seeds two CSV sources sharing `id` plus one colliding non-key column, creates a pipeline on A, adds
"Join tables" from the palette, and picks B, key `id`, type inner. It then runs the pipeline and asserts
the real output row count and the presence of `right_<collider>`. The spec is self-contained (own
user/email) and leaves no shared-DB residue beyond its unique test user.

## Tests relying on current behaviour (grep at design time)

- `StepCard.test.tsx:33-35,570-600` use a local `JOIN_OP_TYPE` as the "no-editor fallback" fixture,
  asserting "Configure this join tables step.". Join now has an editor, so these must switch to
  `unsupportedOpType("x")` or the `groupby` op. Preserve the intent (fallback branch, no diff chips).
- `stepNarrowing.test.ts:640-660` and the two backend catalog specs: see D1.
- Re-grep before editing:
  - `rg -n "JOIN_OP_TYPE|join is intentionally|\"join\"" frontend/src e2e`
  - `rg -n "authorable" backend/src/test frontend/src`
  - `PipelineDetailPage.test.tsx`/`PipelineRiverView.test.tsx` catalog fixtures, which may hard-code
    join `authorable: false`

## Risks / Trade-offs

- The join key is chosen from the left schema only, so a key present on the left but absent on the right
  yields an empty inner join. This is accepted, consistent with lookup. Analyze already infers the join
  output, and the step's schema diff chips show the result.
- Offering `join` alongside `lookup` may confuse users. The descriptions differentiate them: lookup brings
  named columns; join brings all columns and can drop rows.

## Planner Notes

- **Self-approved: expose exactly `inner` and `left`.** This is not a product choice. It is the complete
  set `JoinStep.SupportedJoinTypes` executes, and anything else fails at run time. Exposing only one would
  be an arbitrary restriction, and adding right/full needs backend work (non-goal).
- **Self-approved: the ticket's corrections** (catalog flip, secondaryInput shape, Link2) are recorded in
  ticket.md. No escalation: material drift was not found, and the intent is unchanged.
- **Groupby note:** `GroupByStep.companion` declares `authorable = false` and has no editor. It is the
  same "registered but unauthorable" pattern, left for HEL-1142.
- **Parallel-lane boundaries:** do not touch `features/sources/**`, `DataSourceReferenceRepository`,
  `CommandBar`, `PanelGrid`, or `useLayoutSave` (HEL-1258 and HEL-1230). No migration is needed. If one
  ever is, use V117.
