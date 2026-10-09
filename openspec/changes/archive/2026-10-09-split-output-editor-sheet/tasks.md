## Standing Constraints

- [C1] Opening-state characterization must expose no-control per-kind state on the wire (touched chart fieldMapping) and be shown red by a mutation inside `openingParams` after extraction, not only by a mutation at the old sheet seed site.
- [C2] A pre-fix measurement runs against the whole pre-fix tree at that commit, never a single pre-fix file dropped into the current tree.

## 1. Frontend — characterization and comment (on the unmodified base)

- [x] 1.1 Add `OutputEditorSheet.openingState.test.tsx` per Decision 4 incl. touched chart fieldMapping case; commit alone; verify green on base
- [x] 1.2 Mutate one seed temporarily, record the red run, revert; verify the test is failable
- [x] 1.3 Run the metric-pairing guard against the whole 6f2351e8^ tree (C2), record outcome, reword the comment. CORRECTION: the first measurement dropped only the pre-fix sheet into the current tree (whose builder is already fixed) and wrongly concluded the guard passes pre-fix. On the whole pre-fix tree the guard is RED (expected fieldMapping.value "a" missing; pre-fix builder drops it). Comment reworded accordingly; also failable on current code by removing the D4a pairing. Evidence: cycle2-guard-on-whole-prefix-tree.txt, 1.3c*.txt
- [x] 1.4 Add the red-first PipelineDetailPage swap test (Decision 5); record its red run on the base before keying

## 2. Frontend — split and key

- [x] 2.1 Extract `useOutputKindState` seeded from `openingParams`; verify characterization + configPatch tests green
- [x] 2.1a Mutate `openingParams` seeds (metric format default; chart fieldMapping path); record characterization red + configPatch outcome; revert
- [x] 2.2 Move remaining JSX/effects verbatim into new units; verify sheet ≤ ~400 lines and no new file > ~400
- [x] 2.3 Rewrite the stale header comment; verify no line-count claim remains
- [x] 2.4 Add `key` at `PipelineDetailPage.tsx` mount; verify the swap test turns green

## 3. Tests and evidence

- [x] 3.1 Run all outputEditor + PipelineDetailPage tests, lint, typecheck (capped); verify green, import-only test edits
- [x] 3.2 Produce the `--color-moved` byte-move evidence + justified list of non-moved changed lines
- [x] 3.3 Compare the running editor, light + dark, create + edit for all six kinds, base vs branch, plus one A->B deep-link swap; evidence outside root (evaluator cycle 1: identical markup/computed styles; evidence eval-c1-*)
