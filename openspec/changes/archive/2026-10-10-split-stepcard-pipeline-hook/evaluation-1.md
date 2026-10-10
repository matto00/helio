## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `590c0b671f81b681ea5112cc6016cd74638b098c` against live-resolved base `1b765f59d0d09d2d60d5c05f31a2e06083e3a105` (origin/main). Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1465/evidence/eval-*` (`eval-gates/`, `eval-shots/`, `eval-D2b-probe.txt`, `eval-F146-red-on-branch.txt`, `eval-D4-red-on-base.txt`).

### Phase 1: Spec Review — FAIL

Most of the work matches the plan:
- AC1: met. `StepCard.tsx` is 248 lines. The new modules are `StepCardHeader.tsx` (186 lines), `StepCardWarnings.tsx` (36), `StepCardPreviewTray.tsx` (45) and `stepCardTypes.ts` (118).
- AC3: met. I re-ran the proofs myself (see Phase 2).
- AC4: met. It is in its own commit (9a77a3998). The test fails on base and passes on the branch, and I re-ran it myself. On the running app there are no duplicate ids. Clicking each "Reference match field" label focuses that card's own input (values "id" and "regcode").
- AC5: met. It is in its own commit (59d7e420d). The spec tests check exact strings, and the join wording is guarded. The only lookup paths into `missingMessage` are `sourceKey` (through `referencedFields`, L292) and `lookupKey` (`secondary = true`, L203), so the new "match field" / "reference match field" wording cannot mislabel a requested column. The `code` values are unchanged.
- Commit order is correct. The characterization commit comes first, then the two split commits, then D4, then D5.
- C1–C4: honored, with one item noted under the D2b ruling below.

**Ruling on D2b (C1 narrowed): behaviour-preserving and acceptable. Not a FAIL.** I checked the claim myself with stdin eslint, without editing any file (`eval-D2b-probe.txt`):
- If I remove only the existing `// eslint-disable-next-line react-hooks/exhaustive-deps` from the host (L423), lint reports 1 `exhaustive-deps` warning and **7 `react-hooks/refs` errors**. The committed host reports 0.
- If I delete the debounced effect (L356–432), which is what moving it out as designed would do, the same `react-hooks/refs` errors appear.

So moving the effect would have needed either a new suppression (forbidden by C4) or a fix to the render-time ref writes (a behaviour change, forbidden by C1). Keeping the effect in the host is the only option that satisfies both constraints. The effect stays byte-identical in the host (the d3 host-remnant check returns IDENTICAL). `usePipelineAnalyzeDeferWatchdog` is called immediately before it, and the inlined primitive hook sequence is unchanged (94 = 94, same order). Narrowing the scope does not change behaviour.

Issues:
1. **AC2: the filed follow-up does not describe the actual remainder.** HEL-1478's description says HEL-1465 extracts an "analyze scheduler" cluster, and it lists the remainder without the debounced re-analyze effect. It also omits the masked-lint debt: 7 render-time ref writes whose `react-hooks/refs` errors are hidden by the host's existing suppression. design.md D2b says "HEL-1478 (remainder) should take the render-time ref writes as its first item", but that never reached the ticket. The next lane would hit the same wall without warning.
2. **Task and planning text does not match what was built.** `tasks.md:22` is checked off as "Extract C1 `usePipelineAnalyzeScheduler`", but the shipped hook is `usePipelineAnalyzeDeferWatchdog` and only covers the narrowed cluster. `proposal.md:8` still lists "analyze scheduling" as an extracted cluster. design.md's D2 bullet for C1 still names `usePipelineAnalyzeScheduler`, although D2b overrides it.

### Phase 2: Code Review — PASS

I ran every gate fresh in WORKTREE_PATH (`eval-gates/`):

| Gate | Result |
|---|---|
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0. Frontend 503/503 suites, 5266 tests. Second project 44/44, 433 tests |
| `npm --prefix frontend run build` | exit 0 |
| `sbt testFull` | exit 0. 6659 succeeded, 0 failed. The HEL-1465 spec block ran; it was not served from cache |

I re-ran the executor's proof scripts against HEAD, each with its red run:

| Check | Green run | Red run |
|---|---|---|
| `d3_stepcard.py` | 5/5 regions IDENTICAL, 0 defects | one-character edit: Header DIFFERENT |
| `d3b_stepcard.py` | `useState, useStepCardPreview, useStepCardState, useId` on both sides; the new children call no hooks | swapped lines: DIFFERENT |
| `d3_hook.py` | 6 moved regions plus the host remnant all IDENTICAL, 0 defects | DIFFERENT on step structure |
| `d3b_hook.py` | 94 = 94, sequence EQUAL | first divergence at index 1 |
| `d4_hook.py` | PASS: 49 deps arrays, 22 additions | adding `steps`: FAIL #77 |

- `d3_hook.py`: the non-moved text it prints is only imports, args types, JSDoc, signatures, return objects and the five sub-hook call sites.
- `d4_hook.py`: the 22 additions are all refs or setters, and each is traced to its `useRef`/`useState` declaration on base. Unchanged deps arrays match base exactly.
- One limit on these scripts: they compare with all whitespace stripped. A whitespace-only change inside a string literal would get past them. I found no such case in the diff.

