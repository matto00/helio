## Standing Constraints

- [C1] Self-test cleanup of a planted `e2e-evidence/` never deletes recursively: remove only the self-test's own marker/placeholder files, then rmdir only if empty; never create it over an existing dir.

## 1. Scripts

- [x] 1.1 Add `e2e-evidence` to `IGNORED_TOP_LEVEL`; export the set; refresh the header table and its line numbers
- [x] 1.2 Add any gitignored mutated-script/marker paths the self-test introduces to `.gitignore`

## 2. Tests

- [x] 2.1 Red run: with `e2e-evidence/` present, the pre-fix gate (main's copy) exits 1 with COVERAGE DRIFT; save log
- [x] 2.2 Self-test case: real gate exits 0 with `e2e-evidence/` present (create-only-if-absent, marker-owned cleanup)
- [x] 2.3 Self-test case: mutated gate without the entry exits 1 naming `e2e-evidence`
- [x] 2.4 Self-test: `.gitignore` root-dir patterns vs `IGNORED_TOP_LEVEL` consistency, both directions, with probe allowlist
- [x] 2.5 Self-test: non-vacuity check of the parser with a synthetic extra root pattern
- [x] 2.6 Run gate + self-test with and without a real `e2e-evidence/` present; record the AC-3 audit result
- [x] 2.7 Write per-script gate-chain isolation evidence for both changed scripts

## Evidence

- `evidence/red-run-prefix.log` — 2.1 red run (pre-fix gate, e2e-evidence/ present: exit 1, COVERAGE DRIFT names e2e-evidence)
- `evidence/green-runs.log` — 2.6 gate + self-test with a real populated e2e-evidence/ (survives) and with it absent
- `evidence/isolation.log` — 2.7 per-script isolation PASS for both scripts
- AC-3 audit: root-level `.gitignore` dir patterns = the 6 prior names + e2e-evidence + 2 self-test probes; only e2e-evidence was missing, now enforced by the self-test consistency check.
