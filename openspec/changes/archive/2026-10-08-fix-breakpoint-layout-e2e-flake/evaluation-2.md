## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD 1d53ea7b73a6b7a6e9e53c9936195fac61e9121a against the live-resolved base 7e1df62a67ada4de6dd2499cbb5d84cec69e7dbb. The new commit is 1d53ea7b, on top of f9f287d9, which cycle 1 reviewed in full.

The cycle-2 diff touches only these files:
- `DesktopPanelGrid.tsx`: comment only, +7/-4.
- `evidence.md`: two passages.
- New `dev-db-residue.txt`.
- `evaluation-1.md`: committed, and byte-identical to the persisted copy.

`e2e/` is unchanged since f9f287d9. Frontend code is unchanged apart from that comment.

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 (dev-DB residue by exact id): resolved.**
  - `dev-db-residue.txt` has 305 rows (`id email created_at`), all ids unique.
  - I re-derived the set read-only from the dev DB: every `hel1023-%@example.test` user created in the last day, minus the evaluator's 31. The file and the DB match exactly: 0 ids only in the DB, 0 only in the file.
  - None of the evaluator's 31 ids appears in the file.
  - The newest earlier `hel1023-` user dates from 2026-10-01, so nothing from a prior run is misattributed in the window.
  - evidence.md is honest that attribution is by email pattern plus time window.
  - Task 4.3 now matches what was done.
- AC/constraint findings from cycle 1 still stand:
  - C1–C4 honored.
  - The AC1/AC5 substitute evidence is sound as a mechanism repro. It is not a natural-rate red→green, and the owner escalation on that point remains open. **Not decided here.**

### Phase 2: Code Review — PASS

Gates, from my own fresh run in WORKTREE_PATH with `nice -n 19` — all exit 0:
- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm run check:openspec`
- `npm --prefix frontend run build`
- `npm test -- --maxWorkers=4`: frontend 476/476 suites and 4972 tests; root 42/42 suites and 407 tests

The backend is unchanged.

- **Cycle-1 CR2 (comment overclaim): resolved.** `DesktopPanelGrid.tsx:310-319` now says the processed width commits together with RGL's new breakpoint/cols render. It also says this is NOT the point at which every item is laid out, because the inner GridLayout syncs its own layout state one effect flush later, so consumers must still let transitions finish and positions settle. That matches the RGL v2.2.4 source I checked in cycle 1 (`chunk-7ZM5LVH2.mjs`: width effect l.1402-1452; GridLayout layout sync l.707-727; items drawn from internal `layout`, l.1109).
- The comment also adds the `style`-vs-`data-*` rationale, which was a cycle-1 non-blocking suggestion.
- The evidence.md "Fix" passage is corrected to match.
- No code-path change, so the cycle-1 unit-guard result still holds (2/2 red with the wiring removed). So do the injected-delay red→green results (pre-fix 4/4 fail with the CI signature; post-fix 10/10 and 6/6 pass).

### Phase 3: UI Review — PASS

UI-affecting files are in the diff, but the only cycle-2 change to them is a comment, so behaviour is identical to f9f287d9. The cycle-1 UI results carry forward:
- The processed width matched the grid box at 1440/1100/1900/1056 and after the stack→grid remount.
- The stack swap was correct at 400.
- No console or page errors.
- No horizontal overflow.

### Overall: PASS

### Non-blocking Suggestions
- evidence.md gives the residue window as "15:30:39 to 16:22:40". The actual newest row in `dev-db-residue.txt` is 16:04:07.588553-07; 16:22:40 is the query bound, not the newest row. Tightening the wording to the real max would help a reader who checks it.
- `DesktopPanelGrid.tsx` is now 428 lines, over the CONTRIBUTING.md ~400-line threshold. Propose a split in the PR description.
