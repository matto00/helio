## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `1c2d12ab5f5ba1e4910cb4c7cb41894882a122f3` against the live-resolved base `1b765f59d0d09d2d60d5c05f31a2e06083e3a105` (from `resolve-review-base.sh`, exit 0). The cwd guard returned READY.

My own evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1465/evidence/skeptic-final-1/`, referred to below as `SF/`. That directory is outside the worktree, so it survives `cleanup.sh --phase4`. `persist-evidence.sh` copies a path that is already there into a nested duplicate under the runs dir, so I cite the originals.

### What I verified (with evidence)

**Commit separation (C1)**
- Commit order is: the F-146 test (`d9ec01e52`, test file only), then the StepCard split (`deaedd86f`), then the hook split (`e887e8b53`), then the lookup id (`9a77a3998`), then the wording (`59d7e420d`), then docs.
- Neither split commit touches any `*.test.*` file. `git show --stat` lists only source modules, plus openspec planning docs in `e887e8b53`.
- The lookup-id change is in its own commit. So is the wording change. `git diff 590c0b671 HEAD -- frontend backend` is empty.

**Byte-move: independent check**
- I wrote my own check, `SF/multiset.py`. It compares the multiset of added and removed lines within each split commit, ignoring whitespace.
- StepCard split (`SF/stepcard-multiset.txt`): the unmatched added lines are only imports, the new component signatures and props interfaces, the three new JSX call sites, and file header comments. The unmatched removed lines are the old combined import, `interface StepCardProps {`, and two JSX tags that Prettier reflowed after dedenting. The reflowed tags keep the same attributes. No logic line is unmatched.
- Hook split (`SF/hook-multiset.txt`): the unmatched removed lines are only imports and 12 dependency arrays.
- Each of those 12 arrays reappears on the branch as the base array plus refs and setters only. Every one traces to a `useRef`, a `useState` setter or `useAppDispatch` on base:
  - `setSteps` at L145 and `setStepsInitialized` at L176.
  - The refs at L154, L162, L169, L202, L203, L220, L221 and L224.
- Red run (`SF/multiset-red-run.txt`): I changed `!==` to `===` in a moved `handleRemoveStep` line. The check flagged the mismatched pair.
- I also re-ran the executor's scripts. `d3_stepcard` and `d3_hook` each report DEFECTS 0, and DEFECTS 1 on their red run. `d4_hook` reports DEPS CHECK PASS (49 arrays, 22 stable additions), and FAIL on its red run.

**Hook sequence: independent check**
- `SF/hookseq.py` strips comments and lists the ordered hook calls, inlining the sub-hooks at their call sites.
- The host sequence matches base exactly (`SF/seq-base.txt` vs `SF/seq-head.txt`, 94 primitives).
- StepCard is `useState`, `useStepCardPreview`, `useStepCardState`, `useId` on both base and branch.
- The new child components call no hooks (grep finds none).
- Red runs (`SF/hookseq-red-run.txt`) both produced a diff:
  - changing the first `useCallback` in the mutations sub-hook to `useMemo`;
  - changing `useId` in StepCard to `useMemo`.

**F-146 characterization test**
- The test pins identity for 18 handlers and getters, across an `outputName` change and a step-config edit. It is a real guard.
- It is unchanged since `d9ec01e52`.
- It was green on base (`F146/green-base.txt`). The evaluator recorded it going red under two mutations on the branch (`eval-F146-red-on-branch.txt`). I did not re-mutate it myself, because this role does not modify code. The other proofs above are my own red runs.

**Gates (fresh, my runs)**

| Gate | Result | Transcript |
| --- | --- | --- |
| `npm run lint` | exit 0 | `SF/gates/lint.txt` |
| `npm run typecheck` | exit 0 | `SF/gates/typecheck.txt` |
| `npm run format:check` | exit 0 | `SF/gates/format.txt` |
| jest, `features/pipelines` | 101 suites / 1373 tests passed, exit 0 | `SF/gates/jest-pipelines.txt` |
| `sbt testOnly *AnalyzeSchemaWarningsSpec` (both specs) | 82 passed, 0 failed | `SF/gates/sbt-spec2.txt` |

The HEL-1465 wording tests are in the sbt run. I relied on the evaluator's `sbt testFull` (6659 passed) because the code tree is unchanged since that run.

**Acceptance criteria**
- **AC1:** `StepCard.tsx` is 248 lines. The new modules are `StepCardHeader` 186, `StepCardWarnings` 36, `StepCardPreviewTray` 45 and `stepCardTypes` 118 lines. Met.
- **AC2:** The host went from 1443 to 816 lines, with five sub-hooks extracted in place: 73, 190, 271, 207 and 166 lines. The narrowing in D2b is justified by `eval-D2b-probe.txt`. I re-read the probe and the line numbers: the suppression is at L423, and there are 7 `react-hooks/refs` errors. The remainder is filed as HEL-1478. Met, with the PR-body statement still owed at delivery.
- **AC3:** Met, per the byte-move, hook-sequence, deps, test-import and running-app checks in this report.
- **AC4:** `LookupConfig` uses `useId` for both `htmlFor` and the input `id`. The test asserts distinct ids, a single occurrence of each, and that each card's own label resolves to its own input. Red on the split head: `D4id/red-on-split-head.txt`, 2 failed. Live check: the ids are `_r_e_` and `_r_h_`, each label's `htmlFor` matches its input, and the page has zero duplicate ids. Met.
- **AC5:** In `AnalyzeSchemaWarnings.scala`:
  - The type-mismatch message now says "match field" / "reference match field".
  - `missingMessage` handles lookup on both sides.
  - The input-side lookup reference is `sourceKey` only (`referencedFields` L292), so "match field" there is correct.
  - The join wording is guarded by a spec test. Red: `D5/red.txt`, 3 failed.
  - The remaining "lookup key" hits are comments or MCP tool prose, not messages.
  - Live backend output confirmed the new text. Met.

**Running app (my own capture)**
- The servers on 6897/9804 run from this worktree: I checked `/proc/<pid>/cwd`. The backend started after the wording commit, and the live warnings show the new wording.
- Scenario: I cleared `helio-step-preview-open`, expanded all 5 cards (join, lookup ×2, compute, aggregate), opened the preview on the compute card, and captured light and dark.
- Normalized editor DOM against the base captures:
  - light (`SF/dom-diff-light.txt`): only the 2 lookup warning strings and the 2 lookup label/input id pairs differ;
  - dark (`SF/dom-diff-dark-stylenorm.txt`): the same set.
- The raw dark diff also shows `style=""` attributes that are present or absent depending on the capture path. My reload-based dark capture has 0 of them; base-light, base-dark and the executor's branch after-dark each have 22. So they are not caused by the code.
- No CSS changed in the diff. Visual check (`SF/after-light.png`, `SF/after-dark-lookup.png`): the warning region and lookup card match the base styling in both themes, and the new copy reads naturally next to the "MATCH ON FIELD" / "REFERENCE MATCH FIELD" labels.
- The only console error is the expected 404 on `/schedule` for a pipeline with no schedule. That happens on base too.

**HEL-1478**
- It names the 5 shipped sub-hooks accurately.
- It has the hidden `react-hooks/refs` errors as item 1, which I verified (suppression at L423, effect at L356–432).
- It also covers the debounced-effect extraction, the rest of the host, `useStepCardState.ts`, and `usePipelineStepStructure.ts` at 271 lines.
- Minor imprecision: it lists four example ref writes. I count 5 top-level `xRef.current =` writes in the host (L109, 129, 164, 339, 500). The 7 lint errors include other sites. Not blocking.

### Verdict: CONFIRM

### Non-blocking notes
- `usePipelineStepStructure.ts` is 271 lines, slightly over the ~250 budget. It is disclosed and tracked in HEL-1478 item 5.
- The PR body must state the remainder the same way HEL-1478 does (AC2).
- The comment in the deferred-watchdog sub-hook still says "the debounce effect below". The effect is now in the host, right after the call, so the comment is still accurate at the call site but reads oddly inside the sub-hook file.
- Dev-DB cleanup is done by exact id, and the deletions are recorded in `evidence/dev-db-ids.txt`:
  - pipeline and 3 sources via the API (204 each);
  - steps removed by cascade (SQL count 0);
  - throwaway user via exact-id SQL (DELETE 1).
- No gate defect regarding mtime evidence: no report I relied on rests on mtime ordering.
