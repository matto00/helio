## Standing Constraints

- [C1] The undo red test journals via a REAL pipelineStep-delete apply over Output rows stored with pre-V118 object formats (inserted directly), never a hand-written journal row; assertions read STORED configs from the repo.
- [C2] No migration and no stored-data change; normalisation is read-time at the two restore sites only.
- [C3] Every evidence sbt run shows a `[hel1468-guard]` line; new embedded-PG specs use `VerifiedEmbeddedPostgres.start`; no inline FQNs.

## 1. Red first

- [x] 1.1 Write the D5 end-to-end undo test (object-format rows + AC5 rows) and the RestorePriorStored update test plus a SUCCEEDING ValidateWrite control (mutation-proven); run on unfixed code; save the failing transcript under the run evidence dir
- [x] 1.2 Item 3 (D6): mutation-prove `OutputConfigKeyValidationSpec`'s single-call create test goes red without the key validation; restore; save transcript

## 2. Implementation

- [x] 2.1 Add `LegacyOutputFormat` (D1) with the V117-then-V118 composition helper
- [x] 2.2 Call the composition at `restoreBoundOutputs` and `OutputService.update` (RestorePriorStored only) (D2); update comments; re-grep for any other captured-config write site and record in files-modified.md
- [x] 2.3 Verify 1.1 turns green

## 3. Tests

- [x] 3.1 Unit tests for `LegacyOutputFormat` (each format branch, trim set, unit written/shadowed/no-text, collection, out-of-scope configs unchanged)
- [x] 3.2 V118 parity spec (D3) with non-vacuity and recorded mutations (a1), (a2), (b), (c)
- [x] 3.3 V117 parity spec hardening (D4): corpus additions, closed JDBC resources, mutations (a)-(b) shown surviving before and red after
- [x] 3.4 Run the touched suites (patchsets, pipelines, both parity specs, V117/V118 migration specs) with `[hel1468-guard]` visible; save transcripts
