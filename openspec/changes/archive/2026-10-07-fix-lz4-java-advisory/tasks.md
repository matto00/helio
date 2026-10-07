## Standing Constraints

## 1. Backend

- [x] 1.1 Record the current `main` red: generate SBOM, run osv-scanner v2.5.1 + CI's CVSS>=7 jq filter, keep full output
- [x] 1.2 Try D2(a) in `backend/build.sbt`; regenerate SBOM; check single at.yawk.lz4 1.11.4 component, no org.lz4
- [x] 1.3 If D2(a) fails the single-jar check, switch to D2(b); record both measured results
- [x] 1.4 Update the HEL-452 lz4 comment in `build.sbt` (relocation, cleared advisories, HEL-1367)
- [x] 1.5 Remove GHSA-cmp6-m4wj-q63q and GHSA-xx22-p4ch-683r entries from `backend/osv-scanner.toml`
- [x] 1.6 Re-run osv-scanner + jq filter on the new SBOM: zero groups, no lz4-java finding at all

## 2. Tests

- [x] 2.1 Add a backend spec: Spark `LZ4CompressionCodec` round-trip + `LZ4Factory` code-source is lz4-java-1.11.4
- [x] 2.2 Mutation: revert the pin locally, confirm the version assertion fails, restore
- [x] 2.3 Run `sbt testFull` (nice -n 19, no thin client); keep the full log
