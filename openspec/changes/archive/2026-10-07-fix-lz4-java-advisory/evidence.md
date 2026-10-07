# HEL-1367 evidence
- Red (main build, osv-scanner v2.5.1 + CI jq filter): GHSA-mcr4-qmvw-px4g, max_severity 7.3, package lz4-java. Classpath: at/yawk/lz4/lz4-java/1.8.1.
- D2(a) held: `show Compile/dependencyClasspath` lz4 line = at/yawk/lz4/lz4-java/1.11.4/lz4-java-1.11.4.jar (single); SBOM: one component at.yawk.lz4 lz4-java 1.11.4, 0 org.lz4. D2(b) not needed.
- Green: scan with cmp6/xx22 suppressions removed -> osv exit 0, failures [], 0 lz4 packages in results.
- Mutation: pin removed -> Lz4CodecSpec version assertion FAILED; restored.
- sbt testFull: 437 suites, 6087 succeeded, 0 failed.
