## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (`skip_specs: true`) against worktree HEAD
`dae4bc4516791452ad5b3e27e871d39771bbd5a6` (= origin/main), plus HEL-1478's branch diff (read-only).
Probe evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/skeptic-design-1/`
(`transcript.md`, `gen_probe.py`, `probe/hooks/*`).

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-step-card-state/HEL-1481`.
- **Premise and line ranges (design Context):** `useStepCardState.ts` is 602 lines, `usePipelineStepStructure.ts` 271.
  Every cited range checks out against the file: imports L11–70, const L72–79, interface L81–145, signature L147–151,
  editor state L152–212 with the resync block L213–242, refs and cleanup effect L244–260, `persist` L262–325, 19
  handlers L327–510, `emitOrPersist` L512–524, 3 handlers L526–544, return L546–601 (54 keys = 26 values + 2
  saveError + 26 handlers). The file has no `useCallback`/`useMemo` (grep count 0) and no `eslint-disable`. The
  primitive sequence is useState x30, then useRef x2, then useEffect x1, as stated. `handleInstantiateShape` with
  its leading comment is L148–256, and its deps are `[id, pushToast, roots, setSteps, setStepsInitialized]`.
- **HEL-1478 interaction:** `git -C <HEL-1478 wt> diff origin/main...HEAD` touches `usePipelineStepStructure.ts`
  with exactly 3 added lines (`setPendingDraftIds`: type field, destructure, forward to `usePipelineStepCreation`),
  all outside L148–256. It does not touch `useStepCardState.ts` or its importers. The C2 gate is right.
- **Importers:** only `StepCard.tsx` (call), `StepOpEditor.tsx` (`ReturnType<typeof useStepCardState>`), the
  existing test and `JoinConfig.seam.test.tsx` use it. `StepCardStateHandlers` has no importer outside the file, so
  the re-export is enough.
- **The seams are lint-clean, type-clean and fit the size targets.** I built design D1 and D2 mechanically from the
  base line ranges into a scratch copy of `frontend/src` under the evidence dir, with verbatim regions and the
  verbatim 54-key return object, then formatted it with the repo prettier config.
  - Sizes: host 211, editor state 207, persist 131, field handlers 161, op handlers 152, types 90.
    `usePipelineShapeInstantiation` comes to 138 and the `usePipelineStepStructure` host to 168 (+3 after HEL-1478).
    Every file stays at or under ~250 even with the verbatim return object.
  - `tsc --noEmit` exits 0.
  - `eslint --max-warnings=0` with the repo config (eslint-plugin-react-hooks 7.0.1) exits 0 over
    `src/features/pipelines`.
  - **Positive control:** injecting a render-time ref read into the probe `useStepCardPersist` fired
    `react-hooks/refs`, so the compiler rules are live. Reverted, lint was clean again.
  - Naming the handler modules `build*` instead of `use*` is also lint-clean, so either choice in D1 is safe.
  - The pipelines jest suite on the probe passed 98 suites. 3 suites failed only with ENOENT on fixtures outside
    `src/`, which is an artifact of my scratch copy. That covers `useStepCardState.test.ts`, the StepCard and
    JoinConfig seam suites, `usePipelineDetailPage.identity.test.tsx` and the PipelineDetailPage shape-flow tests.
  - Conclusion: no hidden React Compiler error comes up on the new modules.
- **Captured bindings:** `persist` reads `step` and the refs only at call or timer time. The setters are `useState`
  setters. The values read by handlers (`selectedFields`, `renames`, `casts`, only in `onFieldToggle`,
  `onRenameChange` and `onCastChange`) arrive as same-render params. The D1 reasoning holds.
- **Characterization test (D4) adequacy:** see Change Requests. I reproduced the D4.4 gap with a scratch test.

### Verdict: REFUTE

The seams are sound, lint-clean, and the size targets are reachable. Two groups of the D4 characterization test
can't detect the regressions they are listed as pinning, so as written D4 is evidence-shaped non-evidence. Both
fixes are small.

### Change Requests

1. **D4.4 (during-render resync) is vacuous for most of the 26 setters. Make it a per-op table.**
   - Every narrowing helper returns a fixed default unless `step.opType.id` matches its own op (for example
     `renamesOf` gives `{}` unless the op is `rename`; `stepNarrowing.ts:495-628`). One fixture op re-rendered with
     a new config, plus one opType change, therefore exercises only about 2–3 of the 26 `set*` calls in L216–241.
   - Reproduced on base layout with a literal reading of D4.4 (filter fixture, then a new filter config, then opType
     changed to limit, asserting all 26 values equal `helper(newStep)`). It stays **GREEN** with
     `setCasts`, `setPivotConfig` and `setUpsertSourceConfig` deleted from the resync block. It went red only for
     `setLimitCount`. See `transcript.md` and `probe/hooks/resyncProbe.test.ts`.
   - Required revision: D4.4 becomes a 26-row table, one row per op kind. Each row mounts with that op and config A,
     then rerenders with a new config B of the same op, where `helperOf(B)` deep-differs from `helperOf(A)`, and
     asserts that op's value equals `helperOf(B)`. Keep the opType-change case as well.
   - The red-run requirement must name at least two dropped setters that are not the fixture op of any other group,
     so a red run can't be cherry-picked.
   - Update tasks.md 1.3 to match.
2. **D4.5 (local state echo) can't catch a stale captured binding in the three value-reading handlers. Add
   sequential calls.**
   - `onFieldToggle`, `onRenameChange` and `onCastChange` are the only handlers whose output depends on a state
     value passed into the new handler module (`selectedFields`, `renames`, `casts`). A single call from the initial
     state gives the same result whether the module reads the current-render value or one stuck at mount.
   - This is exactly the "moved code captures a different binding" risk the design's Risks section assigns to D4.
     The existing `useStepCardState.test.ts` never calls these three handlers.
   - Required revision: for each of the three, call the handler twice with a re-render between (for example toggle
     `a` then toggle `b`, rename `x` then rename `y`, and likewise for casts). Assert the accumulated local value and
     the accumulated debounced PATCH payload (`{fields:["a","b"]}` and so on). Show it red under a mutation that
     feeds the module a stale value, for example the first-render value held in a ref, then revert.

### Non-blocking notes

- **D4 red run for the identity test:** the suggested mutation "`roots.length`" is a primitive that does not change
  when a step config is edited, which is the identity test's trigger, so it would stay green. `stepsRef.current` is
  only written in a layout effect after HEL-1478, so it may not change within the asserted render either. Pick a
  per-render-fresh dep (for example an inline `{}`) so the red is guaranteed. The design already requires showing it
  red; this just avoids a wasted attempt.
- **M2's moved comment** at L209–210 ("the field's own doc on `StepCardStateHandlers` above") becomes stale once the
  interface lives in `stepCardStateTypes.ts`. Add it to the existing stale-comment follow-up list next to "eight
  per-op-kind" and `anchorHasTail`. Do not reword it in this PR.
- **D1 return object:** my probe shows the verbatim L546–601 object fits (host 211). Prefer the verbatim object over
  spreads so the byte-move check covers it directly and key order needs no separate argument.
- **Existing coverage:** debounce-collapse, unmount cleanup, the stale-token guard (success and reject), the
  unsupported-op skip and the temp-id guard are already covered in `useStepCardState.test.ts` (L94–573). D4 doesn't
  need to duplicate them, but D5 should cite them as the guards for M3.
