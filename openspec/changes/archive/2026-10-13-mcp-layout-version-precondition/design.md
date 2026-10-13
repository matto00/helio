## Context

Server side (HEL-1457, merged): `LayoutCasRetry.run(existing, expected)` refuses a mismatched `expectedLayoutVersion`
with `ServiceError.LayoutConflict(existing)` → 409 `{message, dashboard}`; with no precondition it re-reads and
re-resolves up to 3 times, then 409. `PATCH /api/dashboards/:id` requires `layout` alongside `expectedLayoutVersion`
(400 otherwise, `DashboardServiceValidation`). Panel create, delete-strip, contents replace and patch-set apply all bump
the version via the V127 trigger.

helio-mcp today: `HelioApi.updateDashboardLayout` PATCHes `{ layout }`; `autoLayoutDashboard` POSTs
`{ items, cols, breakpoint }`; `DashboardResponse` (types.ts) has no `layoutVersion`; `HelioHttpClient` throws
`HelioApiError(status, url, describeError(...))` for any non-2xx and drops the parsed body; each tool file's `guarded`
renders an error as one text line. `placeOutputsHandler` creates panels then calls `autoLayoutDashboard` for sized
items.

## Goals / Non-Goals

**Goals:** an agent's full-breakpoint write is refused when the layout moved since its read; the conflict reaches the
agent with enough to recompute (the current dashboard); no client retry of any kind.

**Non-Goals:** server requiring the precondition; client-side rebase; non-layout tools (proposal.md Non-goals).

## Decisions

**D1. Type.** Add `layoutVersion: number` to `DashboardResponse`. `getDashboard` spreads the list record, so it
passes through with no further code; the evaluator must confirm on a live response that the list endpoint carries it.

**D2. `update_dashboard_layout`: precondition REQUIRED.** New input `expectedLayoutVersion: z.number().int().min(0)`,
required; the handler passes it to `updateDashboardLayout(dashboardId, layout, expectedLayoutVersion)`, which PATCHes
`{ layout, expectedLayoutVersion }`. Rationale: this tool sends complete breakpoints, the exact lost-update hazard.
Alternative rejected: optional with the tool reading the dashboard itself to fill the version — that read happens after
the agent computed its layout, so it protects nothing and silently reproduces the hazard. **Assumed product call A1**
(owner asleep): this is a breaking change to an agent-facing tool contract; external agents must pass the version.

**D3. `auto_layout_dashboard`: precondition OPTIONAL, forwarded when given.** Auto-layout is server-computed against
the row it read, and the server's no-precondition path re-packs against the fresh row; panels not named keep their
stored position, so no concurrent placement is dropped. Requiring a version would force a re-read after every
`place_outputs`/`create_content_panel` (each bumps the version), breaking the documented create-then-pack composition
(helio-news uses it). The tool description tells agents to pass it when they hold one. **Assumed product call A2**:
the AC lists auto-layout among the tools that send the version; this ships it as optional rather than required.

**D4. 409 handling: surface, never retry.** Retain the parsed error body on `HelioApiError` (new optional readonly
`body: unknown`, set by `HelioHttpClient` for non-2xx; constructor stays backward compatible). In `HelioApi`, the two
layout methods map a 409 whose body has an object `dashboard` to a new `HelioLayoutConflictError extends HelioApiError`
(status 409) carrying `current: DashboardResponse` and the `expectedLayoutVersion` sent (or `null`). The tools render
it as an `isError` result whose text is JSON: `{ error: "layout_conflict", message, expectedLayoutVersion,
currentLayoutVersion, dashboard, nextStep }`, `nextStep` telling the agent to recompute against `dashboard.layout` and
call again with `expectedLayoutVersion: dashboard.layoutVersion`. A 409 without a `dashboard` body stays a plain
`HelioApiError` (verbatim). No code path re-sends. Alternative rejected: re-read and reapply inside the tool — the tool
cannot know which items the agent intended to change versus copied from its stale read (the web client can, because it
tracks a base layout; an MCP call has no base), so a blind reapply is the same lost update.

