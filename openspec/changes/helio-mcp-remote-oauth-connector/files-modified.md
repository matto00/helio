Fold-in (tasks.md section 8, design D10) — paths outside the change directory:

- `.github/workflows/ci.yml` — pin `e2e` and `e2e-prod-build` to `ubuntu-24.04` (Playwright 1.55.1 vs 26.04)
- `.github/workflows/e2e-slow.yml` — pin the `e2e-slow` job to `ubuntu-24.04`
- `backend/build.sbt` — `dependencyOverrides` for guava 33.7.2-android and snappy-java 1.1.10.9
- `helio-mcp/package.json` — zod `^3.25.0` -> `^4.6.6`
- `helio-mcp/package-lock.json` — zod 4.6.7 (and the SDK's deduped zod)
- `helio-mcp/src/tools/connectorSchema.ts` — `.strict(MSG)` -> `z.strictObject(shape, MSG)` (zod 4 typecheck site)
- `helio-mcp/src/tools/restDataSourceSchema.ts` — `required_error` -> `error` (zod 4 typecheck site)
- `package-lock.json` — root transitive zod 4.3.6 -> 4.6.7 (lockfile only)
- `frontend/package-lock.json` — follow-redirects 1.16.1 -> 1.16.3, fast-uri 3.1.8 -> 3.1.9 (lockfile only)
- `scripts/check-cloud-run-cpu.mjs` — also checks `infra/deploy-mcp.sh` (must NOT carry `--no-cpu-throttling`; missing file / no deploy command fails)
- `scripts/check-cloud-run-cpu.selftest.mjs` — cases: flag present, absent, file missing, no deploy command, backend rule unchanged

Owner-accepted glob/minimatch overrides (8.3a):
- `package.json` — scoped temporary `overrides` for glob and minimatch (jest/typescript-estree parents)
- `frontend/package.json` — the same scoped overrides plus `workbox-build`
- `package-lock.json` — regenerated to match the overrides
- `frontend/package-lock.json` — regenerated to match the overrides
