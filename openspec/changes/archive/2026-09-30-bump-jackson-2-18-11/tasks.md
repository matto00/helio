## 1. Red-first
- [x] 1.1 Generate the SBOM on main and run osv-scanner (v2.5.1, backend/osv-scanner.toml); record both GHSAs flagged.

## 2. Bump
- [x] 2.1 Change the six Jackson pins in backend/build.sbt to 2.18.11 and extend the comment with both GHSA ids.

## 3. Verify
- [x] 3.1 Regenerate SBOM and re-run osv-scanner; record clean for both GHSAs.
- [x] 3.2 Show the resolved dependency tree has no Jackson artifact below 2.18.11.
- [x] 3.3 Run `sbt test` green.
