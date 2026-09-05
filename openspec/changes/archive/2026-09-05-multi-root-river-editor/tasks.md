## 1. Re-enumerate the single-root assumption (do this first, prove it with grep)

- [x] 1.1 Re-run each enumeration in `design.md` "Ground truth" against the worktree and correct any that has
      drifted. Do not trust the counts as written — this epic's file lists have been stale every time.
- [x] 1.2 Record the authoritative list of `roots[0]` display sites: `grep -rn 'roots\[0\]' frontend/src`.
      Decide per site whether it is a legitimate display-of-first-root or a latent single-root bug, and say which.
      Note the design's "four display sites" bullet over-counts by one: `PipelineDetailHeader.tsx:45` is a doc
      comment, not an access site (the real access is `PipelineDetailPage.tsx:151`, which passes the resolved
      value down as a prop). Correct the list explicitly here rather than silently re-deriving it.
- [x] 1.3 Confirm zero pre-existing `root:` path construction sites: `grep -rn "root:" frontend/src` (expect none
      relevant), so D3 is genuinely new code and nothing is being migrated.

## 2. Thread root membership through the UI boundary

- [x] 2.1 Add `rootId?: string` to the UI `Step` type (`types/step.ts`), documenting that it is `undefined` only
      for a not-yet-persisted local step, mirroring how `parentStepId`/`position` are already documented.
- [x] 2.2 Carry `rootId` through `pipelineStepToStep` (`state/stepNarrowing.ts`) so the wire value stops being
      discarded at the boundary.
- [x] 2.3 Verify in the RUNNING APP that every step of a two-root pipeline arrives with a non-empty `rootId`
      (R4 / task 7.6a). Typecheck cannot prove this. If any step response omits it, report it as a HEL-913
      defect — do not paper over it with a client-side default.

## 3. Make the lane graph root-aware (D1)

- [x] 3.1 Change `buildLaneGraph(steps)` to `buildLaneGraph(steps, roots)` (`state/stepTree.ts`), seeding one
      lane per root in `position` order from that root's root-level steps, replacing the first-parentless-step
      heuristic at `:65`. Delete the now-false single-root comment at `:66-69`.
- [x] 3.2 Add `rootId` to `Lane`; remove `LaneGraph.primaryLaneId` (D1) and re-point every consumer at the
      lane's own `rootId`. Let `tsc` enumerate the call sites.
- [x] 3.3 A root with zero steps yields an empty lane that is still present in `lanes` — not omitted.
- [x] 3.4 Jest (`state/stepTree.test.ts`): a second root's lane is no longer dropped; an empty root still
      produces a lane; single-root pipelines are unchanged.

## 4. Root-grouped column ordering (D2)

- [x] 4.1 Order columns by root `position` first, then by HEL-912's existing sibling traversal
      (`state/laneLayout.ts`), so each root's lanes are contiguous.
- [x] 4.2 Jest (`state/laneLayout.test.ts`): determinism (same input, byte-identical output) and contiguity
      (every root-1 lane column index exceeds every root-0 one). **AC2 first half.**
- [x] 4.3 Prove D2's own rule holds: no NEW code branches on ROOT position zero. Note the grep
      `grep -rn 'position === 0\|position == 0' frontend/src/features/pipelines` already returns one
      pre-existing, unrelated hit — `stepTree.ts:110`, a STEP-position continuation-index check that predates
      this change and is not root semantics. Treat that one hit as an accepted exception, documented as such;
      any ADDITIONAL hit introduced by this change, or any hit reading a ROOT's position for a semantic
      decision, is a design violation, not a nit.

## 5. R5 node-path rendering (D3)

- [x] 5.1 Add `nodePath(stepId, steps, roots)` in `state/`, returning `root:<rootId> > <stepId> > …`, traversing
      both `parentStepId` and a rejoin's `{kind:"lane"}` `secondaryInput` edge.
- [x] 5.2 A node reachable from several roots resolves through the lowest-positioned root (R5 canonical tiebreak).
- [x] 5.3 Route every path display site through it; substitute display names at render time only.
- [x] 5.4 Jest: format matches R5; the multi-root-reachable case is canonical; the stale bare-`root` head is never
      produced. **AC3.**

## 6. Root columns in the river

- [x] 6.1 Render each root as its own lane column head in `ui/PipelineRiverView.tsx` / `ui/LaneColumn.tsx`,
      labelled with the root's `dataSourceName`, in `position` order.
- [x] 6.2 An empty root renders its column with an empty-lane affordance rather than vanishing.
- [x] 6.3 No root is styled or labelled as primary/trunk (R3).

## 7. Frontend service bindings for the root routes

- [x] 7.1 Add `addPipelineRoot(pipelineId, body)` → `POST /api/pipelines/:id/roots` and
      `removePipelineRoot(pipelineId, rootId)` → `DELETE /api/pipelines/:id/roots/:rootId` in
      `services/pipelineService.ts`, matching the one `roots[]` element shape (R6) — existing `sourceId` or
      inline source spec, not two shapes.
- [x] 7.2 Verify the request body against the RUNNING backend, not against the TypeScript type. The type is not
      coupled to the backend JSON; this is the exact break HEL-913 shipped green.

## 8. "+ root" inline-source flow (D4)

- [x] 8.1 Add the "+ root" affordance, composing a source `Select` with a nested `AddSourceModal`, mirroring
      `CreatePipelineModal.tsx:170-200`. Paste-table must be reachable without leaving the flow.
- [x] 8.2 Disable the confirm control while no source id is held, AND refuse in the handler. Both guards (D4).
- [x] 8.3 On success the new root appears as a new rightmost column without a page reload.
- [x] 8.4 Jest: calling the handler with no selection never calls the service — assert on the service spy, not on
      the button's disabled attribute. **HEL-620 regression guard.**

## 9. Root removal with placement count (D5)

- [x] 9.1 Confirmation states the number of panel placements about to be destroyed, before any request is issued,
      in the same terms step deletion uses.
- [x] 9.2 Map the backend's two named refusals (last root; surviving lane referencing a deleted node) to distinct
      messages, naming the referencing step in the second. Render the server's refusal; do not re-derive it.
- [x] 9.3 Jest: removing a root removes its lane's Outputs from the rail and surfaces the placement count.
      **AC2 second half.**

## 10. Mobile (D6) — AC4

- [x] 10.1 At 375px and 430px, root columns stack/scroll rather than overflow unreachably.
- [x] 10.2 Measure the "+ root" and root-remove controls' RENDERED boxes (>=44px both dimensions) via
      bounding-box/computed-style in the running app. A CSS `min-height` declaration is not evidence.

## 11. End-to-end proof — AC1

- [x] 11.1 Playwright, in the running app: add a second root via pasted table, join it to the first lane, place
      the resulting table Output. (HEL-913's AC5, verbatim.)
- [x] 11.2 If preview 422s on the rejoin, confirm it matches HEL-970's known `pathToRoot` defect signature, note
      it, and continue. Do not fix it and do not work around it in the editor.
- [x] 11.3 Close the browser when done — this run holds the single shared Playwright session.

## 12. Gates — AC5

- [x] 12.1 `npm run lint`, `npm run typecheck`, `npm test` green.
- [x] 12.2 Confirm no Flyway migration was added: `git diff --name-only main... -- backend/src/main/resources/db/migration`
      returns zero. A migration here poisons the dev Postgres shared with two parallel runs.
- [x] 12.3 Confirm no sibling-owned area was touched: the diff stays inside `frontend/src/features/pipelines/**`
      (plus this change's openspec artifacts).
