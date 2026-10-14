## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 3bd40f36f827ec46bcb9add03fadc4dc2e077c7a
Diff base: 2d815623f6bdbeeefd3379456caca33be94163d0 (resolved live with resolve-review-base.sh)

### Phase 1: Spec Review — PASS
Issues: none

- AC1: `draftAppearance` was removed from `CommandBarProps` (CommandBar.tsx:29) and from both call sites (App.tsx:219, CommandBar.test.tsx:53). `syncStepsFromServer` was removed from `UsePipelineStepCreationArgs` and from its one call site (usePipelineStepStructure.ts:89). `usePipelineStepStructure` still defines and uses its own `syncStepsFromServer` (lines 57/124/147/159) for its other consumers. Neither value was read: `CommandBar` destructures its props explicitly and has no rest spread, so no prop reaches the DOM, and typecheck would fail if anything still read either field. design.md D1/D2 justify removing rather than wiring, using commit history (HEL-724, HEL-1345, HEL-1448).
- AC2: `e2e/support/echartsFiber.ts` holds the shared pair, and the three specs import it with `import type`. Running `grep -rn "type ReactFiber" e2e/` finds only the support module. The remaining `type EchartsInstance` copies (hel1305/1306/1311/1508) are each shaped differently (checked by eye) and are left alone, as the AC requires. hel1392 imports only `ReactFiber`, which is all it uses.
- AC3: the cast is gone (usePipelineRunEvents.test.ts:277), and the suite passes in the full jest run.
- AC4: the guard pairs test paths with baselines for frontend `.test.ts`, `.test.tsx` and `src/test/**`, helio-mcp `.test.ts`, and the e2e `.spec.ts`. It checks every `@typescript-eslint/*` rule, not just the 4 required ones. The allowance is an exact (path, rule) map for `no-require-imports` on the four jest paths only. The selftest has the three required red cases.
- Spec delta (`eslint-typescript-rules-guard`) matches the implementation. `openspec validate --strict` passes, and so does `check:openspec`.
- Tasks are all checked and match the diff. There is no scope creep, and the hel1444/hel1512 specs are untouched. CONSTRAINTS is empty.

### Phase 2: Code Review — PASS
Issues: none

I ran every gate myself in WORKTREE_PATH at 3bd40f36f:
- `npm run lint`: exit 0
- `npm run format:check`: all files clean
- `npm run typecheck`: exit 0
- `npm run check:e2e-types`: exit 0
- `npx eslint --max-warnings=0` on the 4 e2e files and both guard scripts: exit 0
- `npm test` (root jest, then frontend jest, `--maxWorkers=3`, nice 19): exit 0. Root: 51 suites / 469 tests. Frontend: 596 suites / 7131 tests.
- `npm --prefix frontend run build`: exit 0
- `npm run check:eslint-ts-rules`: OK. `npm run check:eslint-ts-rules:selftest`: OK.

I checked the executor's red-first claim myself. I put the PRE-change guard (`git show 2d815623f:scripts/check-eslint-ts-rules.mjs`) next to the NEW selftest in a scratch tree. All 6 new assertions failed with "exit 0" (3 cases x rejected/names-path-and-rule), while the two old assertions still passed. Swapping in the new guard turned the selftest OK.

Extra mutations I ran against the new guard, beyond what the selftest covers:
- e2e-spec override turning `no-require-imports` off: RED. The e2e pair is live, and the allowance does not reach Playwright specs.
- `frontend/src/test/**` override setting `no-unused-vars` to `warn`: RED. Severity is checked, not just presence.
- `**/*.test.tsx`-only override turning `ban-ts-comment` off: RED.
- helio-mcp test override turning `no-require-imports` off: green (allowance applies as designed).
- Emptying `TEST_ONLY_ALLOWANCES`: RED on exactly the 4 jest paths for `no-require-imports`. The allowance is exact and necessary.

On code quality, the new guard code is small and readable. File sizes are 107 and 105 lines, well under the 250 budget. There are no inline FQNs, no `any`, and no dead code. The type-only e2e import is erased, so nothing is serialized into `page.evaluate` closures, and the types were already used inside those closures before the move.

### Phase 3: UI Review — N/A (reasoned skip)
Issues: none

`frontend/**` triggers this phase, but the frontend changes are type-level or test-only:
- removing a prop that `CommandBar` never destructured or spread;
- removing a hook arg that is never read;
- removing a redundant cast in a test.

None of these can change rendered output, and typecheck plus the production build pass. With no user-visible surface to exercise, I did not start dev servers.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- No selftest case covers an e2e-spec-only override. The AC only asks for three cases, and my manual mutation shows the e2e pair is live. A fourth case would lock that in.
- The worktree has no `node_modules` of its own: gates resolve the main checkout's through parent-directory lookup. This is environmental, not a defect in this change.
