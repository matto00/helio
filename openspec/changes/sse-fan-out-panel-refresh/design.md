## Context

See proposal.md - Why. Relevant existing code (verified during Setup premise validation, see
`.concertino/runs/HEL-1094/evidence/premise-validation.md`):

- `usePipelineRunEvents` (`frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts`) opens an
  authenticated `fetch` + `ReadableStream` SSE connection to `GET /api/pipelines/:id/run-events`,
  parses `event: run-status` / `data: {...}` frames, and auto-closes on a terminal status. It is a
  React hook — one connection per mounted instance.
- Backend `PipelineRunRegistry.subscribe(pipelineId)` stores exactly **one** `ActorRef` per
  `pipelineId` in a `ConcurrentHashMap`; a second concurrent `subscribe` for the same pipeline
  silently overwrites the first (single-active-run assumption). Two per-panel hook mounts watching
  the same pipeline would starve each other.
- `Output.pipelineId` (frontend type) links an output-bound panel to its pipeline.
- `PanelCardBody` (`PanelCard.tsx:60-127`) already wires one per-panel refresh mechanism —
  `usePanelPolling(refresh, panel.refreshInterval, getOutputId(panel))` — right next to
  `usePanelData`'s `refresh()`. This is the natural second call site.
- SSE access is already sharing-aware (`PipelineRunStreamRoutes` → `pipelineExistsShared`): owner,
  editor, and viewer grantees of the *pipeline* may subscribe. Unmodified by this change.

## Goals / Non-Goals

**Goals:**
- Exactly one SSE connection per distinct `pipelineId` currently backing a mounted panel, per
  dashboard page — regardless of how many panels are bound to that pipeline's Outputs.
- Refetch only the panels actually bound to the pipeline that just succeeded.
- Keep watching across multiple runs while the dashboard stays open (reconnect after each terminal
  event), since the write → debounce → tick → run chain (HEL-1093) can take up to ~35s and the user
  may submit the form more than once in a session.
- Computed-ARIA-verifiable refresh announcement (Standing Constraint C4/C8 — no presence-only check).

**Non-Goals:**
- No change to `usePipelineRunEvents.ts`, `PipelineRunStreamRoutes`, or `PipelineRunRegistry` — the
  single-subscriber-per-pipeline backend limitation is worked around entirely in the frontend by
  never opening more than one connection per pipeline from one dashboard page. A concurrent viewer
  on the pipeline's own detail page, or a second browser tab, opening its own connection to the same
  pipeline independently is a pre-existing, separate limitation, not fixed here.
- No optimistic-update UI for the writing panel (design spec §4 "Optimistic state" — separate
  ticket).
- No bulk/batched Output-metadata endpoint; each panel resolves its own `pipelineId` exactly as
  `useOutputMeta` already does elsewhere.

## Decisions

**D1 — Module-level fan-out manager, not a React Context provider.** A plain module-scoped
singleton (`pipelineRunFanout.ts`) keyed by `pipelineId`, holding a listener `Set` and one active
connection per key. `subscribeToPipelineSucceeded(pipelineId, onSucceeded): () => void` — ref-counted
via listener-set size: the first subscriber for a `pipelineId` opens the connection, the last
unsubscribe closes it. Chosen over a Context provider because `PanelCardBody` instances are
scattered across the grid tree with no existing shared ancestor wrapper to attach a provider to
without a broader restructure; a module singleton needs no tree change and mirrors the existing
"self-contained hook" style of `usePipelineRunEvents`/`usePanelPolling`.

**D2 — A new, deliberately minimal standalone SSE parser, not a refactor of
`usePipelineRunEvents`.** The manager needs the same wire format (`event: run-status` /
`data: {"status": ...}`) but only cares whether a terminal status is `succeeded` — it does not need
`rowCount`/`nodeId`/`node-progress` handling. Duplicating ~30 lines of frame-parsing is a smaller,
safer diff than refactoring a well-tested, already-shipped hook mid-ticket to share an extracted
core; see Risks below for the accepted trade-off.

