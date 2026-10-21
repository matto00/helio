## Standing Constraints

- [C1] Red evidence must be an assertion failure that reports the measured value (duration, decline), never a timeout or a missing element.

## 1. Red first

### Tests

- [x] 1.1 Write `e2e/hel1683-regex-main-thread.spec.ts` (design D5a: control edit + probe edit) and run it on the UNMODIFIED tree under the e2e lock; verify it fails on the <= 100 ms assertion (not a timeout) and record the probe's and the control's longest task (ms) in `evidence/red-probe.md`
- [x] 1.2 Add failing Jest cases to `javaRegex.test.ts` for the spec's declined patterns (incl. `a*a?a?a?a?a?a?b`, `a?a?a?a?a?a?a*b`, `a*a{20}b`, `.*.{60}z`, `a?a?a?a?a?a?a{50}b`, `\d?\d?(\d+)$`, `.?.?.*$x`, `.?.?.{100}.*z`) and accepted fenced shapes (`(\d+) items`, IPv4) and fenced acceptances; verify the declined cases fail on the unmodified tree
- [x] 1.3 Measure in the Scala engine (server draft preview or a parity-spec-style probe) a client-declined pattern and input within the draft caps that exceeds HEL-1676's 2 s budget; record pattern, input and time in `evidence/server-overrun.md` (or record that none exists, per D5a)

## 2. Allowlist

### Frontend

- [x] 2.1 Build the alternative/sequence/item structure and per-atom code-point ranges during `translate` in `javaRegex.ts` (design D2, D3); verify existing `javaRegex.test.ts` cases still pass
- [x] 2.2 Implement Rule W (wide + fence) fenced items, and Rule N (P x L <= 64 when P > 1; P x L(tail) <= 4 with an unfenced wide; `$` weighs 2; wide = range > 16) and decline on violation; verify 1.2's cases pass

## 3. Verification

### Tests

- [x] 3.1 Add boundary tests (range 16 vs 17, whole-pattern cost 64 vs 65 when P > 1, no-choice pattern over 64 characters accepted (`sha256:([0-9a-f]{64})`), branch-end item unfenced, tail cost 4 vs 5, `$` weight 2 (e.g. `\d?(\d+)$` accepted vs `\d?\d?(\d+)$` declined), fenced narrow multiplicity 1, `{n}` tail, fenced vs unfenced, disjoint vs overlapping class) and record one mutation per guard turning it red in `evidence/mutations.md`
- [x] 3.2 Add `regex declines:` vectors to `shared-test-fixtures/pipeline-step-parity/stringops.json` (stacked `*`, stacked `?`, stacked alternation, unfenced pair, wide plus narrow, wide plus counted tail) with Scala-produced expectations; verify `pipelineStepParity.test.ts` and `PipelineStepParitySpec` (via `sbt testFull` under the lock) pass and no existing vector changed
- [x] 3.3 Re-run the e2e probe; verify the control rendered client rows, the probe's longest task <= 100 ms and the step shows the server result, and (if 1.3 found one) the overrun edit shows the server time-budget step error
- [x] 3.4 Run frontend lint, typecheck, format check and the full frontend Jest suite (`HELIO_JEST_MAX_WORKERS=2`); verify green
- [x] 3.5 Write `files-modified.md` listing every changed path explicitly (CON-260)
