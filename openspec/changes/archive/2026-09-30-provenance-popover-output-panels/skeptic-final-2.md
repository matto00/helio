## Skeptic Report - final gate (round 2, skeptic-final-2.md)
Reviewed HEAD b8f9658dde56d689ce889577f64a7437d3c83839

### What I verified (with evidence)
- Servers serve this worktree (cwd of 6639/9546 -> HEL-1207/frontend|backend); assert-phase servers PASS.
- Lazy: fresh load, network log showed assertion-status x1 per output (same as main) and ZERO provenance requests; first open -> exactly 1 provenance request. Escape closed, focus returned to trigger, reopen -> 0 new requests (cached).
- Invalidation (prior CR1) live: popover open (cached), POST /api/pipelines/fc63432d.../run (run 52c04ccb...). SSE event fired: assertion-status re-read for both outputs, next open refetched provenance; popover text "Last run 15 seconds ago" (was 6 minutes). Mutation: replacing invalidateProvenance(key) in ProvenanceTrigger.tsx with a no-op makes 1 provenance jest test fail (restored, git status clean).
- Badge (CR2): useDataInvalid.ts is driven only by the deduped in-flight assertion-status read and re-reads on invalidation; no cache-derived path. No second uncached assertion-status fetch per panel (one per output on load).
- Detached-opener focus (CR3): ProvenanceTrigger.tsx handleClose falls back to triggerRef when opener not connected.
- Five render paths live: desktop grid (dark), mobile stack at 390px (light), fullscreen overlay (light), detail modal (popover portals into the dialog; Escape closes only popover, focus returns), public viewer as truly anonymous (other origin http://[::1]:6639, /api/auth/me = 401, no cookie) desktop dark + phone light. Public: 1 token-authorized provenance request on open, no assertion-status request, no link in popover; raw public JSON contains only assertions counts, lastRun{completedAt,rowCount,status}, nodePath, pipeline{name}, sources[{kind,name}] - no ids/ownerId/config/error text; no-token request 404.
- Touch targets at 390px: trigger is 24px painted with a 44x44 ::after; elementFromPoint +-20px in all four directions hits the button.
- Screenshots (both themes, desktop+phone): .playwright-mcp/sk2-desk-dark-table.png, sk2-fs-light-chart.png, sk2-phone-light.png, sk2-public-dark.png, sk2-public-phone-light.png. Tokens, typographic hierarchy and spacing match sibling footer/popover chrome; light/dark parity fine.
- Gates: jest (matched 384 suites / 4046 tests) all pass, tsc --noEmit clean, eslint --max-warnings=0 clean.
- Red-first vs main: none of provenance/ exists on main (feature absent, tests are new); mutation above shows the invalidation test is failable.
- Overflow note: the evidence-dir mtime issue does not arise; no mtime-ordering claims used.

### Verdict: CONFIRM

### Non-blocking notes
- Empty rowCount wording ("Last run produced no rows") carried from round 1; consider "No rows recorded".
- Invalid-data badge opener not exercised live (no output with failing assertions in dev data); covered by unit tests only.
- Dev-DB residue I created: share token f5fb12eb-007a-47ed-a5d5-f9a661c43f7d on dashboard e690e243-5000-4e12-9f95-6440128808ed (deleted, 204). Two real pipeline runs on existing pipeline fc63432d-70ab-427e-8b23-5d9bd95db7c1 (one being 52c04ccb-2d85-4c9c-a21f-df6156ebab40); no delete route, left.
