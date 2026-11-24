## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `ad6e0c2a98e17661d3887ad1d2b069882c6a1af4` against the live-resolved base `b2da43a3d02ba1b84eb8296b9bd9ed742623a353`. The only commit since cycle 1 is `ad6e0c2a9`. It changes only the e2e spec and the change dir's evidence, plus a committed copy of evaluation-1.md. `git diff a4b1fcca5 ad6e0c2a9 -- frontend` is empty.

### Phase 1: Spec Review — PASS

Cycle 1's Phase 1 issue is resolved:
- The task 3.5 evidence is replaced by four full-file runs, `3.5-e2e-full-run1..4.txt`. Each one is 4/4 green, so the evidence now agrees with the `[x]`.
- The unevidenced "baseline 3 of 8" claim is gone. `grep -rn "3 of 8"` over the change dir finds it only in evaluation-1.md, where it is quoted.
- The ALLOWED comment now says the viewer flow does not expand the disclosures, so their contents are not scanned. That matches what the flow does.

The rest of cycle 1's Phase 1 findings still hold: all three ACs are met, the `--no-verify` red commit is stated, and both new ALLOWED entries are pure disclosures.

### Phase 2: Code Review — PASS

Gates, run fresh by me at `ad6e0c2a9` in WORKTREE_PATH:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `tsc --noEmit -p e2e/tsconfig.json`: exit 0
- `npm --prefix frontend run build`: exit 0
- `npm test` (lane DB, 3 workers): exit 0. Root: 76 suites / 683 tests passed. Frontend: 937 suites / 10869 tests passed.

I checked the new wait in `valueContrast` (`e2e/hel1794-viewer-read-only.spec.ts:151-161`) against each claim:
- **It cannot hang on an infinite animation.** Before it awaits `finished`, it drops any animation whose `getComputedTiming().iterations` is `Infinity`. That is the value the Web Animations API reports for `animation-iteration-count: infinite`, so an infinite animation is never awaited.
- **A cancelled animation does not reject the wait.** `finished.catch(() => undefined)` absorbs the rejection.
- **The one residual case fails loudly.** A finite animation that is paused would never settle, and the wait would block until the test timeout. That gives a red test, never a false pass. No such animation exists on this page today; my 8 runs never stalled.
- **The 4.5 bar is not weakened.** It is still `toBeGreaterThanOrEqual(4.5)` at line 318. The wait does not touch the opacity fold-in or the backdrop compositing, so it measures the settled state a user actually reads. Real motion stays on: there is no reduced-motion emulation and no CSS override.
- **It covers both dialogs.** The wait sits inside `valueContrast`, so it also covers the phone step-sheet reads that cycle 1 asked about.
- **The mutation is meaningful.** `3.6-contrast-settled.txt` shows 6/6 runs at 14.198. `3.6-contrast-mutation-no-wait.txt` shows that with the wait disabled, the values drop back to the 8.0–9.7 spread. The mutation runs still pass, because on this machine the early readings stayed above 4.5. That is expected: the defect is the run-to-run spread, and the 4.43 failures occurred on a more heavily loaded run.
- The wait uses the document's animations (`el.ownerDocument.getAnimations()`), not only the target's ancestors. That is broader than needed but harmless.

### Phase 3: UI Review — PASS

I restarted the servers with `start-servers.sh`, with the lane DB, DB_USER and an empty ANTHROPIC_API_KEY in the same command. Playwright ran with 2 workers.
- `e2e/hel1794-viewer-read-only.spec.ts` full file: 3/3 runs green, 4/4 tests each. This covers the viewer on desktop and phone in light and dark, the scan self-test, and the editor keeping every control.
- `-g "viewer on phone"`: 5/5 green.
- Phone/light contrast across all 8 runs was identical: output name, output kind and step fields 0–1 all read 14.198222471122818. The cycle-1 spread (6.16–12.13) is gone. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1839/evidence/.concertino/scratch/HEL-1839/eval2/contrast.txt`
- The servers were stopped afterward with `stop-servers.sh`, and both ports are free.

### Overall: PASS

### Non-blocking Suggestions
- The spec is now about 480 lines, past CONTRIBUTING's ~400-line mark, so mention a split in the PR description.
- If a page ever gains a paused finite animation, the wait will run to the test timeout. A bounded `Promise.race` with a short timeout would turn that into a clear failure message. This is optional.