Other checks:
- **Test files are import-only in the split commits.** deaedd86f and e887e8b53 touch no `*.test.*` file at all.
- **The F-146 test is a real guard.**
  - On base: green (base sources plus the test file, extracted read-only into a scratch copy).
  - On the branch: red under two mutations of my own in the *new sub-hook files*, which the executor did not test. One adds `steps` to `getAnalyzeWarnings` deps in `usePipelineAnalyzeLookups.ts:179`. The other adds `stepsRef.current` to `handleToggleStepEnabled` deps in `usePipelineRootAndToggleActions.ts:123`. Each fails the steps-edit test, naming the mutated handler.
  - After reverting: green (`eval-F146-red-on-branch.txt`).
- **CONTRIBUTING:**
  - No inline FQNs.
  - Comments explain why, and every ticket reference also states its point inline.
  - No `any`.
  - No new `eslint-disable` (the only suppression in the host is the one that was already there).
  - No dead imports (lint is clean).
- **DESIGN mechanical rules:** no CSS or token changes. The JSX was moved byte-for-byte.

### Phase 3: UI Review — PASS

I used the running app, served from this worktree. I confirmed the listening processes: frontend PID 1212153 and backend PID 1613265 both have their cwd in WORKTREE_PATH, and the backend started at 13:10:48, after the D5 commit. I used the existing throwaway user and pipeline `e06d935d-…` and created no new dev-DB ids.

- **Light and dark, all five cards expanded (join, lookup ×2, compute, aggregate), three warning regions, compute preview open.** I diffed the editor DOM against the executor's `shots/base-dark.dom.html` (`eval-shots/eval-dom-diff-dark.txt`). Apart from `style=""` attributes, which come from the capture harness (they were present in both of the executor's captures), the only differences are the intended ones: the 2 lookup warning texts and the 2 lookup label/input ids.
- **A pitfall for the skeptic.** Preview-open state persists in `localStorage["helio-step-preview-open"]`. Re-using a browser profile without clearing it produces spurious preview-tray differences. I hit this on my first capture, cleared the key, and re-captured.
- **Screenshots** `eval-shots/eval-after-light.png` and `eval-shots/eval-after-dark.png` match the base captures except for the new wording. Warning chips (including the "2" count), the regions and the action cluster render as before.
- **Accessibility.** Each warning region's `aria-labelledby` resolves to its own heading, using a distinct `useId`. Card toggles are `<button>`s with accessible names.
- **Breakpoints.** No horizontal overflow at 1280, 768 or 375, and no header overflow (`eval-shots/eval-after-dark-768.png`).
- **Console.** The only console errors are `401 /api/auth/me` before login and `404 /api/pipelines/:id/schedule`, which is the existing "no schedule" probe.

### Overall: FAIL

The code, the proofs, the gates and the running app all pass. The FAIL is limited to AC2's follow-up ticket and to stale plan text that the D2b deviation left behind. No code change is needed.

### Change Requests
1. **Update HEL-1478** so that it describes the actual remainder:
   - Replace "analyze scheduler" with "defer watchdog (`usePipelineAnalyzeDeferWatchdog`: `clearDeferWatchdog`, `forceDeferredAnalyze`, unmount cleanup)".
   - Add to the remainder list the debounced re-analyze `useEffect`, which stays in `usePipelineDetailPage.ts` (currently L356–432).
   - Add as its first item: the host's existing `eslint-disable-next-line react-hooks/exhaustive-deps` (currently L423) masks 7 `react-hooks/refs` errors on the render-time ref writes (`analyzeStatusRef.current = …`, `stepsRef.current = steps`, `sseActiveRef.current = …`, `stepsFingerprintRef.current = …`, and others). Moving that effect out of the host un-masks them, so they must be fixed, behaviour-preserving, before or alongside the move. Cite design.md D2b.
   - Then make sure the PR body states the remainder the same way.
2. **Make the plan text match what shipped.**
   - `openspec/changes/split-stepcard-pipeline-hook/tasks.md:22`: reword 3.1 to "Extract C1 (narrowed per design D2b) `usePipelineAnalyzeDeferWatchdog` in place; the debounced re-analyze effect stays in the host with its existing suppression".
   - `proposal.md:8`: replace "analyze scheduling" with "analyze defer watchdog".
   - design.md, D2's C1 bullet: add "(superseded by D2b)" or rename it to `usePipelineAnalyzeDeferWatchdog`.

### Non-blocking Suggestions
- `usePipelineStepStructure.ts` is 271 lines. design.md says "every new sub-hook file <= ~250 (a cluster over that is split into two)". It is within the soft budget's "~", but state it in the PR body, as was done for C4, or leave it to HEL-1478.
- `AnalyzeSchemaWarnings.missingMessage` now treats every non-secondary `lookup` field as the "match field". That is correct today because `referencedFields("lookup")` is `Vector(sourceKey)` only. A short comment at `referencedFields` L292 saying the wording depends on this would guard against a future addition.