**D3 — Reconnect after every terminal status, not just once.** The manager, after delivering a
terminal event to its listeners, immediately re-opens the connection for that `pipelineId` if any
listener remains subscribed (do this for `succeeded`, `failed`, and `dry_run` alike — only
`succeeded` triggers a refetch, but any terminal status ends that stream server-side and must be
re-opened to catch the *next* run). This is what satisfies "watch across multiple runs" — a single
one-shot subscription (as `usePipelineRunEvents` does today, by design, for the pipeline detail
page's single-run-at-a-time use) is not sufficient here.

**D4 — `usePanelRunRefresh(outputId, refresh)` hook, called once per output-bound panel in
`PanelCardBody`.** Resolves `pipelineId` via `useOutputMeta(outputId)` (same hook already used in
`OutputPanelContent`; a second GET per panel, consistent with the existing per-panel
`getAssertionStatus` fetch pattern in `PanelCard.tsx`), then calls
`subscribeToPipelineSucceeded(pipelineId, refresh)` in a `useEffect`, cleaning up on unmount or
`pipelineId` change. No-ops for non-output panels (`outputId` is `null`).

**D5 — Accessible announcement via a dedicated, visually-hidden `role="status"` region.** Add one
per output-bound panel (in `PanelCardBody`, alongside the existing content), whose text is updated
(not merely re-rendered with identical text) each time `usePanelRunRefresh`'s callback fires a
refetch that actually completes — e.g. `"${panel.title} updated"` with a monotonically-changing
suffix (a counter or timestamp) so two consecutive refreshes are each independently announced even
if the visible data is unchanged. Verified in Evaluation/Skeptic gates via Playwright's accessibility
snapshot (computed name/value), never by grepping for the `aria-live`/`role="status"` attribute in
markup (Standing Constraint C4). Reuse the codebase's existing visually-hidden `.sr-only`/
`role="status"` convention already established in `frontend/src/shared/ui/Toast.tsx` (and
`theme.css`'s `.sr-only` recipe) rather than reinventing the CSS (skeptic design-gate round 1,
non-blocking note).

**D6 — Bounded exponential-backoff retry on a non-terminal connection failure (skeptic design-gate
round 1, CR1).** D3 covers reconnect-after-*terminal-status* only; it does not cover a connection
that never reaches a terminal `run-status` event at all — a non-2xx response, a non-`text/event-stream`
`Content-Type`, a `fetch` network error, or a stream that ends/errors mid-flight. Because the manager
is a page-lifetime singleton (D1) whose only resubscribe trigger is a listener-count 0→1 transition,
an unhandled connect failure — at first mount or after any later reconnect — would otherwise silently
and *permanently* disable refresh for that `pipelineId` for the rest of the dashboard session, with no
further event ever re-triggering a retry. `usePipelineRunEvents.ts` already treats this as a distinct
failure class (`connectionError` state) — the same class of failure is reachable here.

Resolution: on any such failure, the manager schedules a retry via an exported pure function
`computeRetryDelayMs(attempt: number): number = Math.min(1000 * 2 ** attempt, 30000)` (attempt starts
at 0, resets to 0 on the next successful connection), and re-attempts `connect()` after that delay as
long as at least one listener remains registered for that `pipelineId`. This is deliberately unbounded
in attempt *count* (a dashboard can stay open indefinitely and should keep trying) but bounded in
*delay* (caps at 30s, so recovery after a transient blip — e.g. a brief network drop or a Cloud Run
cold start — is never more than 30s away). No separate user-visible error state is introduced — D5's
announcement still fires only on a completed refetch; a connection retry is an internal recovery
mechanism, not a new UI surface, since the ticket's AC concerns refresh happening automatically, not
surfacing transient network health. Verified by a unit test using fake timers: a simulated connect
failure is followed by exactly one retry `fetch` call after the computed delay elapses, and a
subsequent successful connection resets the backoff.

## Risks / Trade-offs

- [Duplicated SSE frame-parsing between `usePipelineRunEvents.ts` and the new manager] → Accepted:
  keep the duplicate deliberately minimal (status field only); a follow-up ticket to extract a
  shared low-level connector is a reasonable standalone candidate, not required for this AC.
- [A pipeline-detail-page viewer and a dashboard viewer of the same pipeline open independent
  connections, still hitting the backend's one-subscriber limit] → Not fixed here (Non-Goals); flag
  as a standalone follow-up during Delivery triage rather than silently expanding this ticket's
  scope.
- [Per-panel `useOutputMeta` GET duplicates the fetch `OutputPanelContent` already performs for the
  same `outputId`] → Accepted, consistent with existing per-panel fetch patterns in this codebase;
  not a regression this ticket introduces a new instance of, just one more.
- [Reconnect-after-terminal loop could hammer the backend if a pipeline fails repeatedly in a tight
  loop] → Bounded by the existing debounce (HEL-1093) and run guard (HEL-505) on the trigger side;
  the reconnect itself is a single `fetch` per terminal event, not a polling interval.
- [A connection failure that never reaches a terminal `run-status` event could otherwise silently and
  permanently disable refresh for the rest of the dashboard session] → Mitigated by D6 (bounded
  exponential-backoff retry, capped at 30s, unbounded in attempt count while a listener remains) —
  found by the design-gate skeptic round 1; no longer an open risk.

## Planner Notes

- Capability name `panel-run-refresh` chosen (new, frontend-only) rather than modifying
  `pipeline-run-sse` (backend, unchanged) or `panel-polling` (interval-based, a distinct trigger
  mechanism) — self-approved, no external dependency or breaking change involved.
- The a11y region design (D5) is a genuinely new small UI surface, not specified by the ticket text;
  self-approved as the direct implementation of Standing Constraint C4, not scope creep.
