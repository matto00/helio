## Standing Constraints

- [C1] Guard-spec post-helper assertions are one-shot non-retrying reads (count(), one evaluateAll, plain expect on values), never retrying matchers
- [C3] Guard spec stretches only the .crossfade__skeleton fade (3000 ms, injected style) so mutant B is red independent of poll timing; real helper waits with explicit timeouts above it
- [C2] A mutation counts as red-first evidence only if red on every repetition of --repeat-each 5; record the transcript

## 1. Tests

- [x] 1.1 Add `e2e/support/panelGridReady.ts` (`waitForPanelGrid(page, count, { timeout? })` + exported live-layer selector, desktop-only doc comment) per design D1; verify `npm run check:e2e-types` passes
- [x] 1.2 hel1572 density test: replace both post-`/dashboards` count waits with `waitForPanelGrid(page, 3)`; verify the file passes once
- [x] 1.3 `hel1575-reload-after-edit.spec.ts`: add the wait before its final count; verify it passes once
- [x] 1.4 Run `grep -rn "react-grid-item" e2e`, classify every hit per design D2, write `sweep.md` in this change dir with the command, raw output and a verdict + line ref per hit; verify every hit has a verdict
- [x] 1.5 Apply the wait to every FIX hit from 1.4; verify each touched spec passes once
- [x] 1.6 Secondary `.panel-grid-card` grep per design D3 (desktop AND phone skeletons render that class), recorded in `sweep.md`; verify the hit count is recorded
- [x] 1.7 Add guard spec `e2e/hel1633-panel-grid-ready.spec.ts` per D4; verify it passes with `--repeat-each 5` and that each D4 mutation is red on 5/5 repetitions (C1, C2, C3; transcripts in evidence)
- [x] 1.8 AC1: hel1572 `--repeat-each 30 --workers=2` under `nice -n 19` per D5 with zero failures; record the summary, load average and `free -g` in evidence
- [x] 1.9 Lint/Prettier/e2e type check clean on all touched files; verify the pre-commit hook passes
