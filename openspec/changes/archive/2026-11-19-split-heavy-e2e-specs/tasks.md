## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; never run env-dumping commands; only scripts may read scripts/concertino/.concertino.env, never print it; never copy .env files.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; never run a suite in the background past the tool timeout.
- [C8] No prod, no release, no concertino sync; never edit CD or release workflows.
- [C13] Scratch in .concertino/scratch/HEL-1778/ (main checkout), never committed.
- [C14] Local e2e only against a lane-private DB helio_hel1778 (DATABASE_URL for start-servers.sh and Playwright); ANTHROPIC_API_KEY exported empty for any backend.
- [C15] Measure only from GitHub CI artifacts/API of 7-leg runs, never local timings.
- [C16] Do not edit HEL-1781/HEL-1784 specs; do not rerun main-branch runs.
- [C17] Any Delivery-time weight regeneration happens before the PR measurement reruns; if the table changes after a measurement attempt, the measurement is taken again on the new head.
- [C18] Test code shared by several split parts lives once in the e2e/support module (called from each part), never copied into each part.

## 1. Variance cause (before any split)

- [x] 1.1 Download `playwright-json-shard-*` for the counting 7-leg main runs since 33dd755d9 and for PR #1172 run 44428229791 (only attempt 6's reports survive) into `.concertino/scratch/HEL-1778/runs/` (the two main runs already there may be reused); for attempts 1-5 fetch the e2e job logs (`gh run view 44428229791 --attempt <n> --job <id> --log`, job ids from `/attempts/<n>/jobs`) and parse the `list` reporter lines into per-test durations; record which runs count and why the others do not, and each run's data source (report or log).
- [x] 1.2 Write `.concertino/scratch/HEL-1778/specvar.mjs`: for EVERY discovered spec, summed duration per run, share of run total, swing, per-test spread, leg and per-worker busy/idle tail, in-file mode; and for every run/attempt the slowest leg, its excess over the mean leg, and the ranked specs accounting for it (design Decision 1). Main runs and PR #1172 attempts are separate populations.
- [x] 1.3 Write `openspec/changes/split-heavy-e2e-specs/variance.md`: one section per spec (hel1665, hel1733, hel1583, hel1608) with the numbers, the named cause (run-wide vs spec-specific, and what), and the chosen remedy and part boundaries; a slowest-leg table per run/attempt with its drivers; the material drivers outside the three specs per Decision 1's rule (for a follow-up ticket); and the stated expectation for AC3 and the 1200 s outcome. If the numbers contradict Decision 1's expectation (the three named specs drive no slowest-leg excess), stop and report before splitting.

## 2. Split the heavy specs (no test lost or weakened)

- [x] 2.1 Capture the base test list: `npx playwright test --list --reporter=json --project=dev` at the base, reduced to project + title path (scratch).
- [x] 2.2 Split `e2e/hel1665-home-phone-stability.spec.ts` into 4 parts, `e2e/hel1733-draft-outputs-shapes.spec.ts` into 3, `e2e/hel1583-glass-nav.spec.ts` into 2 (by theme), per design Decision 2; shared code moved verbatim to `e2e/support/<stem>.ts`; each part repeats the file-level configure/setTimeout/use; check for cross-describe module state first.
- [x] 2.3 Update references to the old file names found by a grep outside `openspec/changes/archive/` (e.g. the comment in `frontend/src/features/home/ui/HomePage.css.test.ts`, `e2e/README.md`); a zero-hit grep for `hel1583-glass-nav.spec.ts:554` is recorded and not chased further.
- [x] 2.4 Before/after proof (design Decision 3): identical project + title-path multiset, equal per-project counts, zero test-body differences, equal `expect` counts; save outputs in scratch and summarise in `variance.md`.
- [x] 2.5 `npm run check:e2e-types`, `npm run check:e2e-user-cleanup`, `npm run check:e2e-evidence-paths` and lint pass; run each new part locally once against the lane-private DB (C14) to confirm it discovers and passes (correctness only, not timing).

## 3. Weights attribution by title path (red first)

- [x] 3.1 Add selftest cases for each attribution rule in the spec delta (kept in place, moved by split, renamed in a still-discovered file, ambiguous move fails naming it, deleted file dropped and named, no `--list` = unchanged output); run them red against the unchanged tool and record the failures.
- [x] 3.2 Implement `--list <list.json>` in `scripts/e2e-shard.mjs weights` (title path = describe chain + title, no file root suite, no project); the header's `# Regenerate:` line shows the `--list` form when used; re-attributed results listed on stderr; update the usage strings and `e2e/README.md` regeneration docs.
- [x] 3.3 Selftest green; mutation check: break each rule in turn and show the matching case goes red; record in scratch.
- [x] 3.4 Gate-chain isolation transcript: `scripts/concertino/test-gate-in-isolation.sh HEL-1778 scripts/e2e-shard.selftest.mjs`.

## 4. Regenerate weights and measure the before set

- [x] 4.1 Regenerate `e2e/shard-weights.tsv` with `--list` from the branch head over the 5 most recent counting 7-leg main runs (design Decision 5); confirm `hel1608` row updated, split parts present, old files absent; list any defaulted spec and why.
- [x] 4.2 `node scripts/e2e-shard.mjs plan` before and after: predicted per-leg loads; out-of-sample check of predicted balance against one counting run not in the source set.
- [x] 4.3 Write `.concertino/scratch/HEL-1778/measure.mjs` (per-attempt jobs API: slowest leg, mean leg, headroom, test step vs setup, apt-step time; per-leg median/max of whole leg and test step; imbalance per the spec; counting rule) and run it on the before set (every counting 7-leg main run) plus, for context only, the 25 most recent counting main runs with leg count shown; save `before.md` in scratch.
- [x] 4.4 Commit (pre-commit hooks pass) with `files-modified.md` listing every file.

## 5. Delivery measurement (orchestrator)

- [ ] 5.1 PR CI first run plus labelled whole-run measurement reruns (download each attempt's `playwright-json-shard-*` before starting the next rerun) until 5 counting attempts or 7 total (never fewer than 3); per-attempt slowest/mean leg and headroom; before/after per-leg medians and imbalance in the PR body; the balance requirement clause by clause (design Decision 6: 25-run before set not met at 7 legs, 15 s line met/not met with number, control not applicable); any attempt over 1200 s with its driver; apt-step note (design Decision 7).
- [ ] 5.2 File the follow-up ticket for material drivers outside the three specs (Decision 1 rule), through the follow-up triage.
