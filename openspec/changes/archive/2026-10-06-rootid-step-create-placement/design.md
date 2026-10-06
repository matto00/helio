## Context

See proposal.md for why. Current state at main `9c41719c3`:

- `PipelineService.persistNewStep` (`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`)
  matches `(req.parentStepId, req.rootId)`. The `(None, Some(rootIdRaw))` arm validates the root, then calls
  `pipelineStepRepo.spliceInsertReportingInternal(pipelineId, kind, cfg, None, enabled, explicitRootId = Some(rootId), ...)`.
  With `(None, Some(rid))` the repository's `existingChildren` is every parentless step of that root, and all of them
  are reparented under the new row. `req.position` is never read. Probe: HEL-1340 `probe.md` (cases 1-3).
- The `(None, None)` arm reads `position` as a whole-pipeline execution-order index (`current(index - 1)` as the
  splice anchor) and, with no `position`, anchors on `trunkOf(current).lastOption`.
- `addStep`'s lane-reference pre-check (`laneCheckF`, same file, the `prospectiveParent` val) uses
  `parentStepId orElse trunkOf(current).lastOption`, which is neither the rootId arm's anchor nor root-aware.
- Repository helpers already exist: `listWithRootIdsInternal` (steps in execution order plus the parentless-step ->
  root side map, one query), `childrenOfRoot`, `childrenOf`, `trunkOfRoot`.
