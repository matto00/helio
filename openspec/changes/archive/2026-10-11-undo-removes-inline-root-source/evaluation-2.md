## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `f67177ffdb56f56b992d2dc7ac015f84ed392169`. That is the merge of origin/main into the branch, on top of executor commit `57e955a79`.
Diff base (resolved live): `64e374bb7519262655370bc8c0e210dba930f251`, which is origin/main.
The cycle-2 delta I reviewed is `f0927874a..57e955a79`. The merge `57e955a79..f67177ffd` touches no file in this change's list: `git diff --name-only 64e374bb7...HEAD` lists only this ticket's files.
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1493/evidence/` (shortened to `EV/` below).

### Phase 1: Spec Review — FAIL

Issues:

1. **The planning artifacts no longer describe what was built.** Cycle 2 changed the kept reason and the frontend invalidation, but `design.md` still describes the cycle-1 behaviour. In two places it now states the opposite of the new standing constraint C6:
   - `design.md:62` (D4 table): `KeptReferenced` → "the 409 conflict reason, which lists only the caller's visible referencers". The code now sends `InlineSourceCleanup.inUseReason(conflict)`, and the 409 reason is deliberately not reused (`InlineSourceCleanup.scala` scaladoc).
   - `design.md:88` (Risks): "The 409 reason text reaches the toast. It is already user-facing on the source delete API." C6 forbids exactly this, and it is no longer true.
   - `design.md:74-76` (D5) says only `fetchSources()` on `removed`/`alreadyGone`. The code also dispatches `fetchSourceReferences()` whenever an outcome lists any inline source (`patchSetsSlice.ts`, `sourceReferencesChanged`).
   - `design.md:79` (D5) says each kept line uses "that entry's own `reason`, never hardcoded 'still in use' wording". The backend now generates `still used by …` / `still in use.` text. The intent (no hardcoded wording in the frontend, and a failure never shown as "in use") still holds, but the sentence as written is now ambiguous.

2. **C1: the new frontend behaviour has no recorded red.**
   - The `fetchSourceReferences` dispatch is new behaviour. Its test changed (`patchSetsSlice.test.ts`: `kept` now expects 1 dispatch, `removed`/`alreadyGone` expect 2).
   - On the cycle-1 code, these tests would fail by assertion: 0 vs 1, and 1 vs 2. But `red-evidence.md`'s "Cycle 2" section records only the backend `inUseReason` red.
   - The new `undoToast.test.ts` case ("renders the backend's in-use reason as one id-free line…") passes on the cycle-1 frontend, because `undoToast.ts` just passes the reason through. So it is a guard, but it is not labelled as one.
   - The new wire extra-property case is also a guard. Its name says "(failable)", which is acceptable.

Everything else passes:
- The CR1 and CR2 fixes are present.
- The C1 to C5 findings from cycle 1 still hold.
- C6 is honoured in the code (see Phase 2).
- No scope creep. The merge brought in HEL-1308, HEL-1314 and HEL-1483 cleanly.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (my own fresh runs at f67177ffd in WORKTREE_PATH):**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | exit 0 |
| `npm test` | 542 suites, 5887 tests passed, exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm --prefix helio-mcp run build` | exit 0 |
| `npm run check:scala-quality` | clean (no inline FQNs) |
| `sbt testFull` | exit 0, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 7135, failed 0, canceled 4` |

- The testFull run used `nice -n 19 sbt -J-Xmx3g`, and was started only once fewer than two testFull runs were active machine-wide. Log: `EV/eval2-sbt-testFull.log`.
- These new or changed tests are listed as passing:
  - the four `inUseReason (C6)` cases;
  - the exact-wording `keep a source another pipeline references…` and `keep a referenced source…`;
  - `fail the schema for an unknown extra property on an inline source (failable)`.

**C6 is honoured.** `InlineSourceCleanup.inUseReason`:
- names only `conflict.pipelines` and `conflict.panels`. These are built from `SourceReferences`, which by construction holds only referencers visible to the caller (HEL-1252).
- reports hidden referencers as a summed count only ("N you cannot access").
- caps the named referencers at 3 and sums the rest into "N more".
- includes no ids and none of the 409 remediation text.

The race-path P0001 conflict (one hidden pipeline) yields `still used by 1 you cannot access.`, which is also id-free. Tests pin all of this:
- the unit spec feeds a conflict whose agent `reason` contains a UUID and the "Remove each reference first" advice, and asserts that neither reaches the output;
- the end-to-end undo spec asserts the exact string, no "Remove each reference", and no UUID-shaped token;
- `undoToast.test.ts` asserts the same on the toast message.

`Failed` and no-helper still map to the fixed constants, so a failure is never reported as "in use".

**Backend red for CR1 is real and labelled.** I did not re-run it. `red-evidence.md` shows the end-to-end undo spec failing on the cycle-1 code with the old agent text against the new expected string, `[hel1468-guard] … failed=1`. That is consistent with the code: cycle 1 passed `conflict.reason` through unchanged.

**CR2 fixes verified:**
- The unused import is gone (`PatchSetInlineSourceFixture.scala:6`).
- The wire test is renamed, and a real extra-property case was added. It validates the good body first, then injects `"surprise":true` and expects schema errors, so it can actually fail.
- The red-evidence line mapping was added.

**Frontend.** `fetchSourceReferences` is an existing thunk in `sourcesSlice` that is reused here, not duplicated. It is dispatched once per undo, not once per outcome. This fixes the stale "Used by" column I observed in cycle 1.

**Minor (non-blocking):** the test name `PatchSetUndoInlineSourceCleanupSpec.scala:98` still says "with the source delete's own conflict reason", but it now asserts the `inUseReason` wording. See the suggestions.

### Phase 3: UI Review — PASS
Issues: none blocking.

**C4 and C6, from the executor's screenshots.** I accepted these after inspection and did not re-capture them:
- `EV/exec2-undo-kept-toast-dark.png` (dark, 1440 wide)
- `EV/exec2-undo-kept-toast-light.png` (light, 1440 wide)
- `EV/exec2-undo-kept-toast-light-390.png` (light, 390 wide)

What they show:
- One warning toast: "Undone." followed by one line per kept source, e.g. `Kept data source "HEL1493 Sales inline": still used by pipeline "Holder of HEL1493 Sales inline".`
- Each entry starts on its own line. There are no UUIDs and no remediation text.
- At 390 px the toast is now 6 wrapped lines (it was about 13 in cycle 1) and clears the bottom nav.
- The light and dark theme surfaces differ correctly.

Why I accepted rather than re-captured:
- The rendered text is exactly what the backend spec pins at HEAD (`still used by pipeline "<name>".`).
- The toast render path (`undoToast.ts`, `toast.css`) is unchanged since my own cycle-1 live verification of line separation in both themes.
- The merge touches neither file.
- Nothing rests on file mtimes.

**Throwaway-user cleanup verified (read-only SELECTs through `e2e/support/db.cjs`):**
- `users WHERE email LIKE 'hel1493-%' OR email LIKE '%hel1493%'` returns no rows. That covers the `hel1493-exec2-%@example.test` prefix, the unrecorded user, and my own cycle-1 user.
- For each of the four ids in `EV/exec2-throwaway-users.json` (including the one recovered later): `users`, `data_sources`, `pipelines`, `patch_set_applications` and `connectors` owned by that id are all `0`.
- No `data_sources`, `pipelines` or `connectors` rows are left with a `HEL1493` name.
- No `data_sources` row has an owner missing from `users`.

### Overall: FAIL

### Change Requests
1. **Bring `openspec/changes/undo-removes-inline-root-source/design.md` in line with the cycle-2 behaviour** (documentation only, no code change):
   - Line 62 (D4 table, `KeptReferenced` row): replace "the 409 conflict reason, …" with UI-safe text from `InlineSourceCleanup.inUseReason`. Describe it: visible pipelines and form panels by name (at most 3, then "N more"), hidden referencers as a count only, no ids, no delete-flow remediation (C6).
   - Line 88 (Risks): delete "The 409 reason text reaches the toast. It is already user-facing on the source delete API." Or replace it with the C6 rationale: the 409 `reason` is agent-oriented and deliberately not shown, per the `SourceDeleteConflictNotice` pattern.
   - Lines 74-76 (D5): add that `fetchSourceReferences()` is also dispatched whenever an undo outcome lists any inline source, whether removed, alreadyGone or kept, because the deleted pipeline's references are gone.
   - Line 79 (D5): reword "never hardcoded 'still in use' wording" to state the real rule. The frontend renders the backend `reason` verbatim. The backend produces in-use wording only for `KeptReferenced`. `Failed` and no-helper keep their fixed sentences, so a failure is never shown as "in use".
2. **Complete the C1 record in `red-evidence.md` "Cycle 2"** for the frontend changes:
   - Record a red run of the changed `patchSetsSlice.test.ts` cases against the cycle-1 `patchSetsSlice.ts` (i.e. without the `fetchSourceReferences` dispatch). Show the expected failures (`kept`: expected 1, received 0; `removed`/`alreadyGone`: expected 2, received 1).
   - Label the new `undoToast.test.ts` case ("renders the backend's in-use reason…") and the new wire extra-property case as guards that are green on the cycle-1 code by design.

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoInlineSourceCleanupSpec.scala:98`: rename "keep a referenced source, with the source delete's own conflict reason" to something like "…with the UI-safe in-use reason". It no longer asserts the delete's own reason.
- For the skeptic (copy judgment): "N you cannot access" reads slightly awkwardly as a list item (`still used by pipeline "X", 2 you cannot access.`). Consider "2 others you cannot access".
