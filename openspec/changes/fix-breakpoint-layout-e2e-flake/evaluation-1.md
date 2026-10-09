## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: f9f287d97a0df24ec8e441ab25c9116b859ea9e8 (single commit over live-resolved base 7e1df62a67ada4de6dd2499cbb5d84cec69e7dbb).
Changed code: `e2e/hel1023-breakpoint-layout-derivation.spec.ts`, `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx`, `frontend/src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx` (+ openspec artifacts).

### Phase 1: Spec Review — FAIL

- AC1/AC5 (measured natural rate, red→green sized from it): natural local rate 0/182, so design D3 sizing is not computable. The executor substituted an injected-delay repro plus CI history. The owner escalation on whether that substitute is acceptable is already open. **Not decided here.** Whether the substitute evidence is sound:
  - **Sound as a mechanism repro.** I re-ran it myself (independent init script that wraps `ResizeObserver` so each callback is delayed, 2 workers, `nice -n 19`). Pre-fix spec (base 7e1df62a) at 900 ms: **4/4 fail** with `C_lg_coords_everywhere light @1500 (md) P8 Divider right`, Expected `<= 1478`, Received `1876`. That is byte-identical to the CI failure in main run 37850786693. Post-fix spec, whole file (A, B, C, D, V), 900 ms, repeat 2, 3 workers: **10/10 pass**. Post-fix A/C/V at 2500 ms: **6/6 pass**. Unmodified delivered spec under natural conditions, whole file, repeat 2, 3 workers: **10/10 pass**.
  - **Limit:** the injection delays RO delivery directly. The natural CI cause is a late rendering opportunity, which delays RO and the `resize` event together (evidence.md item 2 measured RO lag up to 545 ms naturally). It is the same causal chain entered at the same point, but injected, so it demonstrates the mechanism and the fix's causal coverage. It is not a natural-rate red→green. The executor states this honestly. Whether that meets AC1/AC5 is the open owner question.
- AC2 (root cause): verified against RGL v2.2.4 source (see Phase 2). The CI-trace analysis (container 1212 while item at 1876 = lg right edge) and the converge-to-correct observation support "measurement race, product correct". Candidate refutations are recorded in evidence.md.
- AC3: the fix is test-side plus an observability-only product hook, as scoped in proposal Impact. No layout or behaviour change. Confirmed in Phase 3.
- AC4: the ±2 px tolerance and the two-read stability loop are unchanged. No retries. `settleTransitions(page, 5_000)` is an upper bound on awaiting real `CSSTransition.finished`, not a settle window. C1 is honored.
- AC6: N/A (not a product fix). A unit guard was added anyway, and it is red with the wiring removed (Phase 2).
- C2: my runs used ≤3 workers and `nice -n 19`, with no pkill/pgrep/killall. C3: N/A (product correct). C4: `ci.yml` untouched (diff confirmed).
- **Issue: task 4.3 is marked `[x]` but is not done.** It says "Record any dev-DB residue by exact id". evidence.md "Dev-DB residue" says the throwaway users were "not individually recorded". That excuse does not hold: the spec logs every registration (`[HEL-1023 e2e] throwaway user registered: <email>`, spec beforeEach), so every email was in the executor's run output. The dev DB now holds **305** `hel1023-%@example.test` users created 2026-10-08 15:30:39 to 16:04:07 (-07) that are not mine. That window covers the executor's runs, but it is not exact attribution. Leftover dashboards owned by those users: 0, so afterEach cleanup worked. This breaks the standing rule (record all dev-DB residue by exact id) and the "all task items marked done match what was implemented" check.

### Phase 2: Code Review — FAIL

Gates (my own fresh run in WORKTREE_PATH, `nice -n 19`):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0. `npm run check:e2e-types`: exit 0. `npm --prefix frontend run build`: exit 0.
- `npm test -- --maxWorkers=4`: exit 0. Frontend 476/476 suites, 4972/4972 tests. Root 42/42 suites, 407 tests.
- Backend unchanged, so `sbt testFull` was not required.

