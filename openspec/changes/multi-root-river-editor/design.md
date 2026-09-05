## Context

HEL-913 shipped the multi-root backend; HEL-912 shipped the parallel-lanes river. This change is the editor surface
for the former, built on the latter. It is frontend-only.

### Ground truth established during planning (re-enumerated from the tree, not carried from the ticket)

This epic has repeatedly shipped stale file enumerations, so every claim below was verified against the worktree at
`8bb88c0e` and each is falsifiable by a named command.

- **`buildLaneGraph` structurally cannot represent a second root.** `stepTree.ts:53-73` folds `steps` into
  `childrenByParent` plus a single `root`, chosen as the *first* parentless step (`else if (!root) root = s`,
  `:65`). Every subsequent parentless step matches neither branch: it is not enqueued (`:90`, `queue` is seeded
  from the one `root`), so it never enters `lanes`, and never gets a `laneOfStepId` entry. **A second root's entire
  lane is silently dropped today** — not mis-ordered, not mis-labelled, absent. This is the defect at the centre of
  this change, and the comment at `:66-69` states the now-false single-root assumption explicitly.
- **The wire already carries root membership; the UI type discards it.** `PipelineStep.rootId: string` exists
  (`types/pipelineStep.ts:485`, HEL-913 task 7.6a), but the UI `Step` (`types/step.ts:21-43`) has no `rootId`
  field, so `pipelineStepToStep` drops it at the boundary. The data needed to group lanes by root is already
  arriving and is being thrown away.
- **`Pipeline.roots[]` exists and is read in exactly four display sites, all taking `roots[0]`:**
  `hooks/usePipelineDetailPage.ts:357`, `ui/PipelineDetailPage.tsx:151`, `ui/PipelineListTable.tsx:105`,
  `ui/PipelineDetailHeader.tsx:45`. Verified by `grep -rn 'roots\[0\]' frontend/src`.
- **No frontend binding exists for either root route.** `grep -n 'roots' frontend/src/features/pipelines/services/*.ts`
  returns zero. The backend routes exist (`PipelineRoutes.scala:88`, `:97`). This change adds the two client
  functions.
- **The inline-source flow is a composition, not a component.** `CreatePipelineModal.tsx:170-200` composes a
  `Select` over existing sources with a nested `AddSourceModal` ("Create a new source"), which supports every
  source kind including paste-table. "+ root" reuses that same composition rather than reimplementing it.
- **No `root:` path rendering exists anywhere.** `grep -rn 'root:' frontend/src` returns zero construction sites.
  R5's format is being implemented for the first time; nothing is being migrated and nothing asserts the old form.

### Constraints inherited from the run

No Flyway migration (shared dev Postgres, two parallel runs). No backend, `schemas/`, or MCP edits — those are
HEL-913's, already delivered, and touching them would collide with siblings HEL-844/HEL-970/HEL-893.
`npm run typecheck` cannot catch a wire-shape break here (the frontend's types are not compile-time-coupled to
backend JSON — exactly how HEL-913 shipped a broken create flow with every gate green), so the running app is the
proof for anything crossing the wire.

## Goals / Non-Goals

**Goals.** Make the lane graph root-aware. Render one column per root. Add and remove roots from the editor.
Render R5 node paths. Hold mobile stacking and touch targets.

**Non-Goals.** The backend (HEL-913). MCP (HEL-914). Reorder semantics for multi-root (HEL-973). HEL-970's
`pathToRoot` rejoin-preview defect. Connector root kinds (v0.9).

## Decisions

### D1 — `buildLaneGraph` takes roots as an explicit parameter; it does not infer them

Signature becomes `buildLaneGraph(steps: Step[], roots: PipelineRoot[])`. Lanes are seeded one per root, in
`position` order, from that root's root-level steps (`step.rootId === root.id`), replacing the
first-parentless-step heuristic entirely.

*Why not infer roots from the steps?* Because inference is what is broken today, and because a root with **no
steps** is a representable and expected state (R6: "a new root starts with no steps: it is an empty lane"). A
graph derived only from `steps` cannot see such a root at all, so "+ root" would appear to do nothing until the
first step was attached. Passing the authoritative root set makes the empty-lane case fall out for free.

*Why an explicit parameter rather than a repository/hook lookup inside?* To keep `buildLaneGraph` a pure function
over data, so "root columns lay out deterministically" (AC2) stays a Jest assertion on a return value rather than
a render-order observation — the same reasoning `laneLayout.ts:1-4` already records for `computeLaneLayout`.

**`Lane` gains `rootId: string`,** and `LaneGraph.primaryLaneId` — a single-root concept — is **removed**, not
retained alongside. Keeping it would leave a field whose name asserts a privileged lane, which is precisely R3's
prohibition; and it is the field a future reader would reach for to reintroduce `roots[0]`-as-trunk. Its callers
are re-pointed at the lane's own `rootId`. This is a deliberate breaking change to an internal type, caught at
compile time by `tsc`, which is where a rename like this *is* reliable (unlike a wire shape).

