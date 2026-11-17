## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: ba69974a2f9a4fe577c6f20f2cc10fa68110ef4c. The base was resolved live with `resolve-review-base.sh` and is d60b1f799d78291e165bcc1226b4a3c625c66fa0. The spawn-cwd guard printed READY.

### What I verified (with evidence)

**The diff (`git diff d60b1f799...HEAD`, non-openspec files)**
- `DataGrid.css:329-333`: `.ui-data-grid__resize-handle` changes from `touch-action: none` to `touch-action: pan-y`, with a comment explaining why.
- `MobilePanelStack.css`: the dead cap rule `.mobile-panel-stack__item--table .panel-content--table` is deleted, and the HEL-1022 comment is updated to match.
- `mobilePanelHeights.ts:39-41`: the citation is repointed to the live cap.
- The comment in `hel1656-pull-to-refresh.spec.ts` is corrected.
- There is a new guard spec, `e2e/hel1692-table-header-touch-scroll.spec.ts`.
- There is no scope creep.

**The deleted rule really was dead**
- `MobilePanelStack.tsx:257` builds the class as `mobile-panel-stack__item--${panel.type}`.
- `PanelKind` (`panel.ts:65`) is `output | text | markdown | image | divider | form`, so `--table` can never be produced.
- No tsx file produces `item--table`.
- One dead `--table` selector is left in the `:54` intrinsic-kind list. Tasks 2.3 put it out of scope, and HEL-1022's comment at `:66` already documents it as dead.

**The resize handle is mouse-only, so `pan-y` cannot remove a touch resize**
- `DataGrid.tsx:1138-1144` wires only `onMouseDown={handleResizeStart}` and `onPointerDown={stopPointerPropagation}`. There is no touch or pointer resize path.

**Revised acceptance criteria (owner ruling ship-pan-y-as-guard)**

| AC | Status | Evidence |
| --- | --- | --- |
| `pan-y` on the handle | met | `DataGrid.css:333` |
| Desktop column resize still works | met | G3 is green, and failable (below) |
| e2e labelled GUARD and failable by mutation | met | Spec header lines 8-18 label every test a guard, not fails-first; failability reproduced by me (below) |
| Capped-body case triaged with `.mobile-panel-stack__item--output .panel-content` | met | Spec lines ~266-305 |
| PR disclosures | met | See the two notes below |
| Dead rule deleted or filed | deleted in this PR | The disclosure says so |

The capped-body test also asserts, right before the drag, that the grid overflows by more than 100px and that both the grid and the cap sit at scrollTop 0, so C1 is satisfied.

**Gates I ran myself (servers via `start-servers.sh` on 7124/10031, then `assert-phase.sh servers` printed PASS)**
- Baseline: `npx playwright test e2e/hel1692-table-header-touch-scroll.spec.ts --workers=2` with DEV_PORT=7124 gave **9 passed (27.1s)**. The teardown deleted all 9 throwaway users.
- `npm --prefix frontend test -- --testPathPatterns='MobilePanelStack|DataGrid' --maxWorkers=3` gave 13 suites and 179 tests passed.
- I did not re-run lint, typecheck or the full jest suite. The evaluator's evaluation-2 gives the exit codes and counts. The cycle-2 delta is CSS deletion and comment edits, which these gates would not be sensitive to beyond what I ran.

**Guard failability, reproduced independently**
- Method: I used a temporary copy of the spec, `e2e/zz-skeptic-mut.spec.ts`. It injects the mutation with `page.addStyleTag` and `addInitScript`, so no source file was edited. I deleted the copy afterwards; `git status` shows only the untracked evaluation-2.md.
- **M1 (handle back to `touch-action: none`, which is exactly the base commit's CSS):**
  - G1 is red at 375 and 430, with `span.ui-data-grid__resize-handle[none] BLOCKS`.
  - G2 handle, G2 text and capped-body stay green.
  - This independently confirms the non-reproduction: Chromium scrolls even with `none` on the handle.
- **M2' (path-only, C3):** `touch-action: none !important` on `.mobile-panel-stack__item--output` and its `.panel-content`, `.crossfade`, `.crossfade__layer`, `.ui-data-grid__frame`, `.ui-data-grid`, `table`, `thead`, `tr` and `th`, which is only the hit path from the th up to the card. All 8 phone tests went red. The drags failed with `Received: 996` (needed < 956), and G1 also flagged the blockers.
- **M3 (capture-phase `mousedown` stopPropagation on the handle, which kills `handleResizeStart`):** G3 went red (`Expected > 226, Received 196`).
- So every guard is failable by a mutation on its own path, and C3 holds. This matches the executor's mutations.log numbers, but I derived the results myself.

**UI / design judgment**
- There is no visible surface change. The only CSS edits are a `touch-action` value (which has no paint effect) and the deletion of a rule that matched no element. I did not open a browser session, because that would have needed another registered user, which is dev-DB residue.
- The evaluator's persisted dark and light screenshots at 375 are in `/home/matt/Development/helio/.concertino/runs/HEL-1692/evidence/.playwright-mcp/`.
- No design-standard concern applies.

**Dev-DB residue**
- I added none. The playwright teardown deleted all users it created, and `.e2e-user-registry` is empty.

### Verdict: CONFIRM

### Non-blocking notes (fix in the PR body before opening it)

1. **pr-disclosures.md says "No test here was red before the change." That is inaccurate.**
   - G1 asserts the CSS property itself, so it IS red on the base commit. M1 restores exactly the base CSS, and G1 goes red.
   - Accurate wording: "G1 (static) is red on the base commit because it checks the property itself; no behavioural test (G2, capped body) was red before the change; the user-visible symptom never reproduced in Chromium."
   - As written, the sentence also contradicts the disclosure's own M1 bullet.
2. **The PR body cites `/home/matt/Development/helio/.concertino/scratch/HEL-1692/mutations.log` as where the transcripts live.**
   - That is a local scratch path, swept after merge, and unreachable from the PR.
   - Inline the key red lines (G1 `[none] BLOCKS`; G2 `996, expected < 956`; G3 `196, expected > 226`) in the PR body, or persist the log via `persist-evidence.sh`.
3. **The disclosure line "A capped Table's body scrolls before the page" is stated as fact (C2), but only the at-bound chaining half is asserted by the e2e.**
   - "Body first" is standard nested-scroll semantics and plausible.
   - Consider "by standard nested-scroll semantics" wording, or leave it as is.
4. **`DataGrid.css:331` says "cycle-1 probe".** That is workflow-internal vocabulary; the evaluator noted the same.
5. **The commit message of 486f3a07c says "drop dead --table cap rule", but that commit only edited comments; the deletion landed in ba69974a2.** This is irrelevant after a squash, and the disclosure already states it correctly.
6. **evaluation-2.md is untracked in the worktree.** The orchestrator should make sure it is committed or persisted with the other reports.
