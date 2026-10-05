## Skeptic Report — design gate (round 2, skeptic-design-2)

### What I verified (with evidence)
- Round-1 CR1 is fixed: design D5 + task 2.2 now derive main()'s manifest directories from the config's npm entries (live main() at scripts/check-dependabot-groups.mjs hardcodes ["/", "/frontend"] with a tolerant catch; coverage loop `if (!manifest) continue` confirmed). Task 3.3(b) mutation covers the coverage path (spec scenario "Grouping check covers helio-mcp").
- helio-mcp/package.json production deps are exactly @modelcontextprotocol/sdk and zod, both in the planned mcp-sdk family, so the coverage loop will be green; both devDeps fall to dev-dependencies catch-all declared after.
- Dependabot entry mirrors "/" (weekly, limit 10, dependencies label); exact-name patterns honor the file header's no-wildcard rule.
- verify.ts live: create_pipeline still sends `source:` (line ~222); only two write tools called (create_pipeline, add_outputs_from_shape x3). tool schema requires roots min(1) (src/tools/pipelines.ts:101). createServer(api) exists (src/server.ts:28) and server.test.ts already drives it with a fake api, so the in-process drift guard is feasible.
- Round-1 notes (expiresInDays backstop, assert on recorded api method) are incorporated in D2/D3. No TBD/placeholders; every ticket AC maps to a task (1.1-1.2, 3.5, 1.3/1.4, 3.1/3.2, 2.1); standing constraints C1-C4 match the driver constraints.

### Verdict: CONFIRM

### Non-blocking notes
- Design says helio-mcp/node_modules is "linked" to the main checkout; in this worktree it is a real directory (dated Sep 5, tsc present). Either way the plan (never npm install through it) is safe; executor should just verify before building.
- Teardown 401-confirmation and expiresInDays rely on backend behavior I did not re-derive this round (round 1 did); the live GREEN run (3.5) will prove it.
