## Context

See proposal.md (Why). Ground truth on main 68829c1c6:

- `PanelDetailModal.handleEditSubmit` dispatches `accumulatePanelUpdate({panelId, fields: {appearance:
  {background, color, transparency}, title?}})` — no `chart` key. Subtype editors save via their own typed thunks.
- `panelsSlice.accumulatePanelUpdate` stores the fields as pending AND sets `items[i] = {...panel, ...fields}`: the
  local `appearance` object is replaced, so a stored `appearance.chart` disappears from client state.
- The pending fields flush via `buildBatchRequest` -> `POST /api/panels/updateBatch` (30 s auto-save, Save now, or the
  grid unmount flush, `usePanelUpdatesFlush.ts`).
- Server: `PanelMutationRepository.batchUpdate` and `PanelServiceHelpers.resolvePatch` merge via
  `PanelAppearance.applyPatchJson` (HEL-362). An absent `chart` keeps the stored chart.
- Render: `resolvePanelChartType.ts` / `outputRenderInputs.ts` read `appearance.chart?.chartType` and fall back to the
  Output's config, so a dropped local chart changes the rendered chart type in the window between the accumulate and
  the next flush: `updatePanelsBatch.fulfilled` (`panelsSlice.ts:338-341`) replaces each item with the server's merged
  copy, which heals it (skeptic design-1 CR2).
- Transparency round-trip: `usePanelDetailEditState.ts:35` seeds `Math.round(transparency * 100)` and the modal sends
  `transparency / 100`, so a stored non-whole-percent value (e.g. 0.555, settable via API/MCP) becomes 0.56 on a
  title-only save, even with server merge. The modal always re-sends background, color and transparency.

## Goals / Non-Goals

**Goals:** measure (not assume) whether any unedited appearance field is lost on the server or in the client after a
modal save; fix any loss at the write seam red-first; pin the behaviour with a guard either way.

**Non-Goals:** API semantic changes; modal chart-appearance UI; unrelated refactors.

## Decisions

1. **Probe first, evidence committed.** Before any implementation code: (a) API probe on the lane backend — create a
   chart (output-kind) panel with non-default `appearance.chart` (e.g. `chartType: "bar"` plus a legend/axis setting)
   and a non-default background; record GET JSON; send the modal's exact batch body (title + {background,color,
   transparency}); record GET JSON. (b) Playwright through the real modal on the lane dev server: title-only save, and
   a background-only save; capture the `updateBatch` request body, the server read-back, and the client's rendered
   chart type / Redux panel state AFTER the modal save and BEFORE any batch flush (no Save now, read well inside the 30 s
   auto-save window), then again after the flush, recording whether the flush heals it and how long the wrong render was
   visible. Seed a stored transparency that is NOT a whole percent (e.g. 0.555) and a stored `chart.chartType` that
   differs from both the bound Output's `config.chartType` and the `line` fallback, so a loss is observable. Check every modal section that saves (appearance/title for every
   kind; the subtype editors' typed saves for content kinds and `OutputControlsEditor` for output panels — confirm they
   do not send appearance). Evidence goes to
   `openspec/changes/panel-modal-appearance-save/probe-evidence.md` with before/after JSON.
2. **Fix seam, if the client-state loss is real: the accumulator merges.** `accumulatePanelUpdate` merges
   `fields.appearance` over the stored `panel.appearance` for the local `items` update (keeping `chart` and any key
   the patch omits). The PENDING payload is the merged union of the staged partial patches: when `fields.appearance`
   is present it merges over `pendingPanelUpdates[id].appearance` (not a shallow replace, `panelsSlice.ts:124-127`), so
   two modal saves before a flush send both edits (skeptic design-2 CR1). `clearSentPendingPanelUpdates`'s JSON-equality
   clear must still work on the merged object (verify with a test). Alternative rejected: making the modal
   send the full appearance including `chart` — it would re-send stale chart data over a concurrent API/MCP chart edit
   (lost update) and widen the wire payload; the server is already merge, so the client should mirror merge locally.
   Alternative rejected: server change — already merge; changing it would alter documented behaviour (escalate).
