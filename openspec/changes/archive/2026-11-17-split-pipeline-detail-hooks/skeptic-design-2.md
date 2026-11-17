## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD a6499da125f7984d9d0338f09a0ef62173865382. The planning artifacts are untracked in the worktree.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-detail-hooks/HEL-1704`.
- **Round-1 CR1 (size): addressed.**
  - D2 and D3 now name six page hooks and four draft-save modules, each with a projected size.
  - Every D2 line range matches the live `usePipelineDetailPage.ts`:
    - 160-188 is seeding plus `usePipelinePageLoad`.
    - 190-256 is the analyze run.
    - 288-413 is structure, mutations, root/toggle and routing.
    - 415-454 is `usePipelineRunAndSaveActions`, `outputsLoaded` and `usePipelineDraftSave`.
  - The step-actions block returns exactly the page's 15 keys from that block: 4 from structure, 3 from root/toggle and 8 routed handlers.
  - The analyze hook can return `laneGraph`, `roots` and the 6 lookups, all of them returned keys. `usePipelineOutputSheets`'s 10 keys are all returned keys, so the -40 return compaction is plausible.
  - There is a stop rule above 300, and the reason for any size above 250 is recorded in design.md, which meets AC1.
  - D3's ranges also match:
    - settle is 198-269 (72 lines).
    - the catch mapping is 334-355.
    - the builder is 284-320.
  - My own recount of D3, including the `SaveArgs` type (61-77, which round 1's 276 had deleted) and the roughly 20 import lines that leave, is about 236. That is within the hard 250.
- **Effect order (D1):** the only effect-bearing calls between the moved runs are `usePipelineDirtyAndOwner` and `usePipelineOutputSheets` (grep for `useEffect|useLayoutEffect`). They stay in the composer, between the analyze hook and the step-actions hook, so their order is unchanged. D3 keeps the mounted and dropped effects ahead of every moved call.
- **Round-1 CR2 (D4 vs addendum G): addressed.**
  - "Usable" is now addendum G's own criterion.
  - A measured table is recorded.
  - I re-derived the table from the flex algorithm against the live CSS (`.step-preview` `flex:1; min-height:0`; disclosure editor `flex-shrink:0; max-height:max(45%,290px)`; main column padding `--space-4`, gap `--space-3`):
    - At 900x600 the column content is 327 - 32 = 295. The editor takes 267, the gap 12, and the preview 16 on main.
    - With a 35px minimum on the preview, the editor shrinks by 19 to 248, so its box ends at 357, below the first row's bottom at 330.
    - With a 64px minimum, the editor box ends at 328 and clips that row by 2px.
    - At 900x700 the preview gets 96 ≥ 35 and nothing moves. The same holds for a 290px-capped tall editor.
  - The numbers are internally consistent.
  - Both constraints hold, so not raising the owner question is justified. There is also an ESCALATION fallback if the shipped CSS disagrees.
- **Round-1 CR3 (wrapping header): addressed.**
  - The guarantee is now pinned to the title row. Wrapped chips and the count are clipped by the existing `overflow:hidden`.
  - The spec delta matches.
- **Live probe of the title's line box.** I started this run's servers (`assert-phase servers` returned PASS) and checked a disclosure-layout page at 900x600:
  - `.step-preview__title` is 14px with `line-height: normal`, giving an 18px box (420-438).
  - `.step-preview` is `box-sizing: border-box`.
  - The servers were stopped with `stop-servers.sh`.
- **Guards (D5):**
  - The red-first case is named: the 900x600 title, both themes. 900x700 is labelled no-regression.
  - The selectors `.pipeline-detail-page__filter-condition-row` and `.spine-body__editor` exist.
  - hel1685 addendum G stays in the nets.
  - All four e2e specs named by AC2 exist in `e2e/`.
- **AC coverage:**
  - AC1, AC2 and AC3 are covered by D2/D3 and tasks 2-3.
  - AC4 by D4/D5 and tasks 4.1-4.2.
  - AC5 by task 4.3.
  - AC6 by the refactor rules and task 5.3.
  - Nothing is out of scope. There is no API or schema change, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

1. **D4's min-height formula still has a placeholder that no token fills.** It reads `calc(1px + 2 * var(--space-2) + <title line-height at --text-sm>)`, but the title's line-height is `normal` (font-metric, 18px), not a token.
   - Suggested pin: `calc(1px + 2 * var(--space-2) + 1lh)` on `.step-preview`. The preview has the same font and size and also uses `line-height: normal`, so `1lh` is about 18px. Hard-coding `18px` is the alternative to avoid.
   - Under `border-box` the bottom border also eats 1px of the 35, which is harmless: the title still ends 7px inside.
   - Any reasonable choice keeps both constraints (even 21px leaves the editor box ending at 354, below 330). The e2e guard holds the outcome, so this does not block.
2. **D1 lists `useNavigate`/`useSearchParams` as effect-free, which is wrong.** In react-router-dom ^7 both run a layout effect internally (`activeRef`). No planned move reorders them (`useSearchParams` stays after the mounted and dropped effects in D3), but fix the list so it cannot license a future move.
3. **Name `SaveArgs`'s home.** It is 17 lines and not mentioned in D3. It fits in `usePipelineDraftSave.ts` under 250 by my count, but say so.
4. **`usePipelineDetailRunAndSave.ts` sits next to the existing `usePipelineRunAndSaveActions.ts`.** Consider a name that reads less like a duplicate, for example `usePipelineDetailSaveWiring`.
5. **The UiState hook cannot be spread into the return.** Its result includes internal-only `outputNamePipelineId` and `setIsConfirmingCancel`, so the key-set guard will reject a spread. The projection's -40 should not count on it.
6. **AC4 says "keeps its header visible", but D4 guarantees only the title row.** At 900x600 the wrapped count and chip line are hidden; on main the whole header is clipped, so this is still strictly better. Say this in the PR body so the final gate does not read it as a gap.