RGL v2.2.4 source check (`frontend/node_modules/react-grid-layout/dist/chunk-7ZM5LVH2.mjs`):
- `ResponsiveGridLayout`'s width effect (l.1402-1452) calls `setBreakpoint`/`setCols`/`setLayout`/`setLayouts` and then `onWidthChange(width, …)` in the same passive-effect invocation. So `setProcessedWidth` is batched into the same commit as the new breakpoint/cols. **The CSS var is never committed before the new breakpoint/cols.** Confirmed.
- `onWidthChange` fires only when `width !== prevWidthRef.current`, and `prevWidthRef` is updated in the same effect. The parent re-render (new inline `children`) re-runs the effect, but it exits on `widthChanged=false`. No render loop.
- **But** `GridLayout` renders items from its own `layout` *state* (`processGridItem` → `getLayoutItem(layout, …)`, l.1109). It syncs that state from `propsLayout` in a separate effect (l.707-727). So in the commit where `--panel-grid-processed-width` first reads the new width, items have the new `cols`/`width` but still carry the previous breakpoint's grid-unit layout. Their final layout commits one passive-effect flush later. The test does not depend on this: `settleTransitions` (rAF frame, then a `getAnimations()` CSSTransition wait, then a frame) and the unchanged two-read stability loop follow the poll, and the follow-up commit is a scheduler task that runs before the rAF. My 900 ms and 2500 ms injected runs are green. However, the product comment states the opposite (see CR 2).
- `style` merge: `GridLayout` builds `{ height: containerHeight, ...style }` (l.1221). The new style object only adds a custom property, so it cannot override `height`. RGL does not forward `data-*` to its root (`GridLayout` destructures a fixed prop list), so the inline CSS custom property is a reasonable channel. The DESIGN.md §1 [mechanical] inline-style rule is about styling values. This property carries none, so I treat it as compliant, with a note below.
- Perf: one extra `DesktopPanelGrid` render per RGL-processed width change. `PanelCard`/`PanelCardBody` are `React.memo`, so the cost is the grid shell plus RGL reconciliation. Acceptable.

Vacuity checks:
- `useState(width)` initial value: on mount, RGL's first render also uses `width` (`initialBreakpoint` from `width`, l.1328), so "property equals target at mount" is true of RGL's actual state, not vacuous. In the spec, every live resize goes to a distinct container width (1612 → 1212 → 912 → 768). Each theme pass starts with a fresh `goto` at 1900. The stack → 1900 transition is a fresh mount. So the stale value never equals the next target.
- Stack branch: `toHaveCount(8)` on `.react-grid-item, .mobile-panel-stack__item` can pass on the grid's items, and `.panel-grid` count 0 can then pass. But `PanelGrid` swaps the two in one conditional render (`PanelGrid.tsx` branches on `panelGridConfig.breakpoints.sm`). Any non-stack intermediate would give `rects=[]` or `container=null`, which fails the reading-order and `not.toBeNull` assertions loudly. Not a vacuous pass.
- Without the product wiring, the poll for `"1612px"` reads `""` and times out. The e2e wait cannot pass without RGL reporting.

Unit guard: in a detached scratch worktree at f9f287d9 with `DesktopPanelGrid.tsx` reverted to base, `DesktopPanelGrid.processedWidth.test.tsx` gives **2/2 fail**. Green in WORKTREE_PATH (part of the 4972 above). Test 2 also catches a "mirror the width prop" mutation, because it asserts the property does not advance on a prop change alone.

Issues:
- **`DesktopPanelGrid.tsx:310-316` comment is inaccurate.** It says the processed-width commit is "the earliest point at which every item is laid out for `width`". Per the RGL source above, item positions reach the new breakpoint's layout one passive-effect flush later, when `GridLayout` syncs its internal `layout` state. This comment is the stated contract that the e2e wait relies on. In its current form it invites a future reader to drop the stability loop or `settleTransitions` as redundant. The same overclaim appears in evidence.md "Fix" ("the same batch that commits the new breakpoint/cols" is true; the implied "items laid out" is not).

### Phase 3: UI Review — PASS

Servers: `start-servers.sh` reused healthy servers on 6845/9752. I verified their process cwds are this worktree's `frontend`/`backend`, and that the served `DesktopPanelGrid.tsx` contains `panel-grid-processed-width`. `assert-phase.sh servers` printed PASS.

Scripted Playwright check (fresh throwaway user, 1 worker, `nice -n 19`). Output from the run log (self-authenticating numbers):
- window 1440: prop=1152px box=1152. 1100: 812px/812. 1900: 1612px/1612. 1056: 768px/768. No horizontal page overflow at any of them.
- 400: `.panel-grid` gone, 8 `.mobile-panel-stack__item`.
- Back to 1440 after the stack: prop=1152px box=1152 (remount path).
- Console errors and page errors across the whole flow: `[]`.