**D5. Tool enumeration.** Every helio-mcp path that writes `dashboards.layout`:
- `update_dashboard_layout` — D2.
- `auto_layout_dashboard` — D3.
- `place_outputs` internal pack — no precondition: it positions only panels this same call just created, and its own
  creates bumped the version, so any agent-held version is stale by construction. The server re-packs on a miss. A
  final 409 is rendered per D4 plus `createdPanelIds` and "created but not positioned". Its success result gains
  `layoutVersion` from the pack response when a pack ran (additive) so an agent can chain a precondition.
- `apply_patch_set` (agent-authored `dashboard`/`update` edits whose `patch` carries `layout`) — IN SCOPE as a
  documented passthrough. Facts: the edit's `patch` decodes as an `UpdateDashboardRequest` including
  `expectedLayoutVersion` (`PatchSetApplyResolvers.buildDashboardUpdateResolved`), goes through `dashboardService.update`
  (`PatchSetApplyForward.scala`), and preview refuses a stale version (`PatchSetPreviewDashboardProjection.scala:30-32`);
  helio-mcp's `editSchema.patch` already forwards the key untouched (`refinementSchemas.ts`). Decision: no schema
  change (the patch is a free-form record and HEL-1458's optional `target.fingerprint` also guards a stale target);
  `propose_patch_set`/`apply_patch_set` descriptions and the README tell agents to put `expectedLayoutVersion` (the
  `layoutVersion` they read) in any dashboard `patch` that sets `layout`. Conflict behaviour (verified in
  `PatchSetApplyService.scala:141-147`): a stale version mid-set rolls the whole set back and returns **200** with
  `failure: "This dashboard's layout was changed elsewhere; the layout was not saved."` with `applicationId` omitted from the wire (verified live), no
  `dashboard` in the body. helio-mcp never calls the preview endpoint (the only 409-with-dashboard patch-set path). So
  the D6 helper is NOT wired to patch sets; the docs say: on that `failure`, re-read with `get_dashboard`, rebuild the
  layout patch, and resubmit with the new `layoutVersion`. The existing result is returned unchanged. A unit test
  asserts the key survives `editSchema` parsing into the request body.
- `replace_dashboard_contents` (PUT contents), `apply_proposal` / `apply_combined_proposal` (new dashboard),
  `undo_patch_set` (server-recorded inverse), `teardown_resources`, `create_content_panel`, `delete_panel`,
  `update_dashboard` (name only) — not applicable: the server accepts no caller precondition on them, the
  write targets a dashboard the call itself creates, or it is server-appended under the dashboard row lock. The
  executor SHALL re-derive this list from EVERY `this.http.post/patch/put/delete` call in `helioApi.ts` (about 48 at plan
  time), classify each as writes-layout / does-not, and record the table in files-modified.md.

**D6. Shared rendering.** `guarded` is duplicated per tool file; add one exported `layoutConflictResult(err)` helper
(zod-free module) used by `write.ts` and `placements.ts` rather than changing every `guarded`.

**D7. Verification.** Unit tests (jest, existing `*.test.ts` patterns with a fake http/fetch) cover: body carries the
precondition; required-input rejection; 409 → conflict result with dashboard, exactly one request sent; 409 without
dashboard body stays verbatim; place_outputs pack 409 names created ids. The required-input rejection test goes
through a real MCP `callTool` (only the registered zod schema enforces it). Plus one live seam check against the
worktree backend, run by a script in the change dir that calls the built helio-mcp handlers with a PAT for a throwaway
`@example.test` user it creates, and deletes that user by exact (id, email) via `e2e/support/userCleanupCore.cjs`
`buildUserDeleteSql`: read version N, bump it with a second write, call `update_dashboard_layout` with N → conflict
result; stored layout equals the second writer's. The session's own MCP client is NOT evidence (stale dist).

## Risks / Trade-offs

- Breaking contract (A1) → clear zod error naming the field; README + description say where the version comes from.
- Optional on auto-layout (A2) leaves a stale-intent pack possible → it cannot drop unnamed panels; owner may tighten.
- A 409 now costs the agent a re-read → intended.

## Planner Notes

- Self-approved: D1, D4–D7 (within the AC's stated options). A1/A2 recorded as assumed product calls; the PR gets an
  OWNER REVIEW section and is parked unmerged per the overnight rules.
- No migration (V131 untouched), no backend/frontend/schema change.
