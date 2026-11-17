## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 486f3a07ca3bb126baf53e1f50d5d57981d5a832 (base d60b1f799, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

Issues:

1. **The dead `--table` cap rule was NOT deleted, but code comments, tasks, handoff and the PR disclosures all say it was.**
   - `frontend/src/features/panels/ui/grid/MobilePanelStack.css:97-106` still contains the comment block `/* Table: capped at min(60dvh, intrinsic) ... */` and the rule `.mobile-panel-stack__item--table .panel-content--table { max-height: 60dvh; overflow-y: auto; overflow-x: hidden; }`. The diff for this file is comment-only (one hunk at line 107, +7/-2).
   - Live check: in the running app (DEV_PORT 7124), the served stylesheets still contain one rule whose selector includes `mobile-panel-stack__item--table .panel-content--table`.
   - Yet the same file's new comment at `MobilePanelStack.css:110-112` says the rule "was formerly here ... HEL-1692 deleted it". `files-modified.md` says "delete dead `--table` cap rule". `tasks.md` 2.3 is marked `[x]`. `pr-disclosures.md` says "Dead rule deleted in this PR". The revised AC lets the PR either delete the rule or file a follow-up, but it must say which. As shipped, the PR would claim a deletion that did not happen, and a code comment states something false about the code right below it.
2. `tasks.md` 5.2 (the visual check) is marked `[x]`, but the executor's own disclosure says it was "not run in a browser". The evaluator has now run it (see Phase 3), so the task can stay checked. The disclosure line has to be corrected so it does not claim the check was skipped and also leave it marked done without evidence.

Everything else in Phase 1 passes:
- Revised AC (owner ruling `ship-pan-y-as-guard`):
  - `touch-action: pan-y` is on `.ui-data-grid__resize-handle` (`frontend/src/shared/ui/DataGrid.css:333`).
  - Desktop resize is guarded by G3.
  - The guards are labelled GUARD.
  - The capped body is triaged with the live selector `.mobile-panel-stack__item--output .panel-content`.
  - The PR disclosures state the non-reproduction (8/8), that iOS WebKit is untested, and that the fails-first AC was dropped.
- C1 is honoured: the capped-body test names `.ui-data-grid` inside the cap. Immediately before the drag it asserts grid overflow > 100, grid scrollTop 0, cap scrollTop 0, and that the touch point hits a `TD`.
- C2 is honoured: every test is labelled a guard, and the disclosures say the body scrolls before the page.
- C3 is honoured: G2's mutation sits on G2's own path. I verified this independently (Phase 2).
- No scope creep. No API or schema impact.

### Phase 2: Code Review — FAIL (the false comment from Phase 1 issue 1; gates all green)

