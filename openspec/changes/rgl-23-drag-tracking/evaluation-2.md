## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 1632c55641f98e59918d5824f36021783fd25862. The cycle-2 delta is cb5380d8a..1632c5564: comments and evidence text only, no code.

### Phase 1: Spec Review — FAIL

Cycle-1 change requests:

| CR | Status | Detail |
|---|---|---|
| CR1 | Addressed | `.github/dependabot.yml:59-65` links #2303, PR #2304 and 1468c0f. Removal is conditional on a release that contains 1468c0f plus hel1573:275 passing 20/20. The archive-fragile openspec path is gone. |
| CR2 | Addressed | `upstream-issue-draft.md` is headed "DO NOT FILE: duplicate of react-grid-layout#2303". |
| CR3 | Addressed | Both evidence files cite #2303. |
| CR4 | Addressed | The persisted copy of the draft matches the worktree (`diff -q` clean). |
| Suggestion | Done | The header of `min/hel1728-min.tsx` is fixed. |

AC1 (bisect), AC2 (pin, ignore rule with reason, upstream issue linked) and AC3 (hel1573:275 20/20 on 2.2.4) are all met.

Two evidence claims are inaccurate. The first one came from my own cycle-1 report.

1. **The "wide cells" explanation for the app's 397 px error is wrong.** It appears in `upstream-issue-draft.md:7`, `running-app-check.md:21` and `minimal-repro.md:17`. My evaluation-1 suggested it; I did not verify it.
   - The app's lg grid has 12 columns (`frontend/src/features/dashboards/state/dashboardLayout.ts:22-23`), so cells are not wide.
   - The sweep's seed puts "M-sweep Metric" at `x:0, w:3` with a chart directly to its right at `x:3, w:9` (`e2e/support/motionPrimitivesSeed.ts:62-63`). The app runs `noCompactor` + `preventCollision`.
   - So, dragging right, the snapped `x` never changes: the move is collision-blocked, and on 2.3.0 the memoized GridItem never re-renders. In the app the item really is stuck. It is not lagging by a step.
   - Your own scratch data shows this. `.concertino/scratch/HEL-1728/min-2.3.0-var/min-result-inline=1&collide=1&pos=1.json` has drag error 349 px (0/3). The bare page has 52 px.
   - The cycle-2 edit in `running-app-check.md` now says "step lag, not a stuck item". That is the reverse of what the evidence shows for our configuration.
2. **"The upstream fix covers our sequences" is wider than what was measured** (`minimal-repro.md:19`).
   - The react-resizable 3.1.3 caveat is stated accurately.
   - But 1468c0f was measured only on the **bare** page (`min-1468c0fc/` has only `min-result-bare.json`, 5/5 on every row with 0 px diffs). The bare page has no `collide=1`, and that collision-blocked case is the one that matches our app.
   - The pin's removal gate (hel1573:275 20/20 on the release) still protects us. Only the sentence overclaims.

### Phase 2: Code Review — PASS

No `frontend/**` or `backend/**` file changed, so no project gate triggers. These checks passed:
- `check:dependabot`: OK.
- `prettier --check .github/dependabot.yml`: clean.
- `check:openspec`: clean.

The install is restored to 2.2.4 after the 1468c0f overlay:
- `frontend/node_modules/react-grid-layout/dist` and its `package.json` are byte-identical to the 2.2.4 tarball.
- react-resizable is 3.1.3.
- The `.vite` deps are cleared, so the next server start rebuilds them from the pristine dist.

My cycle-1 hel1573:275 run, `--repeat-each 20 --workers 2`, gave 20/20. It still applies: the delta has no code, and the install is unchanged and verified pristine.

The scratch-spec glob analysis from cycle 1 is unchanged.

### Phase 3: UI Review — N/A

No trigger paths changed.

### Overall: FAIL

Category: spec-divergence. Inaccurate mechanism and coverage claims in the committed evidence.

### Change Requests

1. **Fix the "wide cells" explanation.**
   - In `upstream-issue-draft.md:7` and `running-app-check.md:21`, replace "wide cells" / "step lag, not a stuck item" with this: in the app the dragged Metric panel (`x:0 w:3`) is collision-blocked by its `x:3` neighbour under `preventCollision`, so its snapped position never changes and 2.3.0 never re-renders it. The item is stuck.
   - Cite `min-2.3.0-var` `collide=1`: 349 px vs 52 px bare.
   - Keep "half-step lag then jump" for the unblocked bare grid only.
   - Make the same correction to the "not 'no tracking at all'" phrasing in `minimal-repro.md:17`. It is true for the bare grid, not for our configuration.
2. **Scope the 1468c0f claim** in `minimal-repro.md:19`. Do one of these:
   - (a) Run `min/run-min.sh` with `inline=1&collide=1&pos=1` on the 1468c0f overlay and report the result.
   - (b) Reword to "covers the bare-page sequences; the collision-blocked configuration our app uses was not measured, which is why the pin's removal gate is hel1573:275 on the release".
3. Re-persist the edited files.

### Non-blocking Suggestions

- `evaluation-1.md` is untracked in the worktree. Commit it with the next change, as for other review reports.
