## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 08fed1529fbbfebefa64ba94b6f3ba1b3d87c916 against live base 9a57f7aa.

### What I verified (with evidence)
- Spawn-cwd guard READY. Diff read in full for backend (route, service, repo, protocol) and frontend (slice, sourceReferences.ts, SourceListTable, SourcesPage, SidebarBody, EmptySchemaAffordance).
- Servers: GET /api/data-sources/references on :9597 returns 401 unauthenticated and the correct body authenticated, so it serves this branch.
- UI live check in an isolated headless chromium (own Playwright script, no shared MCP browser touched), throwaway user registered via API, light AND dark:
  - Seeded: source referenced ONLY by a join secondaryInput, source referenced ONLY by a form panel, root-only source, unused source.
  - /sources "Used by": join-only = "1 pipeline" (title "skeptic-pipeline (join input)"), form-only = "1 form panel" (title "... form panel on skeptic-dash"), root = "1 pipeline", unused = "Unused". Identical in both themes.
  - Sidebar delete warning (join-only): "1 pipeline references this source, so deleting it will be refused until you remove that reference."; form-only: "1 form panel references this source ...". Legible in light (red on cream) and dark (salmon on near-black); reuses existing warning/Confirm/Cancel component, consistent with siblings. No console errors.
  - Screenshots persisted: /home/matt/Development/helio/.concertino/runs/HEL-1258/evidence/.skeptic-shots/{sources-light,sources-dark,sidebar-skeptic-join-only-light,sidebar-skeptic-form-only-dark}.png
  - Residue removed: dashboard, pipeline, 4 sources deleted via API by exact id (DELETE 204 each; references list empty afterwards); throwaway user 92aa20c8-1830-40c6-a52a-55ca48f3526b deleted by exact id (DELETE 1). Scratch files removed.
- AC1 (same kinds as 409 guard, one server source of truth): endpoint reuses DataSourceReferenceRepository.find via findReferencesFor; client has no counting, only formats the summary (sourceReferences.ts). Join-only and form-only sources shown correctly live.
- AC2 (visibility per HEL-1252): hidden refs are counts only (hiddenPipelineCount/hiddenPanelCount); the finder's explicit owner/grantee predicate is unchanged.
- C1 failability: DataSourceReferenceGuardNonSuperuserSpec 30/30 pass (my own run, incl. 7.1-7.4). 7.2 runs over a genuine NOSUPERUSER/NOBYPASSRLS app pool, asserts a liveness check (appRoleSeesPipeline == false), then asserts hidden ids/names do not appear in the SERIALISED route body and hidden counts equal 1 per kind; any predicate that exposed hidden resources would put names on the wire and fail. 7.3 proves granted pipeline/dashboard are named, 7.4 proves stranger sources never appear. I did not run a source mutation (read-only guardrail); judgment from the assertion shape, not a measured red.
- No N+1: findReferenceSummaries = one owned-id read + the finder's three queries, constant in N; owned ids come from the user-context read with an explicit owner_id predicate, so no hidden counts can be probed for another's source.
- Freshness: refetch on every SourcesPage mount and whenever the sidebar sources section activates; thunk `condition` dedupes concurrent dispatch; a refused delete re-fetches; successful delete removes the entry. "—" shown until referencesStatus == succeeded (also on failure, never a false "Unused"); verified in summarizeSourceUsage and tests. Third site (EmptySchemaAffordance) also migrated.
- Gates re-run: jest over sources/Sidebar/CommandPalette/etc patterns 413 suites / 4308 tests passed; `npm run typecheck` and `npm run lint` clean.

### Verdict: CONFIRM

### Non-blocking notes
- Staleness is bounded to navigation/mount; a reference added in another tab is not reflected until the next mount or a refused delete (which refreshes). Acceptable.
- No measured mutation of the 7.x visibility proof was run by me.
