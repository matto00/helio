## 1. Allowlist

- [x] 1.1 Edit root `.audit-ci.jsonc`: add the path-scoped (fallback bare-id) GHSA-vfj7-8cjw-p6xm record with the required inline comment, fix the stale "Empty today" header; verify `npx audit-ci --config .audit-ci.jsonc` exits 0 (and was exit 1 before).
- [x] 1.2 Prove not a blanket in a scratch copy only (never committed): with the entry present, add a different high advisory (e.g. a known-vulnerable dev dependency in a throwaway dir with the same config) and verify audit-ci still exits non-zero; also verify the same advisory on a non-micromatch path is not suppressed if feasible.
- [x] 1.3 Verify `cd frontend && npx audit-ci --config .audit-ci.jsonc` still passes untouched, and that CI (`.github/workflows/ci.yml`) audits only root and frontend/ (helio-mcp not audited).
