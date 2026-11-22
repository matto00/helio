## Standing Constraints

- [C1] An anchored cell is charged min(anchored charge, per-position charge): no pattern is ever charged more than before HEL-1807; budget 4.00e6 unchanged
- [C2] The decline decision itself is main-thread work: an anchored cell's exact scan reads at most about its charge in characters, and workExceedsBudget plus exec is calibrated <= 20 ms (<= 50 ms accepted risk) on the decision-scan rows

## 1. Measurement (before any model code)

### Frontend

- [x] 1.1 Write `calibrate-anchored.mjs` in this change dir (HEL-1697 method, design D3; imports the real `compileJavaRegex`/`cellWork`)
- [x] 1.2 Run the anchored, partly anchored, multiline, per-call-overhead, decision-scan (C2, incl. the two-byte worst-case rows of design D3) and control rows in batches under 10 min each, `nice -n 19`
- [x] 1.3 Write `calibration.md` in this change dir: tables per row (cost under D2, best ms, ns/unit, ms at 4.00e6), verdicts
- [x] 1.4 Decide D1 eligibility from the measurements (narrow if a form does not anchor; escalate if none qualify)

## 2. Red first

### Tests

- [x] 2.1 Add the D4 Jest cases (incl. AC row value and the C2 scan-bound test) to `regexInputCost.test.ts` and `regexWorkModel.test.ts`
- [x] 2.2 Add the e2e anchored case (design D4) to `e2e/hel1683-regex-main-thread.spec.ts` and run it once on the pre-change model; record the failure
- [x] 2.3 Run the full spec files; commit the red output as `red-run.txt` in this change dir before implementation

## 3. Implementation

### Frontend

- [x] 3.1 `javaRegexCost.ts`: `startAnchored` on the flattened tree; `RegexWork.anchored`
- [x] 3.2 `regexInputCost.ts`: anchored `cellWork` (first-run scan, C2 invariant) and `cellWorkBound` (design D2); non-anchored path unchanged
- [x] 3.3 Code comments cite the archived `calibration.md`; keep files near today's size

## 4. Verification

### Tests

- [x] 4.1 Jest green: the four evaluator regex test files and the parity test, full files, 3 workers
- [x] 4.2 Mutations from design D4 (incl. "always run the full scan"), each red, recorded in `mutations.txt` in this change dir
- [x] 4.3 shared-test-fixtures diff against the live review base (`resolve-review-base.sh`) is empty
- [x] 4.4 e2e: run the full `e2e/hel1683-regex-main-thread.spec.ts` (2 workers), lane DB
- [x] 4.5 typecheck, lint, format:check green; record the anchored-pattern threshold for the PR body
