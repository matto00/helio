## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Core premise (single-subscriber-per-pipeline backend limitation) — CONFIRMED against source.**
   Read `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala:66-105`:
   `subscribe(pipelineId)` does `refs.put(pipelineId, ref)` unconditionally (line 89) — a second
   concurrent `subscribe` for the same `pipelineId` silently replaces the entry with no signal to the
   orphaned first subscriber, which then never receives further `publish()` calls (line 97-104,
   `Option(refs.get(pipelineId)).foreach { ... }` — a `get` miss silently drops the event). This is
   exactly the "unconditional map overwrite" / "single-active-run assumption" the ticket and design.md
   describe. The design's core decision (frontend-only consolidation to one connection per
   `pipelineId` per dashboard page, D1/C5) is the correct, sufficient way to avoid ever triggering this
   inside one dashboard page.

2. **`PipelineRunStreamRoutes` access check — CONFIRMED against source.**
   `backend/.../PipelineRunStreamRoutes.scala:29` calls `runService.pipelineExistsShared`, and
   `PipelineRunService.scala:913-917` documents/implements it as "Returns true for owner AND grantees
   (editor/viewer)." No backend change is proposed or needed — matches the design's Non-Goals.

3. **The ticket's flagged "ACL surface" design question is actually already resolved by an existing
   invariant, independently re-derived from source (design.md doesn't show this derivation, but it
   holds).** `backend/.../OutputService.scala:226-232` (`findById`, used by `GET /api/outputs/:id`)
   and lines 351-359 (`rows`, used by `GET /api/outputs/:id/rows` — the actual panel-data fetch) are
   both documented and implemented as "sharing-aware... owner, editor, and viewer grantees of the
   parent pipeline can read" / "an Output's rows are exactly as visible as the Output itself." That is
   the *same* grantee set `pipelineExistsShared` uses for SSE. So any dashboard viewer who can already
   see a panel's data (existing, unmodified code path) already has pipeline-viewer access and can
   legally subscribe to that pipeline's SSE — there is no new/wider exposure and no viewer who could
   see data but silently fail to subscribe. This resolves the "design question" the Setup context
   flagged, even though design.md doesn't spell out the reasoning (see non-blocking note below).

4. **`Output.pipelineId` and `useOutputMeta`/`PanelCardBody` claims — CONFIRMED against source.**
   `frontend/src/features/pipelines/types/output.ts:21-35`: `Output.pipelineId: string` (non-optional).
   `frontend/src/features/panels/hooks/useOutputMeta.ts` exists and returns `{ output, isLoading }` as
   claimed. `PanelCard.tsx:60-127` (`PanelCardBody`) already wires `usePanelPolling(refresh,
   panel.refreshInterval ?? null, getOutputId(panel))` right next to `usePanelData`'s `refresh` — D4's
   proposed second call site (`usePanelRunRefresh(getOutputId(panel), refresh)`) sits naturally
   alongside it, confirmed by reading the actual file.

5. **D5/a11y vs. Standing Constraint C4 — soundly specified.** D5 explicitly requires the `role="status"`
   region's *text* to change (a counter/timestamp suffix) on every completed refetch, specifically so
   two consecutive refreshes with visually-identical data are each independently observable via a
   computed accessible-name/description change — not mere presence of the region. Tasks 2.3 and 3.4
   correctly plan to verify this via Playwright's accessibility snapshot (computed state), matching
   C4/C8 exactly, not a markup-presence grep. D5's placement (in `PanelCardBody`, not inside
   `PanelContent`'s inner `panel.kind`/Output-`kind` dispatch chains) is a clean way to sidestep the
   "two dispatch chains" complexity the ticket's Setup context flagged (`PanelContent.tsx` outer
   dispatch on `panel.kind`, inner `OutputPanelContent` dispatch on Output `kind`) — since
   `PanelCardBody` always renders `PanelContent` unconditionally (confirmed by reading the file), this
   placement is not kind-gated and needs no special-casing per Output kind.