Gates, all run fresh by the evaluator in WORKTREE_PATH at 486f3a07c:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm --prefix frontend run build`: exit 0
- `npm test` (maxWorkers 3): root 66 suites / 579 tests passed; frontend 765 suites / 9406 tests passed
- e2e `hel1692-table-header-touch-scroll.spec.ts` + `hel1656-pull-to-refresh.spec.ts`, workers 2: 26/26 passed. The harness teardown deleted all 26 throwaway users, and `.e2e-user-registry/` is empty afterwards.

Independent mutation re-runs. These used a mutated copy of the spec plus a config that imports the repo config, both in the evaluator scratchpad; the worktree was not touched. At 375:
- **M1**: `.ui-data-grid__resize-handle { touch-action: none !important }`. G1 went RED (`span.ui-data-grid__resize-handle[none] BLOCKS`). G2 handle, G2 text and capped-body stayed GREEN. This confirms both the executor's claim that G1 is failable and that Chromium ignores a handle-level `none`.
- **M2'** (stricter than the executor's M2, which put `none` on the card and every descendant): `touch-action: none !important` only on each header `th` and its ancestors up to and including `.mobile-panel-stack__item--output`. G2 handle and G2 text both went RED (page stayed at 996, expected < 956). Capped-body also went RED. G2 is genuinely failable by a mutation strictly on its own path (C3).

Code quality:
- The CSS change is a single property with a justified comment.
- The e2e uses `waitForPanelStack`/`waitForPanelGrid`, real CDP touch, `elementFromPoint` hit assertions and frame-stability waits.
- No dead code, no `any`, no over-engineering.

Issue: the comment at `MobilePanelStack.css:110-112` is false (see Phase 1 issue 1).

### Phase 3: UI Review — PASS

- Servers were started with `start-servers.sh`, and `assert-phase.sh servers` printed PASS.
- I did task 5.2's visual check against the running app at 375x812 on a seeded Table dashboard (30 rows, 3 columns), in dark and light themes:
  - The header (sort and pin affordances), sticky header, capped scrolling body and card render normally in both themes. No visual change, as the change predicts.
  - The handle's computed `touch-action` is `pan-y` in both themes.
  - There were 0 console errors or warnings.
  - Evidence (persisted):
    - dark: `/home/matt/Development/helio/.concertino/runs/HEL-1692/evidence/.playwright-mcp/hel1692-eval-375-dark.png` (sha256 0bca725b4cbd0b1440fe55ec11db527e7e2550f891bfce20ae7d9aeef86beeb0)
    - light: `/home/matt/Development/helio/.concertino/runs/HEL-1692/evidence/.playwright-mcp/hel1692-eval-375-light.png` (sha256 7b9b2834a5bb3bd4a452b1d20e5b5104f70ee8183cdea741d74a59001a89277e)
- Phone behaviour at 375/430 and desktop resize at 1280 are covered by the green e2e.
- Breakpoints 1440/1100/768: there is no layout-affecting CSS change (`touch-action` does not affect layout, and the dead rule matches nothing), so I did not take separate screenshots.

Dev-DB residue created by this evaluation (not deleted; the evaluator has no DB access without reading .env):
- user `hel1692-eval-1794882348945@example.com`, id `ff5f08f8-093e-4407-b1a5-df3c647cbd3c`
- dashboard `2699e282-1074-4701-9c8d-a6546e600692`
- data source `2323abeb-f321-4593-b50b-d9896a9575d8`
- pipeline `4997fe09-51e5-4ce7-aac4-9852e4cc1a7e`
- output `bbc9fde1-5846-44e0-aa5b-61bf3883c52c`
- panel `109cb111-615a-4116-a63b-e735c4ceea59`

All of these are owned by that user, so deleting the user cascades. The mutation-run users were deleted by the HEL-1301 teardown.

### Overall: FAIL

### Change Requests

1. In `frontend/src/features/panels/ui/grid/MobilePanelStack.css`, delete lines 97-106: the `/* Table: capped at min(60dvh, intrinsic) ... */` comment and the `.mobile-panel-stack__item--table .panel-content--table { ... }` rule. This makes the comment at lines 110-112 ("formerly here ... HEL-1692 deleted it") true. Before deleting, record the grep proof that nothing produces `mobile-panel-stack__item--table`; the only other hits are the `:54` intrinsic-kind list and the `MobilePanelStack.css.test.ts:19` comment for that list, both out of scope. Then run `npm --prefix frontend test -- --testPathPatterns=MobilePanelStack` and make sure it is green. (The other way to satisfy the AC is to keep the rule and file a follow-up. If you do that, the line 110-112 comment, `files-modified.md`, `tasks.md` 2.3 and `pr-disclosures.md` must all say "not deleted, filed as HEL-xxxx" instead.)
2. Update `/home/matt/Development/helio/.concertino/scratch/HEL-1692/pr-disclosures.md`:
   - Keep the "Dead rule deleted" bullet only once change request 1 has actually landed.
   - Replace the "Visual check (5.2): not run in a browser" bullet with the evaluator's run: 375x812, dark and light, no visual change, handle `touch-action: pan-y`, 0 console errors, with the persisted screenshot refs above.

### Non-blocking Suggestions

- `specs/mobile-viewer-stack/spec.md`, scenario 1 says "and no pull-to-refresh engages while the page is scrolled away from the top", but nothing in the e2e asserts it. Either add an assertion (for example, no `.mobile-panel-pull` refresh indicator or state after the drag) or drop the clause.
- `DataGrid.css:331` cites the e2e spec as the place where the non-reproduction is shown. The spec file only records the probe result in its header comment; the evidence is the cycle-1 probe plus mutation M1. Consider "(cycle-1 probe; see the e2e spec header and the PR body)".
- The executor's M2 put `none` on every descendant of the card, which is broader than "th up to card". The evaluator's path-only M2' confirms the same result, so the PR could cite the narrower mutation.