Screenshots (1100, 400) showed normal grid and stack rendering. They are not load-bearing for any claim and were left in the scratchpad, not persisted. No new interactive elements, so accessible-name and keyboard checks are N/A. Loading, empty and error states are unchanged by this diff.

### Overall: FAIL

### Change Requests
1. **Record the dev-DB residue by exact id (task 4.3, standing rule).** In `openspec/changes/fix-breakpoint-layout-e2e-flake/evidence.md` § "Dev-DB residue", replace "not individually recorded" with the exact `users.id` (plus email) of every throwaway user the executor's runs created. Recover the emails from the `throwaway user registered:` lines in the run logs, or resolve them read-only (`select id, email from users where email like 'hel1023-%@example.test' and created_at between '2026-10-08 15:30:39-07' and '2026-10-08 16:04:07-07'`, 305 rows at eval time, minus the evaluator's 31 listed below). State that these are all of the executor's rows, or say exactly which are uncertain. Also add the evaluator's 31 rows below.
2. **Correct the timing claim in `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx:310-316`.** Say the processed width commits together with RGL's new breakpoint/cols. Item positions reach the new layout one effect flush later, when `GridLayout` syncs its internal `layout` state from props. That is why the e2e follows the wait with `settleTransitions` and the two-read stability loop. Mirror the same correction in evidence.md "Fix". Comment and evidence only, no code change.

### Non-blocking Suggestions
- `DesktopPanelGrid.tsx` went from 408 to 425 lines, over the CONTRIBUTING.md ~400-line threshold. Propose a split in the PR description.
- The CSS custom property is an observability hook that rides on `style`. It deserves one clause in the comment saying why `style` is used: RGL does not forward `data-*` to its root. That pre-empts a DESIGN.md §1 inline-style objection from the skeptic.
- Evaluator disclosure: one Playwright-MCP navigation wrote `page-2026-10-08T23-22-16-676Z.yml` and `console-2026-10-08T23-22-16-013Z.log` into the main checkout's gitignored `/home/matt/Development/helio/.playwright-mcp/`. I stopped using the MCP browser after that and did all UI checks from a /tmp scratch worktree, which has been removed.

### Evaluator dev-DB residue (exact ids)
31 throwaway users (`hel1023-<ts>-<n>@example.test`), 0 dashboards left (afterEach deleted each by id):
970d98af-6fdd-412d-a038-b356fc26d5d2 e2c0b3a8-7658-402c-99f7-273329ffe1c8 2e8f729c-24ac-4378-a6ae-95db2d967788 b7498d77-0db5-4a5b-9c66-fd9f56ecee6f 96011308-3a98-4433-95ad-f4ea0750aeff a598a413-84f8-4236-92b4-2603362c0a2c f6c813c7-e243-4439-86b5-f5f48aebde0f a02ad6a9-71c6-4055-8672-af8c9a65f676 f52bd884-cb20-4f86-ad85-6b94e1c2ceb5 c288b4ea-c6ef-4524-bdab-30c2f0aa3acd 82efa99a-d89d-4593-8a3a-cfce8dbe2b3f 798e8ed2-033b-42eb-ac6f-ab9f56fbb38d 63679587-2c3d-463f-81c4-7ddfc491b847 08b833c7-e56d-4f01-aa9a-3b11715f136d 764b8b79-716d-4119-a868-3d1a558e4f11 3703306b-2410-436e-acc6-631f674f11d2 2ae7cae6-5126-4584-866f-7959e70b8eeb 52ad4b67-e7ae-48e7-a4b4-e1527b19cf20 a97f4d6e-38f3-40e9-adea-48d00f48884f 3a54ae5e-4c99-4df9-bd66-1a0504267c0a 391be196-e4c5-40e1-b983-0e55fbdec79e d03b7181-9763-4364-ad23-d7aec01fe279 0b0b4abb-af65-4116-8afc-16e086ab5bfc ea1bcae0-323e-41f3-a605-f2807fc3d187 cd240dd0-d08a-4b2b-9295-fa4d5efec487 af1eaebc-beef-4de5-a920-a9d3b80febf0 5f560539-7bec-4ae4-89aa-260fb0d56274 a42f6d3c-36e1-472e-a76f-68ce0b672eb8 3ff08e26-c7bd-4a31-9a46-52b88c6070b1 fa51f43f-cfb5-4233-8b08-ef1af9b26e83 d92b13cc-6dd4-45cf-a1bf-045b20220692
