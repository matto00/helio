## Standing Constraints

- [C1] Allowlist entries are the audit-ci-reported path verbatim (trailing `>` kept) + `*`; no leading `*`; no `picomatch*`; grouping only as `<full-head>>*`
- [C2] The negative proof runs the installed audit-ci CLI (npm shim or scratch lockfile), never a reimplemented matcher, and includes an allowlisted positive control

## 1. Investigation

- [x] 1.1 Record audit-ci "Found vulnerable advisory paths" for GHSA-fc5q-39xc-vjpf in root and frontend/ (evidence/)
- [x] 1.2 Record `npm audit --omit=dev` (0) in root and frontend/ (evidence/)
- [x] 1.3 Verify every distinct head package is `"dev": true` in that tree's lockfile; record (D3)
- [x] 1.4 Confirm no picomatch > 4.0.7 exists and jest@30 fixAvailable is not a picomatch patch; record
- [x] 1.5 Re-check GHSA-vfj7-8cjw-p6xm (advisory state + root audit report); record decision (D5)

## 2. Config

- [x] 2.1 Root `.audit-ci.jsonc`: add head-anchored GHSA-fc5q-39xc-vjpf entries + HEL-1751 comment (D2, D6)
- [x] 2.2 Root `.audit-ci.jsonc`: remove or extend the HEL-1246 braces entry per 1.5
- [x] 2.3 `frontend/.audit-ci.jsonc`: add head-anchored entries + HEL-1751 comment; update header comment

### Tests

- [x] 3.1 `npx audit-ci --config .audit-ci.jsonc` exits 0 in root and frontend/; record output
- [x] 3.2 Negative proof running installed audit-ci CLI (npm shim/scratch lockfile), both configs: control path not
  reported; prod-lib>micromatch, prod-lib>tinyglobby, direct picomatch reported, exit non-zero; record (D4)
- [x] 3.3 Mutation: drop one real entry, audit-ci goes red; restore; record
- [x] 3.4 helio-mcp audit still exits 0; record
