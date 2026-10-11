## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed the revised design.md, tasks.md and proposal.md against worktree HEAD
`dae4bc4516791452ad5b3e27e871d39771bbd5a6`. That is also origin/main, freshly fetched. I treated round-1's REFUTE
(skeptic-design-1.md) as claims and re-derived each one from the source.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-step-card-state/HEL-1481`.
- **CR1 (resync table) is really fixed, not just re-worded.**
  - design D4.4 (L119–124) now requires a 26-row table, one row per op kind. Each row does mount(A) then
    rerender(B) with the same op, requires `helper(A)` to differ from `helper(B)`, and asserts the value equals
    `helper(B)`. A separate opType-change row is kept.
  - Ground truth: the 26 editor `useState`s (useStepCardState.ts L158–206) and the 26 resync setters (L216–241)
    map one-to-one onto 26 narrowing helpers. Each helper guards on a different `opType.id`:
    select, rename, cast, filter, compute, limit, aggregate, sort, splittext, extractheadings, chunkbytokencount,
    datebucket, pivot, unpivot, dedupe, fillnull, stringops, window, union, lookup, join, upsertsource,
    convertformat, analyzewithai, generatetext, assert.
    - Source: `state/stepNarrowing.ts` L495–628, plus the `opType.id !==` guards at ~L649–794 and L815/833/850/861.
  - So every setter is exercised by exactly one row. Because each row requires A and B to differ after
    narrowing, deleting that row's setter leaves `helper(A)` in place, and the row goes red by construction.
  - The red-run rule (L134–135) asks for at least two separate deletions of setters whose op is not another
    group's fixture (`setCasts`, `setUpsertSourceConfig`). That closes the cherry-pick gap I reproduced in round 1.
  - tasks.md 1.3 is updated to match.
- **CR2 (accumulating handlers) is really fixed.**
  - D4.5 (L125–129) calls `onFieldToggle`, `onRenameChange` and `onCastChange` twice each, with an act-driven
    re-render in between. It asserts both the accumulated local value and the single debounced PATCH.
  - Ground truth (L327–346): these three are the only handlers that read state (`selectedFields`, `renames`,
    `casts`). `next` is built from that state, and `onRenameChange`/`onCastChange` `delete` the key on an empty
    string, so the design's "a delete via empty string removes the key" matches the code.
  - Two calls inside the 400 ms window collapse into one PATCH with the last `next`, so "single debounced PATCH
    contains both edits" is the right assertion.
  - The required red run (L136–137) feeds a stale value, for example a first-render snapshot. The second call then
    yields `[b]` instead of `[a, b]`, which is red. This is the exact binding-capture risk the split creates.
- **The round-1 non-blocking notes were taken up.**
  - The identity-test mutation is now an inline `{}`, with a note that `roots.length` would stay green
    (L142–144, tasks 1.4).
  - The L209–210 comment staleness is listed under Non-Goals as a follow-up.
  - The return object is the verbatim L546–601 object (L80–81).
  - `useStepCardState.test.ts` is cited as the M3 guard (L139–141).
- **The other D4 claims hold against the code.**
  - Group 2's captureErrors set is exactly pivot/window/fillnull/upsertsource. `persist(..., true)` appears at
    L406, L429, L445 and L509, and there are no other sites.
  - Group 3's emitOrPersist callers are exactly convertformat, analyzewithai and generatetext (L512–544).
  - The return object has 54 keys, in the order the design pins.
- **No new placeholders or contradictions that would block the work.**
  - grep found no TODO or TBD in the proposal, design or tasks.
  - The HEL-1478 gate (C2, design Base) is unchanged and still right. Origin/main has not moved since round 1.

### Verdict: CONFIRM

Both change requests are fixed in substance. Each group now has a mechanism that would go red on the regression it
is meant to catch, and a mandated red run that proves it. I found nothing new that makes the design unsound.

### Non-blocking notes

1. **The opType-change row has no stated assertion or red run.**
   - With an unchanged config object, the new op's helper can return its own default. For example, changing
     filter to limit with a filter config gives `limitCountOf` = 100, which is the initial value. An assertion on
     the new op's value alone would then pass even with the `|| prevOpTypeId !== step.opType.id` disjunct
     removed.
   - Assert that the **previous** op's value reverts to its default, for example filterConfig back to
     `{combinator:"AND",conditions:[]}`.
   - Record one red run that drops the opType disjunct, then revert.
   - Not blocking: the condition sits inside a verbatim-moved region that the byte-move check covers.
2. **design.md L22 says "nineteen per-op change handlers" in L327–510.** There are 23 (`onFieldToggle` …
   `onUpsertSourceChange`), plus 3 after `emitOrPersist`, for 26 in total. The count is cosmetic, but the executor
   re-reads the ranges at SPLIT_BASE anyway, so record the right number there.
3. **proposal.md places "save error" in the persist module, but design D1 keeps the saveError `useState` pair in
   M2.** It sits contiguous with the resync block and is passed into M3 as setters. The design is the binding
   text and is internally consistent, so follow D1.
