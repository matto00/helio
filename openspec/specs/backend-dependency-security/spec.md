# backend-dependency-security Specification

## Purpose
Keeps the backend's lz4-java dependency on a version with no known OSV advisory (at.yawk.lz4 >= 1.11.4), with no lz4-java suppression in the osv-scanner gate.

## Requirements

### Requirement: Backend lz4-java resolves to an advisory-free version
The backend build SHALL resolve exactly one lz4-java artifact on the compile classpath, and it SHALL be
`at.yawk.lz4:lz4-java` at a version for which OSV reports no lz4-java advisory (>= 1.11.4). `backend/osv-scanner.toml` SHALL NOT suppress any lz4-java advisory.

#### Scenario: SBOM carries a single fixed lz4-java
- **WHEN** `sbt generateSbom` is run in `backend/`
- **THEN** `target/sbom.cdx.json` contains exactly one component named `lz4-java`, in group `at.yawk.lz4`, version >= 1.11.4

#### Scenario: osv-scanner reports no lz4-java finding
- **WHEN** `osv-scanner scan --sbom=target/sbom.cdx.json --config=osv-scanner.toml` is run in `backend/`
- **THEN** no finding is reported for `lz4-java`

#### Scenario: Spark LZ4 codec still works
- **WHEN** Spark's `lz4` compression codec round-trips a payload on the backend's resolved classpath
- **THEN** the decompressed bytes equal the input