### D2 — Column ordering groups by root, then by the existing sibling rule

Root `position` ascending is the outer sort key; within a root, HEL-912's existing breadth-first sibling-position
traversal is unchanged. So a root's lanes are contiguous (never interleaved with another root's), which is what
makes a "column per root" readable rather than a shuffled set of columns.

This reads root `position`, which R3 permits explicitly — R3's first named tiebreak is presentation order. It
grants no root different data, permissions, or lifecycle. **No code in this change branches on `position === 0`**;
that is assertable by `grep -rn 'position === 0\|position == 0' frontend/src/features/pipelines` returning zero,
and the design gate should treat a non-zero result as a violation.

### D3 — The R5 node path is built by one exported pure function, used everywhere a path is shown

`nodePath(stepId, steps, roots): string` in `state/`, returning ids joined by `" > "` with a `root:<rootId>` head.
Display-name substitution is a separate render-time concern layered over it, per R5's "the editor may substitute
display names at render time" — the function returns the canonical id form so it is directly assertable against
the contract.

A node reachable from several roots resolves through the **lowest-positioned** originating root (R5's canonical
tiebreak, which is R3's ordering applied to the same purpose). The traversal follows the same two edge kinds
`laneLayout.ts` already unions — `parentStepId` and a rejoin's `{kind:"lane"}` `secondaryInput` — so a rejoin's
path is reachable at all. Implementing this as one function rather than inline template strings at each display
site is what makes AC3's "not the single-root form" checkable by a grep for the stale form returning zero.

### D4 — "+ root" reuses `CreatePipelineModal`'s composition; the confirm control is disabled on an unset id

The affordance opens a picker over existing sources with an always-available "Create a new source" path into
`AddSourceModal`, mirroring `CreatePipelineModal.tsx:170-200`. **The submit control is disabled whenever no source
id is held**, and the handler additionally refuses to issue a request with a falsy id.

Both guards, not one: the disabled attribute is the affordance, and the handler check is the invariant. HEL-620
was exactly a picker defaulting to an unset id and issuing a request that 404'd on the ACL check; a disabled
button alone is a UI state that a race or a programmatic call can bypass, so the request path carries its own
refusal. This is asserted by a Jest test that calls the handler with no selection and asserts the service was
never called — not merely that the button renders disabled.

### D5 — Root removal confirms against a fetched placement count, and surfaces named refusals

Removal reuses the existing step-deletion confirmation pattern, showing the count of panel placements about to be
destroyed before any request is issued. The backend's two refusals (R7 phase 1: last root; surviving lane
referencing a deleted node) are mapped to distinct user-facing messages, with the referencing step named in the
second.

*Why surface them rather than pre-empt them client-side?* The backend evaluates both checks inside the removal
transaction (R7), and a client-side pre-check would be a second, drifting implementation of a rule whose
authoritative version lives in the service layer — the "two implementations of one invariant" class this epic has
been bitten by. The client renders the server's refusal; it does not re-derive it.

### D6 — Mobile: the existing lane-column stacking mechanism is extended, not duplicated

Root columns are the same column primitive HEL-912 already made responsive, so the 375px/430px behaviour and the
>=44px touch-target guard are inherited by construction. The new controls ("+ root", root remove) are the only
genuinely new touch targets and are the ones AC4 must measure. Measurement is a computed-style/bounding-box
assertion in the running app, not a CSS source reading — a declared `min-height` proves nothing about the rendered
box, which is the "evidence-shaped non-evidence" trap this project has recorded.

## Risks / Trade-offs

- **Removing `primaryLaneId` touches every current lane consumer.** Mitigated by it being a compile-time break in
  a purely internal type: `npm run typecheck` enumerates the call sites exhaustively, which is the one enumeration
  method this epic's stale-list problem does not defeat.
- **The wire's `rootId` may be absent on some step-response path.** R4 flags exactly this: HEL-913 task 7.6a
  required every `fromDomain` call site to pass `rootId`, and a missed site emits a step claiming no root. Since
  typecheck cannot catch it, the executor must verify in the running app that every step in a two-root pipeline
  carries a `rootId`, and treat a missing one as a finding to report (it would be a HEL-913 defect, not this
  ticket's to fix silently).
- **HEL-970's live `pathToRoot` defect sits in this feature area.** Preview may 422 on a non-ancestor lane rejoin.
  This is explicitly not this change's to fix or work around; it must be noted and stepped around, not absorbed
  into the editor as a workaround that would later have to be unpicked.

## Migration Plan

None. No schema, no data, no persisted-shape change. The only breaking change is the internal `LaneGraph` type,
resolved within this change's own commit.
