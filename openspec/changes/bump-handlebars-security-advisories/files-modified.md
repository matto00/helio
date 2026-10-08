- `package-lock.json` — handlebars 4.7.9 -> 4.7.10 (in-range, ts-jest dev dep)
- `frontend/package-lock.json` — handlebars 4.7.9 -> 4.7.10 (in-range, ts-jest dev dep)

## Changed-version key sets (every packages[].version differing base vs branch)
- root: {"node_modules/handlebars": "4.7.9 -> 4.7.10"} only
- frontend: {"node_modules/handlebars": "4.7.9 -> 4.7.10"} only

## Audit (CI-verbatim)
- base: root exit 1, frontend exit 1 (GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f, GHSA-xw65-4hp5-5hc7 | handlebars)
- branch: root exit 0, frontend exit 0, helio-mcp exit 0 ("Passed npm security audit.")

## Tests
- `npm ci --ignore-scripts` (HUSKY=0, disclosed) root + frontend
- root `npx jest --maxWorkers=3`: 42 suites / 404 tests pass, exit 0
- frontend `npm test`: 475 suites / 4970 tests pass, exit 0; `npm run typecheck` exit 0
