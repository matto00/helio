# HEL-1094: SSE fan-out: refresh panels bound to an affected Output

## Description

Reuse the existing `usePipelineRunEvents` channel rather than inventing one. On `succeeded`, panels bound to an affected Output refetch.

**AC:** a form submit on one panel visibly updates a chart panel bound to the downstream Output, without a manual refresh and without a full page reload.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), §4 "Write → run → refresh loop":
> **Fan-out.** Reuse the `usePipelineRunEvents` SSE channel; panels bound to an affected Output refresh on `succeeded`.

## Acceptance Criteria

- A form panel submit that triggers a downstream pipeline auto-run (HEL-1093: debounced write → scheduler tick → `PipelineRunService.submit`) results in a chart panel bound to that pipeline's Output visibly updating once the run succeeds.
- No manual refresh and no full page reload is required.
- Refetch is scoped to panels actually bound (via Output → pipelineId) to the pipeline that just succeeded — not a dashboard-wide refetch of every panel.

## Context carried from Setup premise validation

- `usePipelineRunEvents` (`frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts`) already exists and is the channel to reuse — do not invent a new one.
- The backend `PipelineRunRegistry` holds exactly **one** subscriber per `pipelineId` (an unconditional map overwrite on a second `subscribe`, "single-active-run assumption"). Two independent per-panel mounts of `usePipelineRunEvents({pipelineId})` for the *same* pipeline will silently steal each other's registry slot — the earlier subscriber never receives the terminal event. The fan-out design must consolidate to one SSE connection per relevant `pipelineId` per dashboard page, and fan the received event out to every panel bound to that pipeline's Outputs in the frontend.
- The SSE stream's own access check (`PipelineRunStreamRoutes` → `runService.pipelineExistsShared`) is already sharing-aware (owner/editor/viewer grantees of the *pipeline*) — a non-owner pipeline grantee can legally subscribe today. Whether dashboard sharing and pipeline sharing are the same ACL surface for every viewer of a shared dashboard is a design question to resolve explicitly, not assume.
- `Output.pipelineId` (frontend type) is the key linking an output-bound panel to the pipeline whose run-events indicate it should refetch.
- `PanelContent.tsx` has two dispatch chains: outer on `panel.kind`, inner (`OutputPanelContent`) on the bound Output's own `kind` — both are relevant to where refetch-driven re-render needs to land cleanly.
- Existing precedent for a per-panel refresh hook: `usePanelPolling` wired in `PanelCardBody` (`PanelCard.tsx:80`) alongside `usePanelData`'s `refresh()`.