2a. **Modal appearance patch carries only the fields the user changed** (skeptic design-1 CR1, option a), if the probe
   confirms the transparency (or any scalar) round-trip loss. `handleEditSubmit` compares each of background, color and
   transparency against the value the edit state was seeded with and includes only changed keys; a save with no changed
   appearance key sends no `appearance` at all (title-only batch item; the server and `buildBatchRequest` already accept
   an item with only `title`). Same lost-update rationale as Decision 2: re-sending an unedited value can overwrite a
   concurrent API/MCP edit. Rejected option (b), narrowing the spec to 1 % precision: it codifies a silent mutation of
   a stored value the user never touched. The HEL-322 sentinel test is re-expressed per 2b.
   Transparency is compared on the seeded whole-percent integer, not `stored * 100`, so an untouched 0.555 is not
   "changed". A save with no title change, no appearance change and no dirty subtype dispatches nothing.
   **2a depends on Decision 2:** if 2a ships, the local-item merge and the pending merge of Decision 2 ship with it,
   whatever the chart-probe outcome — otherwise a partial patch strips required keys from client state (design-2 CR2).
   **Types:** `PanelUpdateFields.appearance` and `PanelBatchItem.appearance` become a partial-appearance patch type
   (`Partial<PanelAppearance>`, matching `schemas/.../panel-appearance-patch.schema.json`); `PanelAppearance` stays the
   full stored shape (design-2 CR4).
2b. **HEL-322 sentinel test is intentionally re-expressed, not tweaked** (design-2 CR3). Its title-only cases
   (`PanelDetailModal.appearanceSentinel.test.tsx:76-80`, `:98-102`) assert `pending.appearance.background ===
   "transparent"`; under 2a the untouched sentinel is not sent, so they change to: `pending.appearance` is absent (or has
   no `background`/`color` key) AND the client panel still reads `"transparent"`/`"inherit"`. The intent (an untouched
   sentinel is never clobbered into a hex) is unchanged; the hex-edit cases stay as they are.
3. **If the server path loses data (unexpected),** stop and fix at `applyPatchJson`/`batchUpdate` red-first with a
   backend spec; if that would change documented semantics, escalate before changing it.
4. **Red first.** Each fix lands only after a committed failing run (`.txt`) of the new test(s) on unchanged code, plus
   a mutation check that reverting the fix turns them red again.
5. **Guard if nothing is lost.** A jest test on the slice/modal and a backend spec asserting a title-only batch keeps a
   stored chart; labelled as a guard (with the mutation that makes it fail).

## Risks / Trade-offs

- [Probe pollutes a shared DB] -> lane-private `helio_hel1615`; residue deleted by exact id.
- [Shared Playwright MCP browser] -> verify dialog-free page on port 7047 before every UI read.
- [Merge in the reducer diverges from server merge for `null`] -> mirror the server: `null` on a top-level key resets to
  the default; `chart: null` clears; nested chart keys merge shallowly as the server does. Keep it to what the modal
  actually sends if a full mirror is unnecessary, and say so.

## Planner Notes

- Self-approved: no escalation needed — no new dependency, no API change, scope matches the ticket.
- Premise drift recorded in ticket.md (precedent claim stale since HEL-362); minor-staleness.

## Implementation Note (executor)

The accumulator's appearance merge is SHALLOW and mirrors only what the client sends. It does not replicate the server's
`null` semantics (`null` resets a top-level key to default, `chart: null` clears the chart) or the field-level merge
inside `chart`; a `chart` key in a patch replaces the staged/local chart whole. The modal never sends `chart`, so this is
sufficient; it is also stated in a code comment in `panelsSlice.accumulatePanelUpdate`.