- HEL-1069 (`rejectIfReparents`) treats a `rootId` create on a non-empty root as a reparenting insert. That is pinned in
  `PipelineStepReparentRoutesSpec.scala` ("422 for a rootId anchor that already has root-level steps"), in the live
  spec `mcp-pipeline-step-placement` (scenario "Second same-root branch without an explicit choice"), and in the
  helio-mcp `add_pipeline_step` description (`helio-mcp/src/tools/write.ts`: "rootId on a root that already has steps
  trips the guard"). The MCP tool sends `rejectIfReparents: true` unless `attachAsTail` is given, and has no `position`
  parameter.
- `schemas/pipelines/create-pipeline-step-request.schema.json` documents `position` as a whole-pipeline execution-order
  index and `rootId` as "a trunk continuation of THAT root".
- Frontend: `PipelineRiverView`'s insert gaps pass an index into root 0's primary lane (`primarySteps`: the lane whose
  `parentStepId` is undefined and `rootId === roots[0].id`. `buildLaneGraph` builds it from the lowest-`(position,
  array index)` root-level step of that root plus each step's first position-0 child). `handleInsertStep` sends
  `isAppend ? undefined : index` as `position` and `roots[0]?.id` as `rootId`. `handleAddStep` passes `steps.length`,
  so an append sends no `position`.
- Frontend create paths:
  - `handleInsertStep`'s create-immediately branch discards `createPipelineStep`'s return value and calls
    `syncStepsFromServer`, whose wholesale replace is what removes the temp step today.
  - `handleAddLaneStep` does the same.
  - The deferred draft create inside `handleStepConfigChange` swaps temp to persisted in place (setting
    `renderKey = temp id`) and never resyncs. This is HEL-1340 item 4.
  - HEL-1340 is extracting these paths into `usePipelineStepCreation.ts` in parallel.
- `syncStepsFromServer` builds a `renderKey` map from `stepsRef.current` (assigned during render) and calls
  `setSteps(fresh...)`. It drops every local-only step and overwrites local config with the server copy.

## Goals / Non-Goals

**Goals:**
- rootId creates land where the request says, on that root only.
- The lane pre-check agrees with the real anchor.
- Every contract surface (scaladoc, JSON Schema, MCP description, MCP spec) states the new behaviour.
- The editor shows server placement after a create, without duplicating or losing steps and without collapsing an open
  card.
- A read-only measurement of production steps already misplaced, or an honest "unverified".

**Non-Goals:**
- Any data repair or migration (owner ruling required; escalate with the measurement).
- Changing `(None, None)`'s whole-pipeline `position` semantics, or its lane pre-check for an explicit `position`
  (pre-existing; follow-up noted, not filed).
- The pre-existing spec sentence "Appending a step SHALL require exactly one of `parentStepId` or `rootId`". It is
  carried verbatim, although a single-root `(None, None)` create is accepted (follow-up noted, not filed).
- HEL-1294/HEL-1321 behaviour:
  - expand stays disabled while creating;
  - an immediately-created step's card is keyed by its persisted id after the create, exactly as today (no
    `renderKey`);
  - a draft keeps `renderKey = temp id`.
- `syncStepsFromServer`'s other callers (remove, duplicate, root add/remove paths) keep their wholesale replace.
- The optimistic splice index in `handleInsertStep` (a lane index applied to the flat array) and where a local-only
  temp step renders before its create; the post-create delta (D5) sets its real placement.
- helio-mcp behaviour or package files. Only the `add_pipeline_step` description string changes (D10).

## Decisions

**D1 — `position` on a rootId create is an index into that root's trunk.**
- The root's trunk for this purpose: the head is the lowest-`position` root-level step of that root (ties in
  `listWithRootIdsInternal`'s execution order), followed by each step's first `position == 0` child. When the root has
  a `position == 0` root-level step, this equals `trunkOfRoot`. It also covers a root whose root-level steps have no
  `position == 0` step (legacy V94 tails after the head was deleted) the way `buildLaneGraph` renders it, so a UI gap
  index and the server agree.
- Anchor resolution for `(None, Some(rootId))`:
  - no `position`: anchor = last trunk step, or none when the trunk is empty;
  - `position = 0`: anchor = none (head of that root, today's behaviour, now only when asked for);
  - `0 < k <= trunk.size`: anchor = `trunk(k - 1)`;
  - otherwise: `422` "position must be between 0 and <trunk.size> (this root's trunk length)", nothing persisted.
- Why not the whole-pipeline index `(None, None)` uses: under multi-root, parentless heads of different roots tie on
  `position` and interleave in `executionOrder` by DB order. A pipeline-wide slot can therefore resolve to another
  root's step, contradicting `rootId`. And the only producer of `rootId` + `position` today, the editor gap, already
  sends a lane index.
- For a single-root, tail-free pipeline the two readings coincide, so the probe's control case and every existing
  `(None, None)` test are unaffected.
- Alternative rejected: a whole-pipeline index with a "the anchor must belong to this root" check. It rejects valid UI
  gaps on any pipeline with tails or a second root.

**D2 — Placement reuses the existing splice primitive with an explicit parent.**
- When D1 yields `Some(anchor)`: call `spliceInsertReportingInternal(..., parentStepId = Some(anchor),
  explicitRootId = None, ...)`, exactly as the `(Some(parentStepId), None)` arm does. The root derives from the parent,
  and V98's XOR holds.
- When D1 yields `None`: keep today's call (`parentStepId = None, explicitRootId = Some(rootId)`). That reparents the
  root's parentless steps for `position` 0 on a non-empty root, and nothing for an empty root.
- Consequences, accepted and consistent with the other arms:
  - Splicing onto an anchor reparents ALL its direct children, tails included.
  - `rejectIfReparents` keeps working, because it is evaluated inside the same primitive (see D10 for what that
    changes).
  - The list read and the splice are separate transactions, the same race window the `(None, None)` arm has.
- Steps come from `listWithRootIdsInternal` (one query).

**D3 — One pure anchor resolver, used by both placement and the lane pre-check.**
- Add a pure function on the `PipelineService` companion (name at the executor's discretion, e.g.
  `resolveRootTrunkAnchor(steps, rootIdOfStep, rootId, position): Either[ServiceError, Option[PipelineStepId]]`).
  `persistNewStep`'s rootId arm calls it.
- In `laneCheckF`, when `req.parentStepId` is absent and `req.rootId` is present:
  - If the root is one of this pipeline's and the resolver returns `Right(anchorOpt)`, `prospectiveParent =
    anchorOpt`.
  - If the root is unknown, or the resolver returns `Left`, skip the ancestor computation and use NO ancestors
    (`prospectiveParent = None`). `validateLaneReference` still runs, and the unknown-root or out-of-range `422` still
    comes from `persistNewStep`.
- The `parentStepId` and `(None, None)` paths of `laneCheckF` are unchanged (Non-Goal).

**D4 — Backend tests, red first.**
- Fixture: a new route spec extending `com.helio.testkit.HelioRouteTest`, with the same embedded-Postgres fixture idiom
  as `PipelineStepRoutesSpec`. `PipelineStepRoutesSpec` may be extended instead if it already mixes in
  `HelioRouteTest`. HEL-1340's probe source (in `probe.md`) may be reused as the fixture base.
- Assertions: every assertion reads the persisted tree via `GET /pipelines/:id/steps` and asserts parent links, root
  ids and `reparentedStepIds`, never only the 201.
- Placement cases, one per spec scenario:
  - single root A->B->C with `rootId` and no `position` (tail);
  - `position` 2;
  - `position` 0;
  - `position` 4 and -1 (422, row count unchanged);
  - empty root, both forms;
  - multi-root R1 A->B and R2 X->Y: `rootId` R2 with no `position`, then with `position` 1, asserting R1 untouched;
  - a root whose only root-level step has `position` 1 (SQL-seeded): append lands after it, not as a new head.
- Red evidence: run the placement cases against unmodified `PipelineService.scala` and record the failing assertions
  (the expected NEW->A->B->C head-splice). Then record the green run after the fix, and one mutation (revert the arm to
  the old call) that turns them red again.
- Lane pre-check case:
  - Setup: R1 A->B seeded first, R2 X->Y, and a `lane` `secondaryInput` naming Y on a `rootId` R2 create with no
    `position`.
  - Expected: 400 (`validateLaneReference`'s cycle arm is a `BadRequest`, not a 422), because Y is the prospective parent's ancestor chain.
  - The test first asserts its own precondition, that `trunkOf(GET order)` resolves to R1's chain, so DB row order
    cannot make it vacuous.
  - Its red run is taken with the placement fix applied and only the `laneCheckF` change reverted.
  - If no such case can be made red, the executor records why in `probe-evidence.md` rather than committing a vacuous
    test.

**D5 — Frontend post-create resync (HEL-1340 item 4): apply the server-reported delta, robust to response order.**
The create response already carries `reparentedStepIds` (`PipelineStepProtocol.createdStepJson`, always present, `[]`
when none). The frontend ignores it today. A splice inserts the created row and changes only `(parent_step_id,
root_id, updated_at)` of exactly those ids (positions untouched). A tail attach only inserts. So the response is a
complete description of the server-side change, and applying it is a resync for every step the create touched.

Mechanism:
- `createPipelineStep` also surfaces `reparentedStepIds` from the response (`[]` when absent, so existing mocks keep
  working). The executor picks the shape (an extra field on the returned value, or a sibling function), changing no
  existing caller's behaviour.
- A hook ref `pendingParentRef: Map<persistedId, createdId>` records reparents the client could not apply yet, because
  the reparented step is not present locally (its own create's response has not arrived).
- A pure, unit-tested function in `features/pipelines/state/`, e.g.
  `applyCreatedStep(local, tempId, created, reparentedStepIds, opts: { renderKey?, pendingParent, userRemoved })`,
  handles three cases:
  1. `created.id` is already present locally (a wholesale `syncStepsFromServer` from another handler, e.g. remove or
     duplicate, fetched after this create committed). Remove the temp if present, moving its `renderKey` (when given)
     and local `config` onto the present element. Apply nothing else: that replace is at least as new as this create.
  2. Otherwise, the temp is present. Replace it in place with the created step's server fields, except:
     - `config` keeps the temp's local config, as today's draft swap does, so an edit made in flight stays on the card
       while HEL-1321's flush PATCHes it;
     - `renderKey` is set only when given;
     - `parentStepId` is `pendingParent.get(created.id)` when present (with `rootId` cleared), else the server's.
     Then, for each id R in `reparentedStepIds`: if present locally, set `parentStepId = created.id` and clear
     `rootId` (every other field kept), UNLESS R's current local parent chain (following `parentStepId`) already
     reaches `created.id`. In that case R is below `created` locally, which only a later commit can have caused, so
     the local state is newer and is kept (skeptic r5 CR1). If R is absent, record `pendingParent[R] = created.id`
     unless the existing entry for R, if any, has a value whose local chain reaches `created.id` (same rule).
     When R's chain cannot be fully resolved (it reaches a step not present locally) the executor implements either
     (a) a three-way rule: skip when the chain reaches `created.id`, apply when it resolves fully without reaching it,
     otherwise record a deferred claim `(R, created.id)` re-evaluated on each later response and dropped on a full
     sync (preferred); or (b) the two-rule version above plus a Risks line limiting the guarantee to two creates per
     reparented id. **Chosen: (b)** (executor, cycle 2): an unresolved chain that does not reach `created.id` is applied. The "order-robust" paragraph below is worded to match the option chosen (skeptic r6 note 1).
  3. Otherwise, the temp is absent:
     - If the temp is NOT in `userRemoved` (it was dropped by another handler's wholesale replace), append the created
       step to the end of the array, with the same field rules as case 2, and apply `reparentedStepIds` as in case 2.
       The step the server created is never lost.
     - If the user removed it (`handleRemoveStep` records removed temp ids in a ref), change nothing. The server step
       is an orphan, which is pre-existing behaviour (follow-up noted, not filed).
- The updater is `setSteps(prev => applyCreatedStep(prev, ...))`. Its only side effect is idempotent writes to
  `pendingParentRef` (the same key/value on a StrictMode double-invoke). Entries are never needed after their step
  appears, and are kept small by deleting them when case 2 consumes them, which is idempotent too.
- `pendingParent`'s entry for `created.id` is deleted in every case (1, 2 and 3).
- Every case leaves every other element untouched, so local-only steps survive. The first frame after the response is
  structurally server-correct for every step present, with no intermediate wrong frame (skeptic r2 CR3) and no
  stale `stepsRef` read.

Why this is order-robust (skeptic r3 CR1): two creates X then Y committed at the same slot after A give the server
A→Y→X→B, where X's response reparents [B] and Y's reparents [X].
- If Y's response arrives first, X is still a temp, so `pendingParent[X] = Y`. X's response then swaps X in with parent
  Y (from the map, not its own stale `parent=A`) and reparents B under X: A→Y→X→B.
- In commit order, the plain case-2 rules give the same result.
Creates are NOT serialized, so there is no queue, no liveness bound to define, and no next-create resolution against
an unrendered state (skeptic r4 CR1/CR3). Insert placement no longer depends on indices at all (D11).

Call sites:
- The draft create's success path: its existing swap becomes `applyCreatedStep(..., renderKey = temp id)`. HEL-1321's
  in-flight-edit flush ordering around the swap is unchanged.
- `handleInsertStep`'s and `handleAddLaneStep`'s create-immediately branches: `applyCreatedStep` with no `renderKey`
  replaces their `syncStepsFromServer()` call. The card is keyed by the persisted id after the create, exactly as
  today's wholesale replace keys it (HEL-1294 remount semantics, C1). `handleAddLaneStep`'s tail attach reports no
  reparented ids.
- `markCreating`/`creatingStepIds` timing is unchanged (C1).
- Excluded, and why: `handleInstantiateShape` (adds each persisted step via `[...prev, persisted]`) and
  `handleAddOutputViaAggregateTail` (wholesale sync) keep their own flows. Residual hazard: a bottom-row append
  committing after a shape's first step, with its response arriving first, leaves that shape step with a stale parent
  until the next full sync (named in Risks; follow-up noted, not filed). Their wholesale syncs dropping a temp are
  handled by case 3.

Why no GET-backed reconcile: a GET snapshot can predate any other mutation the user makes meanwhile, and guarding it
needs a hook-wide mutation sequence with its own liveness rules (skeptic r2 CR1/CR2). Alternative rejected: keep
`syncStepsFromServer` in the immediate paths. It drops local-only drafts, the hazard HEL-1340 handed over.
Alternative rejected: serializing creates (skeptic r4: stale next-create resolution, an unbounded queue, partial
coverage).

Existing guard tests coupled to the removed resync (planned edits, each with its reason, and each rewritten guard
shown red by a mutation such as calling `markCreating(id, false)` before the create resolves):
- `PipelineDetailPage.creatingStep.test.tsx` "disables the toggle … until the resync lands" (~:238) and the lane-add
  in-flight case (~:310): hold the CREATE promise instead of the post-create GET.
- `PipelineDetailPage.draftCreate.test.tsx` "a later full resync keeps the created draft's card open" (~:400):
  retarget its trigger to a caller that still uses `syncStepsFromServer` (duplicate), so the `renderKey`-across-full-
  replace path stays exercised.
- `PipelineDetailPage.test.tsx` (~:2037-2042, ~:2083): remove the queued `getPipelineStepsMock.mockResolvedValueOnce`
  values meant for the post-insert resync (unconsumed once-values survive `jest.clearAllMocks` and leak into later
  tests), and express the server's post-insert truth through the create mock's `reparentedStepIds`.
- Tests pinning the gap-insert wire call (`createPipelineStep(..., position k, ...)` for a gap k > 0) change to the
  D11 `parentStepId` form, each listed with its reason. The gap-0 pin `(…, 0, undefined, undefined, "root-1")` is
  unchanged.
- Any other existing-test edit found necessary is stop-and-report.

**D6 — Coordination with HEL-1340.**
- Backend tasks (groups 1-2) run first and touch no frontend file.
- Before group 3, the executor stops and reports. The orchestrator asks the driver where HEL-1340's
  `usePipelineStepCreation` extraction stands. If HEL-1340 has merged, rebase onto main and make the D5 edits in
  `usePipelineStepCreation.ts`; otherwise follow the driver's instruction.
- HEL-1340's `PipelineDetailPage.draftCreate.test.tsx` item-1 test encodes today's head-splice placement in its
  post-create GET mock (its design D2). If that test exists on the base, update the mock to the fixed server placement
  in its own commit, with the reason in the message.
- Any other edit to an existing frontend test is a stop-and-report.

**D7 — Seam evidence (e2e).**
- Setup: one Playwright spec under `e2e/`, against this worktree's own servers (`DEV_PORT`/`BACKEND_PORT`), with a
  throwaway user, `isolateLivePage`, and at most 2 workers under `nice -n 19`.
- Flow: build a 2-step trunk, append via the bottom add row, insert via the gap between the two, reload.
- Assertion: the persisted order, through the rendered primary lane and the steps API.
- It must be red against the unmodified backend (record it).
- Every created user, pipeline and source id is recorded and deleted by id.

**D8 — Production check (read-only). Owner ruling 2026-10-06: agents never access production (C9); the driver runs the
query.** The exact SQL is `ac3-query.sql` in this change dir (also quoted in the PR body). The executor validates it
on the embedded test Postgres only: seed a root A->B through the UNFIXED rootId arm with two appends (expect
`head_run_len = 2` for that root) and a legitimately built trunk (expect 0 rows). That run proves the query; it is
evidence, not a committed regression test. The superseded access text below describes the signature only.
- Signature: any step N with a child A where `A.created_at < N.created_at`, with N created on or after 2026-09-05
  (HEL-968, v0.7.15). The strong form adds `A.updated_at = N.created_at` (same transaction timestamp), unless A was
  edited since.
- Report: counts of candidate steps and pipelines for both forms, how many pipelines have a single root, and how many
  candidate N are parentless heads.
- Disclose false positives: a deliberate gap-0 insert, reorders, and `(None, None)` `position` inserts also match.
- Access: only a documented, read-only production path. None was found in `docs/` at design time (skeptic round 1
  re-checked). If none is found, do not improvise credentials or proxies: record AC3 as unverified, and the
  orchestrator escalates the access question.
- Any repair is escalated as an owner ruling; no migration is written.

**D9 — Docs.**
Rewrite each of these to state D1 (`position` is root-trunk-scoped when `rootId` is given; its 422 range is that root's
trunk length; without `position`, a rootId create appends at that root's trunk tail):
- the `rootId` paragraph on `CreatePipelineStepRequest`, and the `position` paragraph's "whole-pipeline" claim;
- the in-code comment on the rootId arm;
- the JSON Schema `create-pipeline-step-request.schema.json`: the top-level description's `position` sentence and the
  `rootId` description.
The schema-drift pre-commit check must pass.

**D10 — HEL-1069 guard contract under the new anchor.** With `rejectIfReparents: true`:
- A `rootId` create with no `position` is refused only if that root's trunk-last step already has children (a tail
  lane), and appends otherwise.
- A `rootId` create with `position` 0 on a non-empty root is still refused.

Updates:
- `PipelineStepReparentRoutesSpec`'s "422 for a rootId anchor that already has root-level steps" is rewritten, in its
  own commit with the reason, into two cases: `position: 0` on a non-empty root (still 422, nothing written), and a
  no-position rootId append whose trunk-last step has a tail (still 422). It is no longer "rootId on a non-empty root
  always 422".
- A new case covers a no-position rootId append onto a childless trunk-last step: 201, nothing reparented.
- `mcp-pipeline-step-placement` gets a spec delta restating its "second same-root branch" scenario for the rootId anchor
  (that root's trunk-last step).
- The `add_pipeline_step` description's last sentence in `helio-mcp/src/tools/write.ts` becomes accurate (rootId
  appends at that root's trunk tail, guarded only if the tail has children). The executor checks for helio-mcp tests
  that assert on that text.
- HEL-1297 is running in helio-mcp, so this is a one-string edit and no package file is touched.

**D11 — An editor insert anchors on a persisted step id, never on an index.** Today a draft stores the gap index at
insert time and sends it whenever its config completes. Once `position` is honoured (D1), a trunk that shrank in
between turns that into a permanent 422 loop (the catch restores the same meta). A gap index can also count local-only
steps the server does not have, and any index goes stale under concurrent inserts (skeptic r2 CR4, r4 CR1).

Rule for `handleInsertStep`'s gap inserts, immediate and draft. Append via the bottom row is unchanged: `rootId`, no
`position`.
- At click time, compute the anchor from `buildLaneGraph(stepsRef.current, roots)`'s root-0 primary lane (the same
  inputs the river renders from; `PipelineRiverView`'s props do not change), with `isTempStepId` as the local-only
  test. The anchor is the nearest persisted step before the chosen gap, or HEAD when none precedes it.
- Wire call when the create is sent (now for the immediate path; on config completion for a draft, including every
  retry):
  - anchor S, still present locally as a persisted step: `parentStepId: S` (the existing splice-after-S arm: S's
    children, tails included, move under the new step, exactly as the position path would);
  - HEAD: `rootId: roots[0].id, position: 0` (D1's head insert; valid on an empty root too);
  - anchor S no longer present locally: `rootId`, no `position` (append at the trunk tail). The step is created and
    visible rather than stuck. A server-side delete racing the send yields a 422 and the existing failure toast. For
    a draft, the next retry appends once the local list has dropped the anchor (an anchor deleted in another tab stays
    until a reload; see Risks).
- Anchoring by id is order-independent: X after A and Y after B, sent in any order, give A→X→B→Y→C.
- The draft meta replaces `index` with the anchor (`HEAD` or a step id) and keeps what the schema fallback reads
  (`rootId`, `parentStepId`, `attachAsTail`). The orchestrator found only the create call reading `meta.index`; the
  executor confirms. Note that the meta's existing `parentStepId` field is the LANE-draft anchor, read by
  `getDraftFallbackSchema`. The insert anchor must be a distinct field, or a trunk draft would start resolving its
  schema as a lane draft. The executor keeps them distinct and tests it.
- Consequence: the editor no longer sends `rootId` + `position` k > 0. D1 still governs every API/MCP caller that does,
  and the editor's append and gap-0 paths (`rootId` with no `position`, and `position: 0`) exercise D1 directly.

## Risks / Trade-offs

- [Option (b) of D5's unresolved-chain rule] → the order-robust guarantee covers two creates per reparented id. A third create reparenting the same step, answered out of commit order while the step's chain runs through a step not yet present locally, can leave that step with a stale parent until the next full sync. Accepted, not covered by a test beyond the unit test that pins the applied behaviour.

- [`position` means two different things depending on `rootId`] → stated explicitly in the scaladoc, the JSON Schema
  and the spec. Both readings coincide for single-root, tail-free pipelines, which covers every pre-multi-root caller.
- [Append onto a trunk-last step that has tail lanes reparents those lanes under the new step] → identical to the
  `(None, None)` no-position behaviour today, and `rejectIfReparents` lets agents refuse it. Not changed here.
- [The D1 head rule differs from `trunkOfRoot` for a root with no `position == 0` root-level step] → deliberate, to
  match what the editor renders; the engine's `trunkOfRoot` is not changed; covered by a D4 case.
- [The delta resyncs only what the create touched] → that is the whole server-side effect of a create (D5), so this
  is complete for item 4. Drift from other sources (another tab, an agent) is unchanged: it is visible after the next
  full sync, as today.
- [A draft whose anchor was deleted is appended rather than placed] → visible and editable, and preferable to a stuck
  422 loop (D11). Covered by a test.
- [Pre-existing, not changed here] `handleReorderSteps`' success reconcile maps over its pre-request snapshot, so a
  create applied between the PUT and its response can be undone. A wholesale `syncStepsFromServer` GET fetched before a
  create commits but resolved after its response was applied removes that step until the next full sync. A draft whose
  anchor was deleted in another tab gets a 422 on every retry until a reload. Follow-ups noted, not filed.
- [Shape instantiate and aggregate-tail are outside D5's delta] → residual stale-parent window when a concurrent
  bottom-row append's response arrives before the shape step's; healed by the next full sync. Follow-up noted.
- [`pendingParentRef` writes from inside a state updater] → idempotent by construction; covered by the reverse-arrival
  test under React StrictMode if the test harness renders in StrictMode.
- [The remaining `syncStepsFromServer` callers (remove, duplicate, root removal, aggregate tail) still drop local-only
  drafts and overwrite local config] → pre-existing, outside the hazard HEL-1340 handed over (the insert resync).
  Follow-up noted, not filed. Likewise, the whole-array restore on a failed remove or reorder can reintroduce a swapped
  temp copy.
- [HEL-1340 conflict on the hook file] → D6 gate before any frontend edit.
- [HEL-1297 conflict on `write.ts`] → a one-string change; rebase if it lands first.
- [Shared dev DB residue] → record exact ids; throwaway users only; delete by id.

## Migration Plan

Code-only. Deploys with the next release. Rollback reverts the commit; no data shape changes. Existing misplaced
steps stay as they are pending an owner ruling (D8).