6. **Task list traces to AC and constraints.** Tasks 1.1-1.3 test C5 (one connection, closes on last
   unsub, reconnects after terminal). Tasks 3.1/3.2 test the fan-out-to-same-pipeline and
   scoped-to-different-pipeline requirements (spec Requirements 2 and 3). Task 3.3 is the real e2e path
   per the AC. Task 2.3/3.4 test C4. C2 ("show the red") is explicit on task 3.1.

### Gap found (required revision)

**Neither design.md nor tasks.md specifies what the fan-out manager does when the underlying SSE
connection fails to establish, or drops, *without* ever delivering a terminal `run-status` event** —
i.e. a non-2xx response, a non-`text/event-stream` `Content-Type`, a `fetch` network error, or a stream
that ends/errors mid-flight. D3 only defines reconnect-on-*terminal-status* ("reconnect after every
terminal status... for `succeeded`, `failed`, and `dry_run` alike"); a connect failure is a distinct
failure mode from any of those three statuses and is not covered.

This matters because the manager is a page-lifetime singleton (D1) whose only re-subscribe trigger is a
listener-count transition (0→1). Once a dashboard's panels mount, no further subscribe/unsubscribe
events naturally occur for the rest of the session. So:
- A transient failure at the very first `connect()` (dashboard just loaded, brief network blip, backend
  cold-start on Cloud Run) — or any later reconnect reached via D3 — would silently and *permanently*
  disable refresh for that `pipelineId` for the rest of the dashboard session, with no code path that
  ever retries.
- No task (1.1-1.3, 2.x, 3.x) builds or tests a retry/backoff path for this case.
- D5's a11y announcement only fires on a *successful, completed* refetch — there is no error-state
  signal either, so the failure is invisible to the user and to a screen-reader user alike.
- This is a real, evidenced risk in this exact codebase, not a hypothetical: `usePipelineRunEvents.ts`
  (the hook this design explicitly reuses the wire format from) already has to handle exactly this
  class of failure (`connectionError` state, lines 96-114, 191-196) — meaning the team already knows
  fetch-based SSE connections in this app can fail outside the terminal-status path.

Given the ticket's AC is literally "no manual refresh ... is required," an unrecoverable silent failure
mode undermines that guarantee. This needs an explicit design decision — either:
(a) specify a bounded retry/backoff on connect failure, with a task/test proving recovery after a
    transient failure clears, or
(b) if deliberately out of scope, add it as a disclosed, accepted risk in design.md's
    Risks/Trade-offs section (matching the precedent already set there for the other 4 risks), and
    adjust the AC/spec language so "no manual refresh required" is understood as "in the absence of a
    connection failure," not an unconditional guarantee.

Either resolves my concern — I am not mandating (a) specifically, only that the gap be closed one way
or the other rather than left unaddressed.

### Non-blocking notes

- D5 doesn't reference the codebase's existing canonical visually-hidden `role="status"` pattern
  (`frontend/src/shared/ui/Toast.tsx:146-171`, using the `.sr-only` recipe in `theme.css:279-287`) —
  which even carries a prior project lesson (cited inline: "skeptic-final-1.md CR1") about not
  stripping this exact kind of markup as dead code. Referencing/reusing that convention in design.md
  would keep the new region consistent with established practice rather than reinventing
  visually-hidden CSS; this is implementation-level and doesn't block the design.
- The ticket/task prompt cites `.concertino/runs/HEL-1094/evidence/premise-validation.md` as Setup's
  evidence file; it does not exist in this worktree (`.concertino/runs/` only contains `laws/`). The
  same substance is duplicated inline in `ticket.md`'s "Context carried from Setup premise validation"
  section, and I independently re-verified those specific claims (items 1-3 above) directly against
  the backend/frontend source, so this doesn't block the verdict — flagging only because it was cited
  as load-bearing evidence and is missing.

### Verdict: REFUTE

### Change Requests

1. Add an explicit decision (in `design.md`, with a corresponding task in `tasks.md`) for what
   `pipelineRunFanout.ts` does when a connection attempt fails or drops without a terminal `run-status`
   event (non-2xx/non-SSE response, network error, unexpected stream end) — either a bounded
   retry/backoff with a test proving recovery, or an explicit, disclosed risk acceptance in the
   Risks/Trade-offs section with adjusted AC/spec language. See "Gap found" above for full reasoning.
