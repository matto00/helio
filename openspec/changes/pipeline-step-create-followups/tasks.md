## Standing Constraints

- [C1] Item 5 (HEL-1294 stable-key migration) is out of scope; do not touch HEL-1294's disable-expand behaviour.
- [C2] The refactor commit modifies no test file and changes no behaviour; all existing suites pass unmodified.
- [C3] Items 1 and 3 record red-first evidence (failing run, then green) in `probe-evidence.md`; item 3 also records the
  probe that confirmed the root cause before the fix.
- [C4] Three separate commits in D1 order: item 1 test, item 2 refactor, item 3 fix.
- [C6] Item 4 / AC4 moved to HEL-1345 (owner ruling H2). Add no post-create resync; change no backend file.
- [C5] Do not touch `ci.yml`, `playwright.config.ts` or `.gitignore`. Playwright at most 2 workers under `nice -n 19`.

### Frontend

- [x] 1.1 Port HEL-1321's reorder probe into `PipelineDetailPage.draftCreate.test.tsx`; verify green, red with the :1290
  carry removed, green restored; commit (item 1)
- [ ] 2.1 Create `hooks/usePipelineStepCreation.ts` per design D3 and move the create/draft logic; verify lint, tsc,
  and the full frontend Jest suite pass with zero test-file changes; commit (item 2)
- [ ] 3.1 Probe item 3's root cause (D4) and record it; write the red test; fix; verify red→green; commit (item 3)

### Tests

- [ ] 5.1 Run lint, format:check, typecheck, root and frontend Jest (`--maxWorkers=2`) and the frontend build; verify all
  green and record results in `probe-evidence.md`
