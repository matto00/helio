## Context

HEL-1206 wire types (verified in ProvenanceProtocol.scala): auth `{outputId, pipeline{id,name}, sources[{id,name,kind}], nodePath[kinds], lastRun{status,completedAt,rowCount}|null, assertions{defined,passed,failed,warned,rootBound}}`; public drops ids/rootBound. `lastRun` is explicit null when never run. `rowCount` is null for BOTH an empty and an absent snapshot (ProvenanceService.scala:84), so: lastRun null -> "never run"; lastRun succeeded + rowCount null -> "last run produced no rows"; rowCount n -> n rows. No backend change (non-goal).

## Goals / Non-Goals

**Goals:** popover on all five render paths; lazy cached fetch; badge reuse; a11y; DESIGN.md cohesion.
**Non-Goals:** telemetry implementation (HEL-1208), meta.createdBy (HEL-1216), PanelCard split (HEL-1201/1183), backend changes.

## Decisions

1. **Trigger placement.** A small icon button in the panel footer, beside the type badge and the "Invalid data" badge (same row, PanelCard `panel-grid-card__footer`). Rationale: footer already carries data-health signals; header/actions is already crowded (drag handle, kebab) and a menu item would hide it one tap deeper on the exec-facing view. Per-path locations are fixed in Amendment A1 (supersedes any earlier wording). A shared `ProvenanceTrigger` component takes `{panelId, outputId, variant: "authenticated"|"public", dashboardId?}` so each path is one line.
2. **Own files.** `features/panels/provenance/`: `ProvenancePopover.tsx`+css, `ProvenanceTrigger.tsx`, `useProvenance.ts`, `provenanceService.ts`, `provenanceLabels.ts`, tests. PanelCard grows by only the trigger line and badge handler.
3. **Host.** `usePortalPopover` with `panelRef` attached (Amendment A3 governs: own Tab wrap, no panelRef; panel is `role="dialog"` with aria-label, focus moved in on open, Tab cycles, Escape closes and returns focus - the hook already returns focus on Escape).
4. **Cache.** Module-level cache keyed by `output:<id>` (auth) and `public:<dashboardId>:<panelId>` (public); in-flight promise shared; invalidated by nothing automatic except a new run event if one exists, else a short TTL is NOT used (second open must be served from cache). Badge: the popover cache's `assertions.failed > 0` is used once loaded; the existing assertion-status fetch is kept only for the badge's initial paint and must be replaced by, or deduped against, a shared per-output cached promise (no second uncached fetch per panel). Mechanism fixed in Amendment A4.
5. **Labels.** Reuse the existing op-label mapping the pipeline UI/StepCard uses for `nodePath`; unknown kinds fall back to a humanised string.
6. **Degraded states** as in the spec; "running" from lastRun.status, "failed" shows status only (public has no error text by contract; authenticated shows none either, link to pipeline).
7. **Telemetry hook.** `provenanceTelemetry.ts` exports a typed no-op `onProvenanceOpened(evt: {panelId, variant})` called on open.
8. **Public path.** Service signature `fetchPublicProvenance(dashboardId, panelId, token)`; the endpoint authorizes via `?token=` (anonymous viewers are denied without it). `PublicOutputPanelBody` already receives `{panel, dashboardId, token}`; the trigger's public variant carries the token. Cache key `public:<dashboardId>:<panelId>` (token NOT in the key: same panel, same public projection). Test asserts the request includes the token and that no link or id renders.

## Amendments (design gate round 1)

A1. **Concrete trigger location per path** (icon button, `aria-label="Data provenance"`, 44px hit area at phone width via the shared touch-target pattern):
- Desktop grid card: panel footer beside the type badge (PanelCard `panel-grid-card__footer`).
- Mobile stack: `mobile-panel-stack__header` beside the title (the stack has no footer) - rendered in MobilePanelStack, not PanelCard.
- Public viewer: a small row in `PublicOutputPanelBody` above `PanelContent` (no card/footer exists there), public variant.
- Fullscreen overlay and detail modal: the `Modal` header/actions slot (fullscreen: alongside existing header controls; detail modal: in the Output data section next to the existing output link).
- Detail modal relation: PanelDetailModal already renders an Output link to the pipeline. The provenance popover's authenticated "Open pipeline" link targets the same route (`/pipelines/:pipelineId?outputId=:id`); the two are not merged (the modal link names the output, the popover answers "where did this come from"); the popover link is labelled "Open pipeline" and the modal's is unchanged.
A2. **Event isolation.** Trigger and popover root `stopPropagation` on click/keydown so portal-bubbling never reaches `handleCardClick`/`handleItemClick`; tests on desktop card and mobile stack. Escape: ProvenancePopover handles Escape itself with `stopPropagation` + `preventDefault` on a capture-phase document listener while open, so an enclosing native-dialog Modal does not also close; `usePortalPopover`'s own Escape still returns focus. Inside a native `<dialog>` Modal the popover portals into that dialog element (not document.body) so it is in the top layer and inside the dialog's focus scope; executor verifies live in fullscreen and detail modal.
A3. **Focus trap.** ProvenancePopover implements its own small Tab/Shift+Tab wrap, moves focus into the panel on open, and attaches NO `panelRef` (so the hook does not close on focus-out); Escape and click-outside close; focus returns to the trigger.
A4. **Badge mapping.** Badge (now a real `<button>` with label "Data checks failed - view provenance") shows iff assertion-status `invalid` (existing semantics; equals failed > 0 by construction - executor confirms against the backend and records). Click opens the popover scrolled/focused to the Checks section. Dedupe: a module-level per-output in-flight/result promise cache wraps `getAssertionStatus` so N consumers of one output share one request; the badge fetch on initial paint remains (popover is lazy), but once the provenance cache is populated the badge derives from it. Provenance `warned`/`rootBound` do not affect the badge.
A5. **Labels.** `provenanceLabels.ts` maps `nodePath` kinds through `OP_TYPES` (features/pipelines/state/stepNarrowing.ts), unknown kinds fall back to a humanised string. nodePath is step kinds, trunk-first, primary parent chain only; a root-bound output has an EMPTY path, rendered as "Direct from source" (no path row of separators).

## Risks

Mobile stack and public viewer wiring missed (HEL-1027 precedent): each path gets its own test plus live verification. Gate chain: no `.husky` changes.
