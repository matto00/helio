- `backend/build.sbt` — bumped spark-core/spark-sql 3.5.5->3.5.9, postgresql 42.7.4->42.7.13,
  logback-classic 1.5.18->1.5.38; raised the Jackson `dependencyOverrides` pin 2.15.4->2.18.9 across all
  six Jackson artifacts on the classpath (added `jackson-datatype-jsr310` and
  `jackson-dataformat-toml`, previously outside the pin); added new `dependencyOverrides` for the netty
  family (12 artifacts, -> 4.1.137.Final), `grpc-netty-shaded` (-> 1.75.0), `protobuf-java` (-> 3.25.5),
  `ivy` (-> 2.5.2), `commons-lang3` (-> 3.18.0), log4j 2.x (-> 2.25.5), and `lz4-java` (-> 1.8.1). Clears
  65 of 70 baseline backend Maven advisories (70->5; the raw scanner output reads 70->3 and undercounts
  by the two relocated `lz4-java` advisories that never surface in the tree dump — see
  `openspec/changes/remediate-backend-dependency-cves/osv-after.md`).
- `openspec/changes/remediate-backend-dependency-cves/osv-after.md` — new: before/after OSV scan totals,
  remaining-advisory table with justification, scan-mechanics notes (lz4-java Maven relocation).
- `openspec/changes/remediate-backend-dependency-cves/tasks.md` — all tasks marked complete.
- `openspec/changes/remediate-backend-dependency-cves/design.md` — Context's scanner-defect list extended
  from four to five: documented the letter-prefixed-version regex gap found at the cycle-3 skeptic gate.
- `openspec/changes/remediate-backend-dependency-cves/osv-scan.py` — header comment documents the same
  fifth defect (unguarded, same style as defect #4).
- `openspec/changes/remediate-backend-dependency-cves/evaluation-1.md`, `skeptic-final-1.md` — reviewer
  reports, committed as-is for the record.
